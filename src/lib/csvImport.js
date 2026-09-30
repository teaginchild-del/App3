// Turn CSV rows into normalized LedgerRecord payloads for objects that live
// outside QuickBooks (sales orders, bank deposits, customer deposits, custom).

export const MAPPABLE_FIELDS = [
  { key: 'reference', label: 'Reference / Doc #', hints: ['reference', 'ref', 'number', 'no', 'doc', 'order', 'so', 'invoice', 'check', 'sku'] },
  { key: 'external_id', label: 'Unique ID', hints: ['id', 'transaction id', 'txn id', 'fitid', 'uuid'] },
  { key: 'date', label: 'Date', hints: ['date', 'posted', 'txn date', 'transaction date', 'order date'] },
  { key: 'amount', label: 'Amount (signed)', hints: ['amount', 'total', 'net', 'value'] },
  { key: 'debit', label: 'Debit / Withdrawal', hints: ['debit', 'withdrawal', 'money out', 'paid out'] },
  { key: 'credit', label: 'Credit / Deposit', hints: ['credit', 'deposit', 'money in', 'paid in'] },
  { key: 'counterparty', label: 'Customer / Payee', hints: ['customer', 'payee', 'client', 'vendor', 'name', 'bill to', 'payer'] },
  { key: 'name', label: 'Name (items)', hints: ['item name', 'product', 'title'] },
  { key: 'memo', label: 'Memo / Description', hints: ['memo', 'description', 'details', 'narrative', 'note'] },
  { key: 'account', label: 'Account', hints: ['account', 'bank'] },
  { key: 'currency', label: 'Currency', hints: ['currency', 'ccy'] },
  { key: 'status', label: 'Status', hints: ['status', 'state'] },
  { key: 'due_date', label: 'Due date', hints: ['due'] },
  // Line-item columns (used when rows are grouped by reference)
  { key: 'line_item_name', label: 'Line: item name', hints: ['item', 'product', 'line item'], line: true },
  { key: 'line_sku', label: 'Line: SKU', hints: ['sku', 'part', 'item code'], line: true },
  { key: 'line_description', label: 'Line: description', hints: ['line description'], line: true },
  { key: 'line_quantity', label: 'Line: quantity', hints: ['qty', 'quantity'], line: true },
  { key: 'line_unit_price', label: 'Line: unit price', hints: ['unit price', 'rate', 'price'], line: true },
  { key: 'line_amount', label: 'Line: amount', hints: ['line total', 'line amount', 'extended'], line: true },
];

function norm(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Guess a column for each field from header names. Each column is used once. */
export function guessMapping(headers, { withLines = false } = {}) {
  const map = {};
  const taken = new Set();
  const fields = MAPPABLE_FIELDS.filter((f) => withLines || !f.line);
  // Exact matches first, then "contains" matches.
  for (const pass of ['exact', 'contains']) {
    for (const f of fields) {
      if (map[f.key]) continue;
      const col = headers.find((h) => {
        if (taken.has(h)) return false;
        const nh = norm(h);
        return f.hints.some((hint) => (pass === 'exact' ? nh === hint : nh.includes(hint)));
      });
      if (col) {
        map[f.key] = col;
        taken.add(col);
      }
    }
  }
  return map;
}

/** "$1,234.50", "(12.00)", "12.00-", "1.234,50" (EU) → number or null. */
export function parseAmount(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    neg = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  }
  s = s.replace(/[^\d.,]/g, '');
  // European format: comma is the decimal separator when it comes last with 1-2 digits after it.
  if (/,\d{1,2}$/.test(s) && (s.includes('.') || !/,\d{3}/.test(s))) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!s || s === '.') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function pad(n) {
  return String(n).padStart(2, '0');
}

function iso(y, m, d) {
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Parse common bank/ERP date formats to YYYY-MM-DD. format: auto | MDY | DMY | YMD */
export function parseDateString(v, format = 'auto') {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    if (format === 'DMY' || (format === 'auto' && a > 12)) return iso(y, b, a);
    return iso(y, a, b);
  }
  // "Mar 5, 2026" / "5 Mar 2026"
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})/i.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  // 20260305
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  return null;
}

