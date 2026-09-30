import { describe, expect, it } from 'vitest';
import {
  amountScore,
  dateScore,
  deriveLinkedMatches,
  findSubsetSum,
  linesScore,
  matchChain,
  referenceScore,
  runRule,
  scorePair,
  textSimilarity,
} from '../src/lib/matching.js';
import { DEFAULT_RULES } from '../src/lib/defaultRules.js';

const rule = (name) => DEFAULT_RULES.find((r) => r.name === name);

describe('primitives', () => {
  it('compares company names ignoring suffixes and punctuation', () => {
    expect(textSimilarity('Acme, Inc.', 'ACME')).toBe(1);
    expect(textSimilarity('Smith & Sons LLC', 'Smith and Sons')).toBe(1);
    expect(textSimilarity('Acme Holdings', 'Acme')).toBeGreaterThanOrEqual(0.85);
    expect(textSimilarity('Acme', 'Globex')).toBeLessThan(0.3);
  });

  it('scores references', () => {
    expect(referenceScore('SO-1042', 'so1042')).toBe(1);
    expect(referenceScore('SO-1042', '1042')).toBe(0.9);
    expect(referenceScore(null, '1042')).toBeNull();
  });

  it('scores amounts with tolerance and partial credit', () => {
    expect(amountScore(100, 100.005)).toBe(1);
    expect(amountScore(100, -100)).toBe(1);
    expect(amountScore(100, 98)).toBeGreaterThan(0);
    expect(amountScore(100, 98)).toBeLessThan(0.8);
    expect(amountScore(100, 150)).toBe(0);
    expect(amountScore(100, 104, { tolerance_pct: 0.05 })).toBe(1);
  });

  it('scores dates inside a window', () => {
    expect(dateScore('2026-03-01', '2026-03-01', { window_days: 5 })).toBe(1);
    expect(dateScore('2026-03-01', '2026-03-06', { window_days: 5 })).toBeGreaterThan(0.5);
    expect(dateScore('2026-03-01', '2026-03-07', { window_days: 5 })).toBe(0);
  });

  it('compares line items by sku and quantity', () => {
    const a = [{ sku: 'W-1', quantity: 2 }, { item_name: 'Gadget', quantity: 1 }];
    expect(linesScore(a, [{ sku: 'w1', quantity: 2 }, { item_name: 'gadget', quantity: 1 }])).toBe(1);
    expect(linesScore(a, [{ sku: 'W-1', quantity: 3 }])).toBeLessThan(0.5);
  });

  it('finds a subset that sums to a deposit', () => {
    const pool = [30, 45.5, 12.25, 100, 7].map((amount, i) => ({ id: `p${i}`, amount }));
    const hit = findSubsetSum(pool, 87.75);
    expect(hit.map((p) => p.id).sort()).toEqual(['p0', 'p1', 'p2']);
    expect(findSubsetSum(pool, 1.23)).toBeNull();
  });
});

describe('scorePair', () => {
  it('drops a pair when a required criterion fails', () => {
    const r = rule('Customer Deposit → QBO Payment');
    const s = { amount: 500, date: '2026-03-01', counterparty: 'Acme' };
    expect(scorePair(s, { amount: 500, date: '2026-04-01', counterparty: 'Acme' }, r)).toBeNull();
    expect(scorePair(s, { amount: 500, date: '2026-03-02', counterparty: 'Acme Inc' }, r).score).toBeGreaterThan(0.9);
  });

  it('finds a sales order number in a memo', () => {
    const r = rule('Sales Order → QBO Invoice');
    const res = scorePair(
      { reference: 'SO-5531', counterparty: 'Globex', amount: 1200, date: '2026-02-01' },
      { reference: '1088', memo: 'PO / SO-5531', counterparty: 'Globex Corp', amount: 1200, date: '2026-02-10' },
      r,
    );
    expect(res.breakdown.reference).toBe(0.8);
    expect(res.score).toBeGreaterThan(0.85);
  });
});

