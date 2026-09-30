import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { Link } from 'react-router-dom';
import { ImportTemplate } from '@/api/entities';
import { Alert, Button, Card, Field, Select, Table, fmtMoney, inputClass } from '@/components/ui';
import { MAPPABLE_FIELDS, guessMapping, rowsToRecords } from '@/lib/csvImport';
import { useAsync, useRecordTypes } from '@/lib/hooks';
import { upsertRecords } from '@/lib/services';

export default function ImportCsv() {
  const { types } = useRecordTypes();
  const importable = types.filter((t) => !t.native);
  const { data: templates = [], reload: reloadTemplates } = useAsync(() => ImportTemplate.list('name', 500), []);

  const [recordType, setRecordType] = useState('sales_order');
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [map, setMap] = useState({});
  const [dateFormat, setDateFormat] = useState('auto');
  const [group, setGroup] = useState(false);
  const [negate, setNegate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const typeInfo = types.find((t) => t.key === recordType);

  function onFile(f) {
    setResult(null);
    setFile(f);
    if (!f) return;
    Papa.parse(f, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: ({ data, meta }) => {
        setHeaders(meta.fields || []);
        setRows(data);
        const fields = meta.fields || [];
        const cols = Object.values(map).filter(Boolean);
        // Keep a mapping (e.g. from a saved template) when the new file has all its columns.
        if (cols.length && cols.every((c) => fields.includes(c))) return;
        const withLines = Boolean(typeInfo?.has_lines);
        setGroup(withLines);
        setMap(guessMapping(fields, { withLines }));
      },
    });
  }

  function applyTemplate(id) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setRecordType(t.record_type);
    setMap(t.column_map || {});
    setDateFormat(t.date_format || 'auto');
    setGroup(Boolean(t.group_by_reference));
    setNegate(Boolean(t.negate_amounts));
    setTemplateName(t.name);
  }

  const preview = useMemo(
    () =>
      rows.length
        ? rowsToRecords(rows, { record_type: recordType, column_map: map, date_format: dateFormat, group_by_reference: group, negate_amounts: negate })
        : { records: [], errors: [] },
    [rows, recordType, map, dateFormat, group, negate],
  );

  async function saveTemplate() {
    const data = { name: templateName, record_type: recordType, column_map: map, date_format: dateFormat, group_by_reference: group, negate_amounts: negate };
    const existing = templates.find((t) => t.name === templateName);
    if (existing) await ImportTemplate.update(existing.id, data);
    else await ImportTemplate.create(data);
    reloadTemplates();
  }

  async function runImport() {
    setBusy(true);
    setResult(null);
    try {
      const batch = await upsertRecords(preview.records, { record_type: recordType, file_name: file?.name });
      setResult({ tone: 'success', batch });
    } catch (e) {
      setResult({ tone: 'error', text: e.message });
    }
    setBusy(false);
  }

  const fieldOptions = MAPPABLE_FIELDS.filter((f) => group || !f.line || typeInfo?.has_lines);
  const headerOptions = headers.map((h) => ({ value: h, label: h }));

  return (
    <div className="space-y-6">
      <Card title="Import records from outside QuickBooks">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Record type" hint={typeInfo?.description}>
            <Select value={recordType} onChange={setRecordType} options={importable.map((t) => ({ value: t.key, label: t.label }))} />
          </Field>
          <Field label="Saved mapping">
            <Select
              value=""
              onChange={applyTemplate}
              placeholder={templates.length ? 'Apply a saved mapping…' : 'None saved yet'}
              options={templates.map((t) => ({ value: t.id, label: `${t.name} (${t.record_type})` }))}
            />
          </Field>
          <Field label="CSV file">
            <input type="file" accept=".csv,text/csv" className="text-sm" onChange={(e) => onFile(e.target.files?.[0] || null)} />
          </Field>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Need a type that isn't listed (e.g. layaway, retainer, consignment)? <Link to="/record-types" className="underline">Add a record type</Link>.
          Re-importing the same file updates existing records instead of duplicating them.
        </p>
      </Card>

      {headers.length > 0 && (
        <Card title={`Map columns · ${rows.length} rows`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {fieldOptions.map((f) => (
              <Field key={f.key} label={f.label}>
                <Select value={map[f.key]} onChange={(v) => setMap((m) => ({ ...m, [f.key]: v || undefined }))} placeholder="—" options={headerOptions} />
              </Field>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <Field label="Date format">
              <Select
                value={dateFormat}
                onChange={setDateFormat}
                options={[
                  { value: 'auto', label: 'Auto-detect' },
                  { value: 'MDY', label: 'MM/DD/YYYY' },
                  { value: 'DMY', label: 'DD/MM/YYYY' },
                  { value: 'YMD', label: 'YYYY-MM-DD' },
                ]}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} />
              One row per line item (group rows by reference)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={negate} onChange={(e) => setNegate(e.target.checked)} />
              Flip amount sign
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <Field label="Save this mapping as">
              <input className={inputClass} value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. Chase checking export" />
            </Field>
            <Button variant="secondary" onClick={saveTemplate} disabled={!templateName}>
              Save mapping
            </Button>
          </div>
        </Card>
      )}

      {preview.records.length > 0 && (
        <Card
          title={`Preview · ${preview.records.length} records`}
          actions={
            <Button onClick={runImport} disabled={busy}>
              {busy ? 'Importing…' : `Import ${preview.records.length} records`}
            </Button>
          }
        >
          {preview.errors.length > 0 && (
            <div className="mb-3">
              <Alert tone="warn">
                {preview.errors.slice(0, 5).map((e) => (
                  <div key={`${e.row}-${e.message}`}>
                    Row {e.row}: {e.message}
                  </div>
                ))}
                {preview.errors.length > 5 && <div>…and {preview.errors.length - 5} more</div>}
              </Alert>
            </div>
          )}
          {result && (
            <div className="mb-3">
              <Alert tone={result.tone}>
                {result.batch ? (
                  <>
                    Imported: {result.batch.created_count} new, {result.batch.updated_count} updated.{' '}
                    <Link className="underline" to={`/records?type=${recordType}`}>View records</Link> ·{' '}
                    <Link className="underline" to="/matching">Run matching</Link>
                  </>
                ) : (
                  result.text
                )}
              </Alert>
            </div>
          )}
          <Table
            rowKey={(r) => r.external_id}
            columns={[
              { key: 'reference', label: 'Reference' },
              { key: 'date', label: 'Date' },
              { key: 'counterparty', label: 'Customer / Payee' },
              { key: 'name', label: 'Name' },
              { key: 'memo', label: 'Memo', render: (r) => <span className="block max-w-xs truncate">{r.memo}</span> },
              { key: 'lines', label: 'Lines', align: 'right', render: (r) => r.lines?.length || '' },
              { key: 'amount', label: 'Amount', align: 'right', render: (r) => fmtMoney(r.amount) },
            ]}
            rows={preview.records.slice(0, 50)}
          />
          {preview.records.length > 50 && <p className="mt-2 text-xs text-slate-500">Showing first 50.</p>}
        </Card>
      )}
    </div>
  );
}
