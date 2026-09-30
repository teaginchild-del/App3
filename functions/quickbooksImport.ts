// Pulls one QuickBooks entity type into LedgerRecord, normalized so it can be
// matched against objects QuickBooks does not have (sales orders, bank
// deposits, customer deposits, custom types).
//
// The UI calls this once per entity type so each call stays well inside the
// function time limit. Re-running is safe: rows are upserted by
// (connection_id, record_type, external_id) and unchanged rows (same
// SyncToken) are skipped.
//
// Payload: { connection_id, entity: 'Invoice' | 'Payment' | ..., since?: 'YYYY-MM-DD' }
// Secrets: QBO_CLIENT_ID, QBO_CLIENT_SECRET
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const PAGE_SIZE = 1000;
const MINOR_VERSION = 75;

const ENTITIES: Record<string, string> = {
  Invoice: 'qbo_invoice',
  Estimate: 'qbo_estimate',
  SalesReceipt: 'qbo_sales_receipt',
  CreditMemo: 'qbo_credit_memo',
  RefundReceipt: 'qbo_refund_receipt',
  Payment: 'qbo_payment',
  Deposit: 'qbo_deposit',
  Transfer: 'qbo_transfer',
  Purchase: 'qbo_purchase',
  PurchaseOrder: 'qbo_purchase_order',
  Bill: 'qbo_bill',
  BillPayment: 'qbo_bill_payment',
  JournalEntry: 'qbo_journal_entry',
  Item: 'qbo_item',
  Customer: 'qbo_customer',
  Vendor: 'qbo_vendor',
};

// deno-lint-ignore no-explicit-any
type Json = any;

function apiBase(env: string) {
  return env === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com';
}

/** "SalesReceipt" -> "qbo_sales_receipt" */
function typeKey(txnType: string) {
  return ENTITIES[txnType] ?? 'qbo_' + txnType.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

// ---------------------------------------------------------------- tokens

async function getAccessToken(svc: Json, connection: Json) {
  const [token] = await svc.QuickBooksToken.filter({ connection_id: connection.id });
  if (!token) throw new Error('No tokens stored for this connection; reconnect QuickBooks.');
  if (token.access_token && Date.parse(token.access_token_expires_at) - Date.now() > 120_000) {
    return token.access_token;
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${Deno.env.get('QBO_CLIENT_ID')}:${Deno.env.get('QBO_CLIENT_SECRET')}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token }),
  });
  const body = await res.json();
  if (!res.ok) {
    await svc.QuickBooksConnection.update(connection.id, { status: 'needs_reauth' });
    throw new Error(`QuickBooks refresh failed (${body.error || res.status}); reconnect QuickBooks.`);
  }
  const now = Date.now();
  // Intuit rotates refresh tokens; always store the newest one.
  await svc.QuickBooksToken.update(token.id, {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    access_token_expires_at: new Date(now + body.expires_in * 1000).toISOString(),
    refresh_token_expires_at: new Date(now + body.x_refresh_token_expires_in * 1000).toISOString(),
  });
  return body.access_token;
}

