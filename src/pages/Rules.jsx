import { useState } from 'react';
import { MatchRule } from '@/api/entities';
import { Alert, Badge, Button, Card, Field, Select, inputClass } from '@/components/ui';
import { useAsync, useRecordTypes } from '@/lib/hooks';
import { CRITERIA_KEYS } from '@/lib/matching';
import { typeLabel } from '@/lib/recordTypes';
import { ensureDefaultRules } from '@/lib/services';

const CRITERIA_HELP = {
  amount: 'Totals equal within tolerance',
  date: 'Dates within N days',
  reference: 'Doc numbers equal, or one appears in the other’s memo',
  counterparty: 'Customer / payee names similar',
  name: 'Item / record names similar',
  lines: 'Line items share SKUs and quantities',
};

const BLANK = {
  name: '',
  source_type: '',
  target_type: '',
  mode: 'one_to_one',
  min_score: 0.6,
  auto_confirm_score: 0,
  max_group_size: 6,
  active: true,
  criteria: { amount: { weight: 2, tolerance_abs: 0.01 }, date: { weight: 1, window_days: 7 } },
};

export default function Rules() {
  const { types } = useRecordTypes();
  const { data: rules = [], reload, error } = useAsync(ensureDefaultRules, []);
  const [editing, setEditing] = useState(null);

  async function save(rule) {
    const { id, created_date, updated_date, created_by, ...data } = rule;
    if (id) await MatchRule.update(id, data);
    else await MatchRule.create(data);
    setEditing(null);
    reload();
  }

  async function remove(rule) {
    if (!confirm(`Delete rule "${rule.name}"? Existing matches are kept.`)) return;
    await MatchRule.delete(rule.id);
    reload();
  }

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error.message}</Alert>}
      <Card title="Matching rules" actions={<Button onClick={() => setEditing({ ...BLANK })}>New rule</Button>}>
        <div className="divide-y divide-slate-100">
          {[...rules].sort((a, b) => a.name.localeCompare(b.name)).map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <div className="min-w-[16rem] flex-1">
                <div className="font-medium">
                  {r.name} {r.active === false && <Badge>inactive</Badge>} {r.mode === 'one_to_many' && <Badge tone="blue">groups</Badge>}
                </div>
                <div className="text-xs text-slate-500">
                  {typeLabel(r.source_type, types)} → {typeLabel(r.target_type, types)} · min {Math.round((r.min_score ?? 0.6) * 100)}%
                  {r.auto_confirm_score > 0 && ` · auto-confirm ≥ ${Math.round(r.auto_confirm_score * 100)}%`}
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setEditing(structuredClone(r))}>Edit</Button>
              <Button size="sm" variant="danger" onClick={() => remove(r)}>Delete</Button>
            </div>
          ))}
        </div>
      </Card>
      {editing && <RuleEditor rule={editing} types={types} onCancel={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function RuleEditor({ rule: initial, types, onCancel, onSave }) {
  const [rule, setRule] = useState(initial);
  const set = (k, v) => setRule((r) => ({ ...r, [k]: v }));
  const setCrit = (key, field, value) =>
    setRule((r) => ({ ...r, criteria: { ...r.criteria, [key]: { ...(r.criteria?.[key] || {}), [field]: value } } }));
  const typeOptions = types.map((t) => ({ value: t.key, label: t.label }));
  const num = (v) => (v === '' ? undefined : Number(v));

  return (
    <Card
      title={rule.id ? `Edit: ${initial.name}` : 'New rule'}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button disabled={!rule.name || !rule.source_type || !rule.target_type} onClick={() => onSave(rule)}>Save</Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Name">
          <input className={inputClass} value={rule.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Match records of type">
          <Select value={rule.source_type} onChange={(v) => set('source_type', v)} placeholder="Choose…" options={typeOptions} />
        </Field>
        <Field label="To records of type">
          <Select value={rule.target_type} onChange={(v) => set('target_type', v)} placeholder="Choose…" options={typeOptions} />
        </Field>
        <Field label="Mode" hint="Grouped: one record can equal the sum of several targets (bank deposit = several payments).">
          <Select
            value={rule.mode}
            onChange={(v) => set('mode', v)}
            options={[
              { value: 'one_to_one', label: 'One to one' },
              { value: 'one_to_many', label: 'One to many (grouped)' },
            ]}
          />
        </Field>
        <Field label="Minimum score (0–1)">
          <input type="number" step="0.05" min="0" max="1" className={inputClass} value={rule.min_score ?? ''} onChange={(e) => set('min_score', num(e.target.value))} />
        </Field>
        <Field label="Auto-confirm at score (0 = never)">
          <input type="number" step="0.01" min="0" max="1" className={inputClass} value={rule.auto_confirm_score ?? 0} onChange={(e) => set('auto_confirm_score', num(e.target.value))} />
        </Field>
        {rule.mode === 'one_to_many' && (
          <>
            <Field label="Max records per group">
              <input type="number" min="2" max="12" className={inputClass} value={rule.max_group_size ?? 6} onChange={(e) => set('max_group_size', num(e.target.value))} />
            </Field>
            <Field label="Skip targets already linked from" hint="e.g. QBO Deposit: ignore payments QuickBooks already deposited.">
              <Select value={rule.skip_targets_linked_from} onChange={(v) => set('skip_targets_linked_from', v || undefined)} placeholder="—" options={typeOptions} />
            </Field>
            <label className="flex items-center gap-2 self-end text-sm">
              <input type="checkbox" checked={Boolean(rule.same_counterparty_for_groups)} onChange={(e) => set('same_counterparty_for_groups', e.target.checked)} />
              Grouped records must share the customer
            </label>
          </>
        )}
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={rule.active !== false} onChange={(e) => set('active', e.target.checked)} />
          Active
        </label>
      </div>

      <div className="mt-6">
        <div className="mb-2 text-sm font-medium text-slate-700">Criteria</div>
        <div className="space-y-2">
          {CRITERIA_KEYS.map((key) => {
            const c = rule.criteria?.[key] || {};
            return (
              <div key={key} className="grid items-center gap-2 rounded border border-slate-200 p-2 text-sm md:grid-cols-[10rem_6rem_6rem_1fr]">
                <div>
                  <div className="font-medium capitalize">{key}</div>
                  <div className="text-xs text-slate-500">{CRITERIA_HELP[key]}</div>
                </div>
                <label className="text-xs">
                  Weight
                  <input type="number" step="0.5" min="0" className={inputClass} value={c.weight ?? 0} onChange={(e) => setCrit(key, 'weight', num(e.target.value) ?? 0)} />
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={Boolean(c.required)} onChange={(e) => setCrit(key, 'required', e.target.checked)} />
                  Required
                </label>
                <div className="flex flex-wrap gap-2">
                  {key === 'amount' && (
                    <>
                      <label className="text-xs">
                        Tolerance $
                        <input type="number" step="0.01" className={`${inputClass} w-24`} value={c.tolerance_abs ?? 0.01} onChange={(e) => setCrit(key, 'tolerance_abs', num(e.target.value))} />
                      </label>
                      <label className="text-xs">
                        Tolerance %
                        <input
                          type="number"
                          step="0.5"
                          className={`${inputClass} w-24`}
                          value={(c.tolerance_pct ?? 0) * 100}
                          onChange={(e) => setCrit(key, 'tolerance_pct', (num(e.target.value) ?? 0) / 100)}
                        />
                      </label>
                    </>
                  )}
                  {key === 'date' && (
                    <label className="text-xs">
                      Window (days)
                      <input type="number" min="0" className={`${inputClass} w-24`} value={c.window_days ?? 7} onChange={(e) => setCrit(key, 'window_days', num(e.target.value))} />
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