/** Stable short hash (FNV-1a) for rows without a unique id. */
export function hashRow(obj) {
  const str = JSON.stringify(obj);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function cell(row, col) {
  if (!col) return undefined;
  const v = row[col];
  return typeof v === 'string' ? v.trim() : v;
}

function rowAmount(row, map, negate) {
  let amount = parseAmount(cell(row, map.amount));
  if (amount == null && (map.debit || map.credit)) {
    const credit = parseAmount(cell(row, map.credit)) || 0;
    const debit = parseAmount(cell(row, map.debit)) || 0;
    if (credit || debit) amount = Math.abs(credit) - Math.abs(debit);
  }
  if (amount != null && negate) amount = -amount;
  return amount;
}

function rowLine(row, map) {
  const line = {
    item_name: cell(row, map.line_item_name) || undefined,
    sku: cell(row, map.line_sku) || undefined,
    description: cell(row, map.line_description) || undefined,
    quantity: parseAmount(cell(row, map.line_quantity)) ?? undefined,
    unit_price: parseAmount(cell(row, map.line_unit_price)) ?? undefined,
    amount: parseAmount(cell(row, map.line_amount)) ?? undefined,
  };
  if (line.amount == null && line.quantity != null && line.unit_price != null) {
    line.amount = Math.round(line.quantity * line.unit_price * 100) / 100;
  }
  return Object.values(line).some((v) => v != null) ? line : null;
}

/**
 * Build LedgerRecord payloads from parsed CSV rows.
 *
 * options:
 *   record_type, column_map, date_format, group_by_reference, negate_amounts
 * returns { records, errors: [{ row, message }] }
 */
export function rowsToRecords(rows, options) {
  const {
    record_type,
    column_map: map = {},
    date_format = 'auto',
    group_by_reference = false,
    negate_amounts = false,
  } = options;
  const errors = [];
  const mappedCols = new Set(Object.values(map).filter(Boolean));

  const base = (row, index) => {
    const date = parseDateString(cell(row, map.date), date_format);
    if (map.date && cell(row, map.date) && !date) errors.push({ row: index + 1, message: `Unrecognized date "${cell(row, map.date)}"` });
    const extra = {};
    for (const [k, v] of Object.entries(row)) if (!mappedCols.has(k) && v !== '' && v != null) extra[k] = v;
    return {
      record_type,
      source: 'csv',
      reference: cell(row, map.reference) || undefined,
      name: cell(row, map.name) || undefined,
      date: date || undefined,
      due_date: parseDateString(cell(row, map.due_date), date_format) || undefined,
      amount: rowAmount(row, map, negate_amounts) ?? undefined,
      currency: cell(row, map.currency) || undefined,
      counterparty: cell(row, map.counterparty) || undefined,
      account: cell(row, map.account) || undefined,
      memo: cell(row, map.memo) || undefined,
      status: cell(row, map.status) || undefined,
      match_status: 'unmatched',
      extra,
      raw: row,
    };
  };

  const isBlank = (row) => Object.values(row).every((v) => v == null || String(v).trim() === '');

  if (!group_by_reference) {
    const records = [];
    rows.forEach((row, i) => {
      if (isBlank(row)) return;
      const rec = base(row, i);
      const line = rowLine(row, map);
      if (line) rec.lines = [line];
      // Without a unique id column, hash the row so re-importing the same file is idempotent.
      rec.external_id = cell(row, map.external_id) || `row:${hashRow(row)}`;
      if (rec.amount == null && rec.lines?.length) rec.amount = rec.lines[0].amount;
      records.push(rec);
    });
    return { records, errors };
  }

  // One row per line item, rows sharing a reference form one document.
  const groups = new Map();
  rows.forEach((row, i) => {
    if (isBlank(row)) return;
    const ref = cell(row, map.reference);
    if (!ref) {
      errors.push({ row: i + 1, message: 'Missing reference; row skipped' });
      return;
    }
    if (!groups.has(ref)) groups.set(ref, { rec: base(row, i), rows: [], lines: [] });
    const g = groups.get(ref);
    g.rows.push(row);
    const line = rowLine(row, map);
    if (line) g.lines.push(line);
  });
  const records = [];
  for (const [ref, g] of groups) {
    const rec = g.rec;
    rec.external_id = cell(g.rows[0], map.external_id) || `ref:${ref}`;
    rec.lines = g.lines;
    rec.raw = { rows: g.rows };
    const linesTotal = g.lines.reduce((s, l) => s + (l.amount || 0), 0);
    // A document total column repeats on every row; only fall back to summing lines when it is absent.
    if (rec.amount == null && g.lines.length) rec.amount = Math.round(linesTotal * 100) / 100;
    records.push(rec);
  }
  return { records, errors };
}
