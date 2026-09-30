// Matching engine. Pure functions, no I/O, so it runs in the browser today and
// can be copied into a Base44 backend function later without changes.
//
// A rule compares records of `source_type` with records of `target_type` on a
// set of weighted criteria. Each criterion scores 0..1; the pair score is the
// weighted average of the criteria both records have data for. A criterion
// marked `required` removes the pair entirely when it scores 0.

const DAY_MS = 86_400_000;

const COMPANY_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'plc', 'lp', 'llp', 'the',
]);

export function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t && !COMPANY_SUFFIXES.has(t))
    .join(' ');
}

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

/** Sørensen–Dice on character bigrams of the space-stripped strings. */
export function diceSimilarity(a, b) {
  const x = normalizeText(a).replace(/ /g, '');
  const y = normalizeText(b).replace(/ /g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const bx = bigrams(x);
  const by = bigrams(y);
  let overlap = 0;
  for (const [g, n] of bx) overlap += Math.min(n, by.get(g) || 0);
  return (2 * overlap) / (x.length - 1 + (y.length - 1));
}

/** Best of token-set Jaccard and bigram Dice, so word order and typos both work. */
export function textSimilarity(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jaccard = inter / (ta.size + tb.size - inter);
  // One name fully contained in the other ("Acme" vs "Acme Holdings") is a strong signal.
  const contained = inter === Math.min(ta.size, tb.size) ? 0.85 : 0;
  return Math.max(jaccard, contained, diceSimilarity(na, nb));
}

function refKey(v) {
  return String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Document numbers: exact after stripping punctuation, then prefix/digit tolerance. */
export function referenceScore(a, b) {
  const x = refKey(a);
  const y = refKey(b);
  if (!x || !y) return null;
  if (x === y) return 1;
  // "SO-1042" vs "1042", or "INV1042" vs "1042"
  const dx = x.replace(/\D/g, '').replace(/^0+/, '');
  const dy = y.replace(/\D/g, '').replace(/^0+/, '');
  if (dx && dx === dy && dx.length >= 3) return 0.9;
  if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) return 0.75;
  // References embedded in memos: allow partial credit via Dice, but keep it low.
  return Math.min(0.5, diceSimilarity(x, y));
}

export function amountScore(a, b, { tolerance_abs = 0.01, tolerance_pct = 0 } = {}) {
  if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) return null;
  const diff = Math.abs(Math.abs(a) - Math.abs(b));
  const tol = Math.max(tolerance_abs, Math.abs(a) * tolerance_pct);
  if (diff <= tol + 1e-9) return 1;
  // Partial credit decays to 0 at a 5% miss (fees, rounding, partial payments).
  const span = Math.max(Math.abs(a) * 0.05, tol * 10, 1);
  return Math.max(0, 1 - (diff - tol) / span) * 0.8;
}

export function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

export function daysBetween(a, b) {
  const x = parseDate(a);
  const y = parseDate(b);
  if (!x || !y) return null;
  return Math.round(Math.abs(x - y) / DAY_MS);
}

export function dateScore(a, b, { window_days = 7 } = {}) {
  const d = daysBetween(a, b);
  if (d == null) return null;
  if (d > window_days) return 0;
  if (window_days === 0) return 1;
  return 1 - (d / (window_days + 1)) * 0.5; // same day = 1, edge of window = ~0.5
}

function lineKey(l) {
  return refKey(l.sku || l.item_name || l.item_ref || l.description);
}

/** Compare line items by SKU / item name and quantity. */
export function linesScore(aLines, bLines) {
  const a = (aLines || []).filter((l) => lineKey(l));
  const b = (bLines || []).filter((l) => lineKey(l));
  if (!a.length || !b.length) return null;
  const used = new Set();
  let total = 0;
  for (const la of a) {
    let best = 0;
    let bestIdx = -1;
    b.forEach((lb, i) => {
      if (used.has(i)) return;
      const nameSim = Math.max(
        la.sku && lb.sku ? (refKey(la.sku) === refKey(lb.sku) ? 1 : 0) : 0,
        textSimilarity(la.item_name || la.description, lb.item_name || lb.description),
      );
      if (nameSim < 0.5) return;
      const qtyOk = la.quantity == null || lb.quantity == null || Math.abs(la.quantity - lb.quantity) < 1e-6;
      const s = nameSim * (qtyOk ? 1 : 0.7);
      if (s > best) {
        best = s;
        bestIdx = i;
      }
    });
    if (bestIdx >= 0) used.add(bestIdx);
    total += best;
  }
  return total / Math.max(a.length, b.length);
}

