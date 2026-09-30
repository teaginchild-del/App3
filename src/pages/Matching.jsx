import { useMemo, useState } from 'react';
import { LedgerRecord, Match, listAll } from '@/api/entities';
import { Alert, Badge, Button, Card, Empty, Field, ScoreBadge, Select, fmtMoney, inputClass } from '@/components/ui';
import { useAsync, useCurrentUser, useRecordTypes } from '@/lib/hooks';
import { recordLabel, typeLabel } from '@/lib/recordTypes';
import { bulkSetMatchStatus, createManualMatch, ensureDefaultRules, runRuleAndSave, setMatchStatus } from '@/lib/services';

export default function Matching() {
  const { types } = useRecordTypes();
  const user = useCurrentUser();
  const [ruleId, setRuleId] = useState('');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [threshold, setThreshold] = useState(0.95);

  const { data, loading, error, reload } = useAsync(async () => {
    const [rules, records, matches] = await Promise.all([ensureDefaultRules(), listAll(LedgerRecord), listAll(Match)]);
    return { rules: rules.filter((r) => r.active !== false), records, matches, byId: new Map(records.map((r) => [r.id, r])) };
  }, []);

  const rule = data?.rules.find((r) => r.id === ruleId);
  const suggestions = useMemo(
    () => (data?.matches || []).filter((m) => m.status === 'suggested' && (!ruleId || m.rule_id === ruleId)).sort((a, b) => b.score - a.score),
    [data, ruleId],
  );

  async function run(rules) {
    setBusy(true);
    setMessage(null);
    try {
      const totals = { suggested: 0, autoConfirmed: 0, linked: 0 };
      for (const r of rules) {
        const res = await runRuleAndSave(r);
        totals.suggested += res.suggested;
        totals.autoConfirmed += res.autoConfirmed;
        totals.linked += res.linked;
      }
      setMessage({
        tone: 'success',
        text: `${totals.suggested} suggestions, ${totals.autoConfirmed} auto-confirmed, ${totals.linked} QuickBooks links added.`,
      });
    } catch (e) {
      setMessage({ tone: 'error', text: e.message });
    }
    setBusy(false);
    reload();
  }

  async function decide(m, status) {
    await setMatchStatus(m, status, user);
    reload();
  }

  async function confirmAbove() {
    const list = suggestions.filter((s) => s.score >= threshold);
    if (!list.length || !confirm(`Confirm ${list.length} suggestions scoring ≥ ${Math.round(threshold * 100)}%?`)) return;
    setBusy(true);
    await bulkSetMatchStatus(list, 'confirmed', user);
    setBusy(false);
    reload();
  }

  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (loading && !data) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <Card
        title="Run matching"
        actions={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => run(data.rules)}>Run all rules</Button>
            <Button disabled={busy || !rule} onClick={() => run([rule])}>{busy ? 'Running…' : 'Run selected rule'}</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Rule">
            <Select
              value={ruleId}
              onChange={setRuleId}
              placeholder="All rules"
              options={data.rules.map((r) => ({ value: r.id, label: r.name }))}
            />
          </Field>
          {rule && (
            <div className="text-sm text-slate-600">
              <div>
                {typeLabel(rule.source_type, types)} → {typeLabel(rule.target_type, types)}{' '}
                {rule.mode === 'one_to_many' && <Badge tone="blue">groups</Badge>}
              </div>
              <div className="text-xs text-slate-500">
                {Object.entries(rule.criteria || {})
                  .filter(([, c]) => c?.weight > 0)
                  .map(([k, c]) => `${k}×${c.weight}${c.required ? '*' : ''}`)
                  .join(' · ')}
              </div>
            </div>
          )}
        </div>
        {message && <div className="mt-3"><Alert tone={message.tone}>{message.text}</Alert></div>}
      </Card>

      <Card
        title={`Suggestions to review · ${suggestions.length}`}
        actions={
          suggestions.length > 0 && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                className={`${inputClass} w-20`}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
              <Button size="sm" disabled={busy} onClick={confirmAbove}>Confirm all ≥ {Math.round(threshold * 100)}%</Button>
            </div>
          )
        }
      >
        {suggestions.length ? (
          <div className="space-y-3">
            {suggestions.slice(0, 200).map((m) => (
              <SuggestionRow key={m.id} match={m} byId={data.byId} types={types} onDecide={decide} />
            ))}
            {suggestions.length > 200 && <p className="text-xs text-slate-500">Showing top 200.</p>}
          </div>
        ) : (
          <Empty>No open suggestions. Run a rule to generate some.</Empty>
        )}
      </Card>

      <ManualMatch records={data.records} types={types} user={user} onDone={reload} />
    </div>
  );
}

