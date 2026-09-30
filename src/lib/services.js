// Operations that combine the pure matching / import logic with entity I/O.
import {
  ImportBatch,
  LedgerRecord,
  Match,
  MatchRule,
  bulkCreateChunked,
  bulkUpdateChunked,
  listAll,
} from '@/api/entities';
import { computeMatchStatus, deriveLinkedMatches, runRule } from './matching';
import { DEFAULT_RULES } from './defaultRules';

export async function ensureDefaultRules() {
  const rules = await MatchRule.list('name', 500);
  if (rules.length) return rules;
  return bulkCreateChunked(MatchRule, DEFAULT_RULES.map((r) => ({ ...r, active: true })));
}

/**
 * Upsert records from a CSV (or any non-QuickBooks source) by
 * (source, record_type, external_id). Existing records keep their id, so
 * matches pointing at them stay valid.
 */
export async function upsertRecords(records, { record_type, file_name }) {
  const batch = await ImportBatch.create({
    source: 'csv',
    record_type,
    file_name,
    status: 'running',
    started_at: new Date().toISOString(),
  });
  try {
    const existing = await listAll(LedgerRecord, { source: 'csv', record_type });
    const byExt = new Map(existing.map((r) => [r.external_id, r]));
    const toCreate = [];
    const toUpdate = [];
    for (const rec of records) {
      const prev = byExt.get(rec.external_id);
      const payload = { ...rec, import_batch_id: batch.id };
      if (!prev) toCreate.push(payload);
      else {
        const { match_status: _keep, ...rest } = payload;
        toUpdate.push({ id: prev.id, ...rest });
      }
    }
    await bulkCreateChunked(LedgerRecord, toCreate);
    await bulkUpdateChunked(LedgerRecord, toUpdate);
    const done = await ImportBatch.update(batch.id, {
      status: 'completed',
      created_count: toCreate.length,
      updated_count: toUpdate.length,
      skipped_count: 0,
      finished_at: new Date().toISOString(),
    });
    return done;
  } catch (err) {
    await ImportBatch.update(batch.id, { status: 'failed', error: err.message, finished_at: new Date().toISOString() });
    throw err;
  }
}

/** Keep LedgerRecord.match_status in sync with the Match table (only writes changes). */
export async function refreshMatchStatus(records, matches) {
  const status = computeMatchStatus(records, matches);
  const changes = records
    .filter((r) => (r.match_status || 'unmatched') !== status.get(r.id))
    .map((r) => ({ id: r.id, match_status: status.get(r.id) }));
  await bulkUpdateChunked(LedgerRecord, changes);
  return changes.length;
}

export async function loadAll() {
  const [records, matches] = await Promise.all([listAll(LedgerRecord), listAll(Match)]);
  return { records, matches };
}

/**
 * Run one rule: replace that rule's open suggestions with fresh ones,
 * auto-confirm above the rule's threshold, and add QuickBooks-native links.
 */
export async function runRuleAndSave(rule) {
  const { records, matches } = await loadAll();

  await Match.deleteMany({ rule_id: rule.id, status: 'suggested' });
  const kept = matches.filter((m) => !(m.status === 'suggested' && m.rule_id === rule.id));

  const suggestions = runRule(rule, records, kept);
  const now = new Date().toISOString();
  const autoAt = Number(rule.auto_confirm_score) || 0;
  const rows = suggestions.map(({ alternatives, ...s }) => {
    const auto = autoAt > 0 && s.score >= autoAt;
    return {
      ...s,
      breakdown: { ...s.breakdown, alternatives },
      rule_id: rule.id,
      source_type: rule.source_type,
      target_type: rule.target_type,
      method: 'auto',
      status: auto ? 'confirmed' : 'suggested',
      confirmed_at: auto ? now : undefined,
    };
  });
  const links = deriveLinkedMatches(records, kept);
  const created = await bulkCreateChunked(Match, [...rows, ...links]);
  await refreshMatchStatus(records, [...kept, ...created]);
  return {
    suggested: rows.filter((r) => r.status === 'suggested').length,
    autoConfirmed: rows.filter((r) => r.status === 'confirmed').length,
    linked: links.length,
  };
}

/** Pull in links QuickBooks already knows (Payment→Invoice, Deposit→Payment...). */
export async function syncQuickBooksLinks() {
  const { records, matches } = await loadAll();
  const links = deriveLinkedMatches(records, matches);
  const created = await bulkCreateChunked(Match, links);
  await refreshMatchStatus(records, [...matches, ...created]);
  return links.length;
}

export async function setMatchStatus(match, status, user) {
  const updated = await Match.update(match.id, {
    status,
    confirmed_at: status === 'confirmed' ? new Date().toISOString() : undefined,
    confirmed_by: status === 'confirmed' ? user?.email : undefined,
  });
  const { records, matches } = await loadAll();
  await refreshMatchStatus(records, matches);
  return updated;
}

export async function createManualMatch({ sources, targets, note, user }) {
  const sum = (rs) => rs.reduce((a, r) => a + Math.abs(r.amount || 0), 0);
  const match = await Match.create({
    source_type: sources[0].record_type,
    target_type: targets[0].record_type,
    source_ids: sources.map((r) => r.id),
    target_ids: targets.map((r) => r.id),
    score: 1,
    breakdown: {},
    amount_difference: Math.round((sum(sources) - sum(targets)) * 100) / 100,
    status: 'confirmed',
    method: 'manual',
    confirmed_by: user?.email,
    confirmed_at: new Date().toISOString(),
    note,
  });
  const { records, matches } = await loadAll();
  await refreshMatchStatus(records, matches);
  return match;
}

export async function deleteMatch(match) {
  await Match.delete(match.id);
  const { records, matches } = await loadAll();
  await refreshMatchStatus(records, matches);
}

export async function bulkSetMatchStatus(list, status, user) {
  const now = new Date().toISOString();
  await bulkUpdateChunked(
    Match,
    list.map((m) => ({
      id: m.id,
      status,
      confirmed_at: status === 'confirmed' ? now : undefined,
      confirmed_by: status === 'confirmed' ? user?.email : undefined,
    })),
  );
  const { records, matches } = await loadAll();
  await refreshMatchStatus(records, matches);
}
