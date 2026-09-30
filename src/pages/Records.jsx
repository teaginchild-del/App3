import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LedgerRecord, Match, listAll } from '@/api/entities';
import { Alert, Badge, Button, Card, Empty, Field, ScoreBadge, Select, StatusBadge, Table, fmtMoney, inputClass } from '@/components/ui';
import { useAsync, useRecordTypes } from '@/lib/hooks';
import { matchChain } from '@/lib/matching';
import { recordLabel, typeLabel } from '@/lib/recordTypes';
import { deleteMatch, refreshMatchStatus } from '@/lib/services';

const PAGE = 100;

export default function Records() {
  const { types } = useRecordTypes();
  const [params, setParams] = useSearchParams();
  const type = params.get('type') || '';
  const status = params.get('status') || '';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [records, matches] = await Promise.all([listAll(LedgerRecord, {}, '-date'), listAll(Match)]);
    return { records, matches, byId: new Map(records.map((r) => [r.id, r])) };
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.records.filter(
      (r) =>
        (!type || r.record_type === type) &&
        (!status || (r.match_status || 'unmatched') === status) &&
        (!q || [r.reference, r.name, r.counterparty, r.memo, r.external_id, String(r.amount ?? '')].some((v) => v && String(v).toLowerCase().includes(q))),
    );
  }, [data, type, status, search]);

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next);
    setPage(0);
  };

  if (error) return <Alert tone="error">{error.message}</Alert>;
  const selected = selectedId && data?.byId.get(selectedId);
  const presentTypes = [...new Set((data?.records || []).map((r) => r.record_type))];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
      <Card title={`Records · ${filtered.length}`}>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Field label="Type">
            <Select value={type} onChange={(v) => setParam('type', v)} placeholder="All types" options={presentTypes.map((t) => ({ value: t, label: typeLabel(t, types) }))} />
          </Field>
          <Field label="Match status">
            <Select
              value={status}
              onChange={(v) => setParam('status', v)}
              placeholder="Any"
              options={['unmatched', 'suggested', 'matched'].map((s) => ({ value: s, label: s }))}
            />
          </Field>
          <Field label="Search">
            <input className={inputClass} value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Ref, name, memo, amount" />
          </Field>
        </div>
        {loading && !data ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : filtered.length ? (
          <>
            <Table
              selectedKey={selectedId}
              onRowClick={(r) => setSelectedId(r.id)}
              columns={[
                { key: 'record_type', label: 'Type', render: (r) => typeLabel(r.record_type, types) },
                { key: 'reference', label: 'Ref / Name', render: (r) => r.reference || r.name },
                { key: 'date', label: 'Date' },
                { key: 'counterparty', label: 'Customer / Payee', render: (r) => <span className="block max-w-[14rem] truncate">{r.counterparty}</span> },
                { key: 'amount', label: 'Amount', align: 'right', render: (r) => fmtMoney(r.amount) },
                { key: 'match_status', label: 'Status', render: (r) => <StatusBadge status={r.match_status} /> },
              ]}
              rows={filtered.slice(page * PAGE, (page + 1) * PAGE)}
            />
            <div className="mt-3 flex items-center justify-end gap-2 text-sm">
              <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</Button>
              <span>
                {page + 1} / {Math.max(1, Math.ceil(filtered.length / PAGE))}
              </span>
              <Button variant="secondary" size="sm" disabled={(page + 1) * PAGE >= filtered.length} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </>
        ) : (
          <Empty>No records match.</Empty>
        )}
      </Card>

      <div className="space-y-4">
        {selected ? (
          <RecordDetail record={selected} data={data} types={types} onSelect={setSelectedId} onChanged={reload} />
        ) : (
          <Card title="Details">
            <Empty>Select a record to see its fields, line items and everything it is matched to.</Empty>
          </Card>
        )}
      </div>
    </div>
  );
}