async function query(connection: Json, accessToken: string, sql: string, attempt = 0): Promise<Json> {
  const url = `${apiBase(connection.environment)}/v3/company/${connection.realm_id}/query?minorversion=${MINOR_VERSION}&query=${encodeURIComponent(sql)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  if (res.status === 429 && attempt < 4) {
    await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    return query(connection, accessToken, sql, attempt + 1);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fault = body?.Fault?.Error?.[0];
    throw new Error(`QuickBooks ${res.status}: ${fault?.Message || ''} ${fault?.Detail || ''}`.trim());
  }
  return body.QueryResponse ?? {};
}

// ---------------------------------------------------------------- normalizers

function linkedFrom(list: Json[] | undefined) {
  return (list || [])
    .filter((l) => l?.TxnId && l?.TxnType)
    .map((l) => ({ record_type: typeKey(l.TxnType), external_id: String(l.TxnId) }));
}

function lineFrom(line: Json) {
  const d = line.SalesItemLineDetail || line.ItemBasedExpenseLineDetail || line.GroupLineDetail;
  const acct = line.AccountBasedExpenseLineDetail || line.DepositLineDetail || line.JournalEntryLineDetail;
  return {
    item_ref: d?.ItemRef?.value ?? d?.GroupItemRef?.value,
    item_name: d?.ItemRef?.name ?? d?.GroupItemRef?.name ?? acct?.AccountRef?.name,
    description: line.Description,
    quantity: d?.Qty ?? d?.Quantity,
    unit_price: d?.UnitPrice,
    amount: line.Amount,
    linked: linkedFrom(line.LinkedTxn),
  };
}

function normalize(entity: string, o: Json) {
  const base: Json = {
    record_type: ENTITIES[entity],
    source: 'quickbooks',
    external_id: String(o.Id),
    version: o.SyncToken,
    reference: o.DocNumber,
    date: o.TxnDate,
    due_date: o.DueDate,
    amount: o.TotalAmt,
    balance: o.Balance,
    currency: o.CurrencyRef?.value,
    counterparty: o.CustomerRef?.name ?? o.VendorRef?.name ?? o.EntityRef?.name,
    counterparty_id: o.CustomerRef?.value ?? o.VendorRef?.value ?? o.EntityRef?.value,
    memo: o.PrivateNote || o.CustomerMemo?.value || undefined,
    raw: o,
  };

  const lines = (o.Line || []).filter((l: Json) => l.DetailType !== 'SubTotalLineDetail');
  const linked = [...linkedFrom(o.LinkedTxn), ...lines.flatMap((l: Json) => linkedFrom(l.LinkedTxn))];

  switch (entity) {
    case 'Invoice':
    case 'Estimate':
    case 'SalesReceipt':
    case 'CreditMemo':
    case 'RefundReceipt':
    case 'PurchaseOrder':
    case 'Bill':
    case 'Purchase':
      base.lines = lines.map(lineFrom);
      base.status =
        o.TxnStatus || o.POStatus || (typeof o.Balance === 'number' ? (o.Balance > 0 ? 'open' : 'paid') : undefined);
      base.account = o.DepositToAccountRef?.name ?? o.AccountRef?.name ?? o.APAccountRef?.name;
      break;
    case 'Payment':
      base.reference = o.PaymentRefNum || o.DocNumber;
      base.account = o.DepositToAccountRef?.name;
      base.balance = o.UnappliedAmt;
      base.lines = lines.map(lineFrom);
      break;
    case 'Deposit':
      base.account = o.DepositToAccountRef?.name;
      base.lines = lines.map((l: Json) => ({
        ...lineFrom(l),
        item_name: l.DepositLineDetail?.Entity?.name ?? l.DepositLineDetail?.AccountRef?.name,
      }));
      break;
    case 'BillPayment':
      base.account = o.CheckPayment?.BankAccountRef?.name ?? o.CreditCardPayment?.CCAccountRef?.name;
      base.lines = lines.map(lineFrom);
      break;
    case 'Transfer':
      base.amount = o.Amount;
      base.account = o.ToAccountRef?.name;
      base.memo = [`${o.FromAccountRef?.name ?? '?'} → ${o.ToAccountRef?.name ?? '?'}`, o.PrivateNote].filter(Boolean).join(' · ');
      break;
    case 'JournalEntry':
      base.lines = lines.map((l: Json) => ({
        ...lineFrom(l),
        description: [l.JournalEntryLineDetail?.PostingType, l.Description].filter(Boolean).join(': '),
      }));
      base.amount = lines
        .filter((l: Json) => l.JournalEntryLineDetail?.PostingType === 'Debit')
        .reduce((s: number, l: Json) => s + (l.Amount || 0), 0);
      break;
    case 'Item':
      base.name = o.FullyQualifiedName || o.Name;
      base.reference = o.Sku;
      base.amount = o.UnitPrice;
      base.memo = o.Description;
      base.status = o.Active === false ? 'inactive' : o.Type;
      base.date = o.MetaData?.CreateTime?.slice(0, 10);
      break;
    case 'Customer':
    case 'Vendor':
      base.name = o.DisplayName;
      base.counterparty = o.CompanyName || o.DisplayName;
      base.reference = o.PrimaryEmailAddr?.Address;
      base.amount = o.Balance;
      base.status = o.Active === false ? 'inactive' : 'active';
      base.date = o.MetaData?.CreateTime?.slice(0, 10);
      break;
  }
  base.linked = linked;
  for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k];
  return base;
}

// ---------------------------------------------------------------- upsert

async function existingByExternalId(svc: Json, connectionId: string, recordType: string, ids: string[]) {
  const out = new Map<string, Json>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = await svc.LedgerRecord.filter(
      { source: 'quickbooks', connection_id: connectionId, record_type: recordType, external_id: chunk },
      '-created_date',
      chunk.length,
      0,
      ['id', 'external_id', 'version'],
    );
    for (const r of rows) out.set(r.external_id, r);
  }
  return out;
}

Deno.serve(async (req) => {
  let batch: Json = null;
  let svc: Json = null;
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    svc = base44.asServiceRole.entities;

    const { connection_id, entity, since } = await req.json();
    if (!ENTITIES[entity]) return Response.json({ error: `Unsupported entity ${entity}` }, { status: 400 });
    if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
      return Response.json({ error: 'since must be YYYY-MM-DD' }, { status: 400 });
    }
    const connection = await svc.QuickBooksConnection.get(connection_id);
    if (!connection || connection.status === 'disconnected') {
      return Response.json({ error: 'Connection not found or disconnected' }, { status: 404 });
    }
    const recordType = ENTITIES[entity];

    batch = await svc.ImportBatch.create({
      source: 'quickbooks',
      record_type: recordType,
      connection_id,
      status: 'running',
      started_at: new Date().toISOString(),
    });

    const accessToken = await getAccessToken(svc, connection);
    const where = since ? ` WHERE MetaData.LastUpdatedTime >= '${since}T00:00:00Z'` : '';
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (let start = 1; ; start += PAGE_SIZE) {
      const resp = await query(connection, accessToken, `SELECT * FROM ${entity}${where} STARTPOSITION ${start} MAXRESULTS ${PAGE_SIZE}`);
      const rows: Json[] = resp[entity] || [];
      if (!rows.length) break;

      const existing = await existingByExternalId(svc, connection_id, recordType, rows.map((r) => String(r.Id)));
      const toCreate: Json[] = [];
      const toUpdate: Json[] = [];
      for (const row of rows) {
        const rec = { ...normalize(entity, row), connection_id, import_batch_id: batch.id };
        const prev = existing.get(rec.external_id);
        if (!prev) toCreate.push({ ...rec, match_status: 'unmatched' });
        else if (prev.version !== rec.version) toUpdate.push({ id: prev.id, ...rec });
        else skipped++;
      }
      for (let i = 0; i < toCreate.length; i += 200) await svc.LedgerRecord.bulkCreate(toCreate.slice(i, i + 200));
      if (toUpdate.length) {
        if (typeof svc.LedgerRecord.bulkUpdate === 'function') {
          for (let i = 0; i < toUpdate.length; i += 200) await svc.LedgerRecord.bulkUpdate(toUpdate.slice(i, i + 200));
        } else {
          for (const { id, ...data } of toUpdate) await svc.LedgerRecord.update(id, data);
        }
      }
      created += toCreate.length;
      updated += toUpdate.length;
      if (rows.length < PAGE_SIZE) break;
    }

    const summary = { entity, record_type: recordType, created, updated, skipped };
    await svc.ImportBatch.update(batch.id, {
      status: 'completed',
      created_count: created,
      updated_count: updated,
      skipped_count: skipped,
      finished_at: new Date().toISOString(),
    });
    await svc.QuickBooksConnection.update(connection_id, {
      last_sync_at: new Date().toISOString(),
      last_sync_summary: { ...(connection.last_sync_summary || {}), [entity]: summary },
    });
    return Response.json(summary);
  } catch (error) {
    const message = (error as Error).message;
    if (batch && svc) {
      await svc.ImportBatch.update(batch.id, { status: 'failed', error: message, finished_at: new Date().toISOString() }).catch(() => {});
    }
    return Response.json({ error: message }, { status: 500 });
  }
});