const CRITERIA = {
  amount: (s, t, c) => amountScore(s.amount, t.amount, c),
  date: (s, t, c) => dateScore(s.date, t.date, c),
  reference: (s, t) => {
    const direct = referenceScore(s.reference, t.reference);
    // A bank line or payment often carries the invoice/SO number in its memo.
    const inMemo =
      s.reference && t.memo && refKey(t.memo).includes(refKey(s.reference)) && refKey(s.reference).length >= 3
        ? 0.8
        : t.reference && s.memo && refKey(s.memo).includes(refKey(t.reference)) && refKey(t.reference).length >= 3
          ? 0.8
          : null;
    if (direct == null) return inMemo;
    // Different systems number documents differently (SO-2002 vs invoice 1046),
    // so unrelated references are neutral rather than evidence against.
    if (direct < 0.5 && inMemo == null) return 0.5;
    return Math.max(direct, inMemo ?? 0);
  },
  counterparty: (s, t) => (s.counterparty && t.counterparty ? textSimilarity(s.counterparty, t.counterparty) : null),
  name: (s, t) => {
    const a = s.name || s.memo;
    const b = t.name || t.memo;
    return a && b ? textSimilarity(a, b) : null;
  },
  lines: (s, t) => linesScore(s.lines, t.lines),
};

export const CRITERIA_KEYS = Object.keys(CRITERIA);

/**
 * Score one pair. Returns { score, breakdown } or null when a required
 * criterion fails.
 */
export function scorePair(source, target, rule) {
  const criteria = rule.criteria || {};
  let weighted = 0;
  let weights = 0;
  const breakdown = {};
  for (const [key, cfg] of Object.entries(criteria)) {
    const fn = CRITERIA[key];
    const weight = Number(cfg?.weight ?? 0);
    if (!fn || weight <= 0) continue;
    const s = fn(source, target, cfg);
    if (s == null) {
      if (cfg.required) return null;
      continue;
    }
    if (cfg.required && s === 0) return null;
    breakdown[key] = round(s);
    weighted += s * weight;
    weights += weight;
  }
  if (!weights) return null;
  return { score: round(weighted / weights), breakdown };
}

function round(n, p = 3) {
  const f = 10 ** p;
  return Math.round(n * f) / f;
}

/** Ids of records already tied up in confirmed matches between these two types. */
export function lockedIds(matches, sourceType, targetType) {
  const src = new Set();
  const tgt = new Set();
  for (const m of matches || []) {
    if (m.status !== 'confirmed') continue;
    if (m.source_type === sourceType && m.target_type === targetType) {
      m.source_ids.forEach((id) => src.add(id));
      m.target_ids.forEach((id) => tgt.add(id));
    }
  }
  return { src, tgt };
}

function rejectedKey(sourceIds, targetIds) {
  return `${[...sourceIds].sort().join(',')}|${[...targetIds].sort().join(',')}`;
}

/** Targets sorted by date, for window lookups. */
function dateIndex(targets) {
  const dated = [];
  const undated = [];
  for (const t of targets) {
    const d = parseDate(t.date);
    if (d) dated.push({ t, ms: d.getTime() });
    else undated.push(t);
  }
  dated.sort((a, b) => a.ms - b.ms);
  return { dated, undated };
}

function lowerBound(arr, ms) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].ms < ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function candidatesFor(source, index, allTargets, rule) {
  const dateCfg = rule.criteria?.date;
  const sd = parseDate(source.date);
  if (!dateCfg?.required || !sd) return allTargets;
  const w = (dateCfg.window_days ?? 7) * DAY_MS;
  const out = [];
  for (let i = lowerBound(index.dated, sd.getTime() - w); i < index.dated.length; i++) {
    if (index.dated[i].ms > sd.getTime() + w) break;
    out.push(index.dated[i].t);
  }
  return out;
}

/**
 * Find a subset of `pool` whose amounts sum to `goal` within `tol`.
 * Depth-first with pruning, bounded by maxItems and a node budget so it
 * never hangs the UI. Prefers fewer items.
 */