function RecordDetail({ record, data, types, onSelect, onChanged }) {
  const [showRaw, setShowRaw] = useState(false);
  const chain = matchChain(record.id, data.matches);
  const chainRecords = chain.recordIds.filter((id) => id !== record.id).map((id) => data.byId.get(id)).filter(Boolean);

  async function unlink(m) {
    await deleteMatch(m);
    onChanged();
  }

  async function remove() {
    if (!confirm('Delete this record and its matches?')) return;
    for (const m of data.matches.filter((m) => m.source_ids.includes(record.id) || m.target_ids.includes(record.id))) await Match.delete(m.id);
    await LedgerRecord.delete(record.id);
    const rest = data.records.filter((r) => r.id !== record.id);
    await refreshMatchStatus(rest, data.matches.filter((m) => !m.source_ids.includes(record.id) && !m.target_ids.includes(record.id)));
    onSelect(null);
    onChanged();
  }

  const direct = data.matches.filter((m) => m.status !== 'rejected' && (m.source_ids.includes(record.id) || m.target_ids.includes(record.id)));

  return (
    <>
      <Card
        title={`${typeLabel(record.record_type, types)} ${record.reference || record.name || ''}`}
        actions={record.source !== 'quickbooks' && <Button variant="danger" size="sm" onClick={remove}>Delete</Button>}
      >
        <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-sm">
          {[
            ['Source', record.source],
            ['External id', record.external_id],
            ['Date', record.date],
            ['Due', record.due_date],
            ['Amount', fmtMoney(record.amount)],
            ['Balance', record.balance != null ? fmtMoney(record.balance) : null],
            ['Customer / Payee', record.counterparty],
            ['Account', record.account],
            ['Memo', record.memo],
            ['Status', record.status],
          ]
            .filter(([, v]) => v != null && v !== '')
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
        </dl>
        {record.lines?.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Lines</div>
            <Table
              rowKey={(l) => JSON.stringify(l)}
              columns={[
                { key: 'item', label: 'Item', render: (l) => l.sku || l.item_name || l.description },
                { key: 'quantity', label: 'Qty', align: 'right' },
                { key: 'amount', label: 'Amount', align: 'right', render: (l) => fmtMoney(l.amount) },
              ]}
              rows={record.lines}
            />
          </div>
        )}
        <button className="mt-4 text-xs text-slate-500 underline" onClick={() => setShowRaw(!showRaw)}>
          {showRaw ? 'Hide' : 'Show'} original data
        </button>
        {showRaw && <pre className="mt-2 max-h-80 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(record.raw ?? record.extra, null, 2)}</pre>}
      </Card>

      <Card title="Matches">
        {direct.length ? (
          <ul className="space-y-2 text-sm">
            {direct.map((m) => {
              const others = [...m.source_ids, ...m.target_ids].filter((id) => id !== record.id).map((id) => data.byId.get(id)).filter(Boolean);
              return (
                <li key={m.id} className="rounded border border-slate-200 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={m.status} />
                    {m.method === 'quickbooks_link' ? <Badge tone="blue">QuickBooks link</Badge> : <ScoreBadge score={m.score} />}
                    {m.amount_difference ? <span className="text-xs text-amber-700">diff {fmtMoney(m.amount_difference)}</span> : null}
                    {m.method !== 'quickbooks_link' && (
                      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => unlink(m)}>Unlink</Button>
                    )}
                  </div>
                  {others.map((o) => (
                    <button key={o.id} className="mt-1 block text-left text-emerald-700 hover:underline" onClick={() => onSelect(o.id)}>
                      {typeLabel(o.record_type, types)}: {recordLabel(o)} · {fmtMoney(o.amount)}
                    </button>
                  ))}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>Not matched yet.</Empty>
        )}
        {chainRecords.length > direct.length && (
          <div className="mt-4">
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Full chain</div>
            <ul className="space-y-0.5 text-sm">
              {chainRecords
                .sort((a, b) => String(a.date).localeCompare(String(b.date)))
                .map((o) => (
                  <li key={o.id}>
                    <button className="text-left text-emerald-700 hover:underline" onClick={() => onSelect(o.id)}>
                      {o.date} · {typeLabel(o.record_type, types)}: {recordLabel(o)} · {fmtMoney(o.amount)}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </Card>
    </>
  );
}