function RecordCell({ r, types }) {
  if (!r) return <div className="text-xs text-red-500">record missing</div>;
  return (
    <div className="text-sm">
      <div className="font-medium">{recordLabel(r)}</div>
      <div className="text-xs text-slate-500">
        {typeLabel(r.record_type, types)} · {r.date || 'no date'} · {fmtMoney(r.amount)}
        {r.memo && <span className="block max-w-sm truncate">{r.memo}</span>}
      </div>
    </div>
  );
}

function SuggestionRow({ match, byId, types, onDecide }) {
  const { alternatives, ...breakdown } = match.breakdown || {};
  return (
    <div className="grid gap-3 rounded-md border border-slate-200 p-3 md:grid-cols-[1fr_1fr_auto]">
      <div>{match.source_ids.map((id) => <RecordCell key={id} r={byId.get(id)} types={types} />)}</div>
      <div className="space-y-1">
        {match.target_ids.map((id) => <RecordCell key={id} r={byId.get(id)} types={types} />)}
        {alternatives?.length > 0 && (
          <div className="text-xs text-slate-500">
            Other candidates: {alternatives.map((a) => `${recordLabel(byId.get(a.target_ids[0]))} (${Math.round(a.score * 100)}%)`).join(', ')}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-2">
        <ScoreBadge score={match.score} />
        <div className="text-right text-xs text-slate-500">
          {Object.entries(breakdown).map(([k, v]) => (
            <div key={k}>
              {k}: {typeof v === 'number' && v <= 1 ? `${Math.round(v * 100)}%` : v}
            </div>
          ))}
          {match.amount_difference ? <div className="text-amber-700">diff {fmtMoney(match.amount_difference)}</div> : null}
        </div>
        <div className="flex gap-1">
          <Button size="sm" onClick={() => onDecide(match, 'confirmed')}>Confirm</Button>
          <Button size="sm" variant="secondary" onClick={() => onDecide(match, 'rejected')}>Reject</Button>
        </div>
      </div>
    </div>
  );
}

function ManualMatch({ records, types, user, onDone }) {
  const [leftType, setLeftType] = useState('');
  const [rightType, setRightType] = useState('');
  const [left, setLeft] = useState([]);
  const [right, setRight] = useState([]);
  const [note, setNote] = useState('');
  const present = [...new Set(records.map((r) => r.record_type))].map((t) => ({ value: t, label: typeLabel(t, types) }));
  const byId = new Map(records.map((r) => [r.id, r]));
  const sum = (ids) => ids.reduce((a, id) => a + Math.abs(byId.get(id)?.amount || 0), 0);

  async function save() {
    await createManualMatch({ sources: left.map((id) => byId.get(id)), targets: right.map((id) => byId.get(id)), note, user });
    setLeft([]);
    setRight([]);
    setNote('');
    onDone();
  }

  return (
    <Card title="Manual match" actions={<Button disabled={!left.length || !right.length} onClick={save}>Match selected</Button>}>
      <p className="mb-3 text-xs text-slate-500">
        Pick one or more records on each side, e.g. a bank deposit and the three payments it contains.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Picker label="Left" types={present} type={leftType} setType={setLeftType} records={records} selected={left} setSelected={setLeft} />
        <Picker label="Right" types={present} type={rightType} setType={setRightType} records={records} selected={right} setSelected={setRight} />
      </div>
      {(left.length > 0 || right.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <span>Left {fmtMoney(sum(left))}</span>
          <span>Right {fmtMoney(sum(right))}</span>
          <span className={Math.abs(sum(left) - sum(right)) < 0.01 ? 'text-emerald-700' : 'text-amber-700'}>
            Difference {fmtMoney(sum(left) - sum(right))}
          </span>
          <input className={`${inputClass} max-w-xs`} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
    </Card>
  );
}

function Picker({ label, types, type, setType, records, selected, setSelected }) {
  const [q, setQ] = useState('');
  const list = records
    .filter((r) => r.record_type === type && r.match_status !== 'matched')
    .filter((r) => !q || [r.reference, r.name, r.counterparty, r.memo, String(r.amount ?? '')].some((v) => v && String(v).toLowerCase().includes(q.toLowerCase())))
    .slice(0, 100);
  const toggle = (id) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Select value={type} onChange={(v) => { setType(v); setSelected([]); }} placeholder={`${label} type…`} options={types} />
        <input className={inputClass} placeholder="Search unmatched" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="max-h-64 overflow-auto rounded border border-slate-200">
        {list.map((r) => (
          <label key={r.id} className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-2 py-1 text-sm hover:bg-slate-50">
            <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
            <span className="flex-1 truncate">{recordLabel(r)}</span>
            <span className="text-xs text-slate-500">{r.date}</span>
            <span className="w-24 text-right tabular-nums">{fmtMoney(r.amount)}</span>
          </label>
        ))}
        {type && !list.length && <Empty>No unmatched records.</Empty>}
      </div>
    </div>
  );
}