export function findSubsetSum(pool, goal, { tol = 0.01, maxItems = 6, maxNodes = 200_000 } = {}) {
  const items = pool
    .filter((p) => p.amount != null && Math.sign(p.amount) === Math.sign(goal) && Math.abs(p.amount) <= Math.abs(goal) + tol)
    .map((p) => ({ p, v: Math.round(Math.abs(p.amount) * 100) }))
    .sort((a, b) => b.v - a.v);
  const target = Math.round(Math.abs(goal) * 100);
  const tolC = Math.round(tol * 100);
  const suffix = new Array(items.length + 1).fill(0);
  for (let i = items.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + items[i].v;
  let nodes = 0;
  const chosen = [];

  for (let size = 2; size <= maxItems; size++) {
    const hit = dfs(0, 0, size);
    if (hit) return hit.map((i) => items[i].p);
    if (nodes > maxNodes) break;
  }
  return null;

  function dfs(start, sum, size) {
    if (++nodes > maxNodes) return null;
    if (chosen.length === size) return Math.abs(sum - target) <= tolC ? [...chosen] : null;
    if (sum + suffix[start] < target - tolC) return null;
    for (let i = start; i < items.length; i++) {
      if (sum + items[i].v > target + tolC) continue;
      chosen.push(i);
      const r = dfs(i + 1, sum + items[i].v, size);
      chosen.pop();
      if (r) return r;
    }
    return null;
  }
}

/**
 * Run a rule over the record set.
 *
 * @param rule     MatchRule
 * @param records  all LedgerRecords (filtered here by type)
 * @param matches  existing Match rows (confirmed ones lock records; rejected ones are not re-suggested)
 * @returns suggestions: [{ source_ids, target_ids, score, breakdown, amount_difference, alternatives }]
 */
export function runRule(rule, records, matches = [], { maxAlternatives = 3 } = {}) {
  const { src: lockedSrc, tgt: lockedTgt } = lockedIds(matches, rule.source_type, rule.target_type);
  const rejected = new Set(
    (matches || [])
      .filter((m) => m.status === 'rejected' && m.source_type === rule.source_type && m.target_type === rule.target_type)
      .map((m) => rejectedKey(m.source_ids, m.target_ids)),
  );
  const sources = records.filter((r) => r.record_type === rule.source_type && !lockedSrc.has(r.id));
  // e.g. skip payments QuickBooks already grouped into a Deposit; the bank line should match that Deposit instead.
  const alreadyLinked = new Set();
  if (rule.skip_targets_linked_from) {
    for (const r of records) {
      if (r.record_type !== rule.skip_targets_linked_from) continue;
      for (const l of r.linked || []) if (l.record_type === rule.target_type) alreadyLinked.add(`${l.external_id}:${r.connection_id ?? ''}`);
    }
  }
  const targets = records.filter(
    (r) =>
      r.record_type === rule.target_type &&
      !lockedTgt.has(r.id) &&
      !alreadyLinked.has(`${r.external_id}:${r.connection_id ?? ''}`),
  );
  const index = dateIndex(targets);
  const minScore = rule.min_score ?? 0.6;

  // 1. Score every viable pair.
  const perSource = new Map();
  const pairs = [];
  for (const s of sources) {
    const list = [];
    for (const t of candidatesFor(s, index, targets, rule)) {
      if (rejected.has(rejectedKey([s.id], [t.id]))) continue;
      const r = scorePair(s, t, rule);
      if (!r || r.score < minScore) continue;
      const entry = { s, t, ...r };
      list.push(entry);
      pairs.push(entry);
    }
    list.sort((a, b) => b.score - a.score);
    perSource.set(s.id, list);
  }

  // 2. Greedy one-to-one assignment, best scores first.
  pairs.sort((a, b) => b.score - a.score);
  const usedS = new Set();
  const usedT = new Set();
  const suggestions = [];
  for (const p of pairs) {
    if (usedS.has(p.s.id) || usedT.has(p.t.id)) continue;
    // In grouped mode only take a 1:1 when the amount is exact; otherwise let grouping try.
    if (rule.mode === 'one_to_many' && p.breakdown.amount !== undefined && p.breakdown.amount < 1) continue;
    usedS.add(p.s.id);
    usedT.add(p.t.id);
    suggestions.push({
      source_ids: [p.s.id],
      target_ids: [p.t.id],
      score: p.score,
      breakdown: p.breakdown,
      amount_difference: diff(p.s.amount, [p.t]),
      alternatives: perSource
        .get(p.s.id)
        .filter((a) => a.t.id !== p.t.id)
        .slice(0, maxAlternatives)
        .map((a) => ({ target_ids: [a.t.id], score: a.score, breakdown: a.breakdown })),
    });
  }

  // 3. One-to-many: a source equals the sum of several targets.
  if (rule.mode === 'one_to_many') {
    const amountCfg = rule.criteria?.amount || {};
    for (const s of sources) {
      if (usedS.has(s.id) || s.amount == null) continue;
      let pool = candidatesFor(s, index, targets, rule).filter((t) => !usedT.has(t.id));
      if (rule.same_counterparty_for_groups && s.counterparty) {
        pool = pool.filter((t) => t.counterparty && textSimilarity(s.counterparty, t.counterparty) >= 0.8);
      }
      // Keep the search small: closest dates first.
      const sd = parseDate(s.date)?.getTime() ?? 0;
      pool = pool
        .map((t) => ({ t, d: Math.abs((parseDate(t.date)?.getTime() ?? sd) - sd) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 30)
        .map((x) => x.t);
      const tol = Math.max(amountCfg.tolerance_abs ?? 0.01, Math.abs(s.amount) * (amountCfg.tolerance_pct ?? 0));
      const group = findSubsetSum(pool, s.amount, { tol, maxItems: rule.max_group_size ?? 6 });
      if (!group) continue;
      const ids = group.map((g) => g.id);
      if (rejected.has(rejectedKey([s.id], ids))) continue;
      const worstDate = Math.min(...group.map((g) => dateScore(s.date, g.date, rule.criteria?.date || {}) ?? 1));
      const breakdown = { amount: 1, date: round(worstDate), group_size: group.length };
      const dw = rule.criteria?.date?.weight ?? 0;
      const aw = amountCfg.weight ?? 1;
      const score = round((aw + dw * worstDate) / (aw + dw));
      if (score < minScore) continue;
      usedS.add(s.id);
      ids.forEach((id) => usedT.add(id));
      suggestions.push({
        source_ids: [s.id],
        target_ids: ids,
        score,
        breakdown,
        amount_difference: diff(s.amount, group),
        alternatives: [],
      });
    }
  }

  return suggestions.sort((a, b) => b.score - a.score);
}

function diff(amount, targets) {
  const sum = targets.reduce((acc, t) => acc + Math.abs(t.amount || 0), 0);
  return round(Math.abs(amount || 0) - sum, 2);
}

/**
 * Turn links QuickBooks already knows about (Payment → Invoice, Deposit →
 * Payment, Invoice → Estimate) into confirmed matches, so imported objects
 * can be traced end-to-end: Sales Order → Estimate → Invoice → Payment →
 * Deposit → Bank Deposit.
 */
export function deriveLinkedMatches(records, existingMatches = []) {
  const byKey = new Map();
  for (const r of records) if (r.external_id) byKey.set(`${r.record_type}:${r.external_id}:${r.connection_id ?? ''}`, r);
  const existing = new Set((existingMatches || []).map((m) => rejectedKey(m.source_ids, m.target_ids)));
  const out = [];
  for (const r of records) {
    for (const link of r.linked || []) {
      const other = byKey.get(`${link.record_type}:${link.external_id}:${r.connection_id ?? ''}`);
      if (!other) continue;
      const key = rejectedKey([r.id], [other.id]);
      const reverse = rejectedKey([other.id], [r.id]);
      if (existing.has(key) || existing.has(reverse)) continue;
      existing.add(key);
      out.push({
        source_type: r.record_type,
        target_type: other.record_type,
        source_ids: [r.id],
        target_ids: [other.id],
        score: 1,
        breakdown: { quickbooks_link: 1 },
        amount_difference: null,
        status: 'confirmed',
        method: 'quickbooks_link',
      });
    }
  }
  return out;
}

/** Every record connected to `recordId` through non-rejected matches (for the chain view). */
export function matchChain(recordId, matches) {
  const adj = new Map();
  const add = (a, b, m) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ id: b, match: m });
  };
  for (const m of matches || []) {
    if (m.status === 'rejected') continue;
    const ids = [...m.source_ids, ...m.target_ids];
    for (const a of ids) for (const b of ids) if (a !== b) add(a, b, m);
  }
  const seen = new Set([recordId]);
  const edges = new Set();
  const queue = [recordId];
  while (queue.length) {
    const cur = queue.shift();
    for (const { id, match } of adj.get(cur) || []) {
      edges.add(match);
      if (!seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
    }
  }
  return { recordIds: [...seen], matches: [...edges] };
}

/** Recompute match_status for records given the match set. */
export function computeMatchStatus(records, matches) {
  const confirmed = new Set();
  const suggested = new Set();
  for (const m of matches || []) {
    const ids = [...m.source_ids, ...m.target_ids];
    if (m.status === 'confirmed') ids.forEach((id) => confirmed.add(id));
    else if (m.status === 'suggested') ids.forEach((id) => suggested.add(id));
  }
  const out = new Map();
  for (const r of records) {
    out.set(r.id, confirmed.has(r.id) ? 'matched' : suggested.has(r.id) ? 'suggested' : 'unmatched');
  }
  return out;
}