describe('runRule', () => {
  const records = [
    { id: 'so1', record_type: 'sales_order', reference: 'SO-1', counterparty: 'Acme', amount: 100, date: '2026-01-05' },
    { id: 'so2', record_type: 'sales_order', reference: 'SO-2', counterparty: 'Globex', amount: 250, date: '2026-01-06' },
    { id: 'inv1', record_type: 'qbo_invoice', reference: '1001', memo: 'SO-1', counterparty: 'Acme Inc', amount: 100, date: '2026-01-10' },
    { id: 'inv2', record_type: 'qbo_invoice', reference: '1002', memo: 'SO-2', counterparty: 'Globex', amount: 250, date: '2026-01-11' },
    { id: 'inv3', record_type: 'qbo_invoice', reference: '1003', counterparty: 'Acme', amount: 100, date: '2026-01-12' },
  ];

  it('assigns each target once, best score first, with alternatives', () => {
    const out = runRule(rule('Sales Order → QBO Invoice'), records);
    const bySource = Object.fromEntries(out.map((s) => [s.source_ids[0], s]));
    expect(bySource.so1.target_ids).toEqual(['inv1']);
    expect(bySource.so2.target_ids).toEqual(['inv2']);
    expect(bySource.so1.alternatives.map((a) => a.target_ids[0])).toContain('inv3');
  });

  it('skips confirmed and rejected pairs', () => {
    const matches = [
      { source_type: 'sales_order', target_type: 'qbo_invoice', source_ids: ['so2'], target_ids: ['inv2'], status: 'confirmed' },
      { source_type: 'sales_order', target_type: 'qbo_invoice', source_ids: ['so1'], target_ids: ['inv1'], status: 'rejected' },
    ];
    const out = runRule(rule('Sales Order → QBO Invoice'), records, matches);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source_ids: ['so1'], target_ids: ['inv3'] });
  });

  it('groups several payments into one bank deposit', () => {
    const recs = [
      { id: 'b1', record_type: 'bank_deposit', amount: 350, date: '2026-03-03' },
      { id: 'p1', record_type: 'qbo_payment', amount: 100, date: '2026-03-01' },
      { id: 'p2', record_type: 'qbo_payment', amount: 250, date: '2026-03-02' },
      { id: 'p3', record_type: 'qbo_payment', amount: 99, date: '2026-03-02' },
      { id: 'p4', record_type: 'qbo_payment', amount: 350, date: '2026-02-01' }, // outside window
    ];
    const out = runRule(rule('Bank Deposit → QBO Payments (grouped)'), recs);
    expect(out).toHaveLength(1);
    expect(out[0].target_ids.sort()).toEqual(['p1', 'p2']);
    expect(out[0].amount_difference).toBe(0);
  });
});

describe('QuickBooks links and chains', () => {
  const records = [
    { id: 'pay', record_type: 'qbo_payment', external_id: '9', connection_id: 'c', linked: [{ record_type: 'qbo_invoice', external_id: '5' }] },
    { id: 'inv', record_type: 'qbo_invoice', external_id: '5', connection_id: 'c' },
    { id: 'dep', record_type: 'qbo_deposit', external_id: '12', connection_id: 'c', linked: [{ record_type: 'qbo_payment', external_id: '9' }] },
  ];

  it('derives confirmed matches from LinkedTxn once', () => {
    const links = deriveLinkedMatches(records);
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.status === 'confirmed' && l.method === 'quickbooks_link')).toBe(true);
    expect(deriveLinkedMatches(records, links)).toHaveLength(0);
  });

  it('walks the full chain from any record', () => {
    const links = deriveLinkedMatches(records);
    expect(matchChain('inv', links).recordIds.sort()).toEqual(['dep', 'inv', 'pay']);
  });
});

describe('skip_targets_linked_from', () => {
  it('ignores payments QuickBooks already deposited', () => {
    const recs = [
      { id: 'b', record_type: 'bank_deposit', amount: 100, date: '2026-03-02' },
      { id: 'p1', record_type: 'qbo_payment', external_id: '1', connection_id: 'c', amount: 60, date: '2026-03-01' },
      { id: 'p2', record_type: 'qbo_payment', external_id: '2', connection_id: 'c', amount: 40, date: '2026-03-01' },
      { id: 'd', record_type: 'qbo_deposit', connection_id: 'c', amount: 100, linked: [{ record_type: 'qbo_payment', external_id: '1' }, { record_type: 'qbo_payment', external_id: '2' }] },
    ];
    expect(runRule(rule('Bank Deposit → QBO Payments (grouped)'), recs)).toHaveLength(0);
  });
});
