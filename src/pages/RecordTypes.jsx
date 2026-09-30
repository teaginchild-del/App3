import { useState } from 'react';
import { RecordType } from '@/api/entities';
import { Alert, Badge, Button, Card, Field, Select, Table, inputClass } from '@/components/ui';
import { useRecordTypes } from '@/lib/hooks';
import { toTypeKey } from '@/lib/recordTypes';

const CATEGORIES = ['sales', 'purchasing', 'payments', 'banking', 'items', 'contacts', 'other'].map((c) => ({ value: c, label: c }));

export default function RecordTypes() {
  const { types, reload } = useRecordTypes();
  const [form, setForm] = useState({ label: '', description: '', category: 'other', has_lines: false });
  const [error, setError] = useState(null);

  async function add() {
    const key = toTypeKey(form.label);
    if (!key) return;
    if (types.some((t) => t.key === key)) return setError(`A type with key "${key}" already exists.`);
    setError(null);
    await RecordType.create({ ...form, key });
    setForm({ label: '', description: '', category: 'other', has_lines: false });
    reload();
  }

  async function remove(t) {
    if (!confirm(`Delete type "${t.label}"? Records of this type are kept.`)) return;
    await RecordType.delete(t.id);
    reload();
  }

  return (
    <div className="space-y-6">
      <Card title="Add a record type" actions={<Button disabled={!form.label} onClick={add}>Add type</Button>}>
        <p className="mb-3 text-sm text-slate-600">
          For objects QuickBooks doesn't have — work orders, layaway plans, retainers, marketplace settlements, anything
          you can export to CSV. Once added, import it on the Import page and create matching rules for it.
        </p>
        {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Label" hint={form.label && `key: ${toTypeKey(form.label)}`}>
            <input className={inputClass} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </Field>
          <Field label="Category">
            <Select value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={CATEGORIES} />
          </Field>
          <Field label="Description">
            <input className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="checkbox" checked={form.has_lines} onChange={(e) => setForm({ ...form, has_lines: e.target.checked })} />
            Has line items
          </label>
        </div>
      </Card>

      <Card title="All record types">
        <Table
          rowKey={(t) => t.key}
          columns={[
            { key: 'label', label: 'Type' },
            { key: 'key', label: 'Key', render: (t) => <code className="text-xs">{t.key}</code> },
            { key: 'category', label: 'Category' },
            { key: 'native', label: 'Source', render: (t) => (t.native ? <Badge tone="blue">QuickBooks</Badge> : t.custom ? <Badge tone="amber">custom</Badge> : <Badge>external</Badge>) },
            { key: 'description', label: 'Description', render: (t) => <span className="block max-w-md whitespace-normal text-xs text-slate-600">{t.description}</span> },
            { key: 'actions', label: '', render: (t) => t.custom && <Button size="sm" variant="danger" onClick={() => remove(t)}>Delete</Button> },
          ]}
          rows={types}
        />
      </Card>
    </div>
  );
}
