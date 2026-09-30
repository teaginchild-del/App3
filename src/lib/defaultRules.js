// Starter matching rules. Seeded into the MatchRule entity the first time the
// Rules page loads with no rules, then editable by the user.

export const DEFAULT_RULES = [
  {
    name: 'Sales Order → QBO Invoice',
    source_type: 'sales_order',
    target_type: 'qbo_invoice',
    mode: 'one_to_one',
    min_score: 0.6,
    auto_confirm_score: 0,
    criteria: {
      reference: { weight: 3 },
      counterparty: { weight: 2 },
      amount: { weight: 2, tolerance_abs: 0.01, tolerance_pct: 0 },
      date: { weight: 1, window_days: 60 },
      lines: { weight: 2 },
    },
  },
  {
    name: 'Sales Order → QBO Estimate',
    source_type: 'sales_order',
    target_type: 'qbo_estimate',
    mode: 'one_to_one',
    min_score: 0.6,
    criteria: {
      reference: { weight: 3 },
      counterparty: { weight: 2 },
      amount: { weight: 2, tolerance_abs: 0.01 },
      date: { weight: 1, window_days: 30 },
      lines: { weight: 2 },
    },
  },
  {
    name: 'Customer Deposit → QBO Payment',
    source_type: 'customer_deposit',
    target_type: 'qbo_payment',
    mode: 'one_to_one',
    min_score: 0.65,
    criteria: {
      amount: { weight: 3, required: true, tolerance_abs: 0.01 },
      date: { weight: 2, required: true, window_days: 10 },
      counterparty: { weight: 2 },
      reference: { weight: 1 },
    },
  },
  {
    name: 'Bank Deposit → QBO Deposit',
    source_type: 'bank_deposit',
    target_type: 'qbo_deposit',
    mode: 'one_to_one',
    min_score: 0.7,
    criteria: {
      amount: { weight: 3, required: true, tolerance_abs: 0.01 },
      date: { weight: 2, required: true, window_days: 5 },
      reference: { weight: 1 },
    },
  },
  {
    name: 'Bank Deposit → QBO Payments (grouped)',
    source_type: 'bank_deposit',
    target_type: 'qbo_payment',
    mode: 'one_to_many',
    max_group_size: 6,
    skip_targets_linked_from: 'qbo_deposit',
    min_score: 0.7,
    criteria: {
      amount: { weight: 3, required: true, tolerance_abs: 0.01 },
      date: { weight: 2, required: true, window_days: 5 },
    },
  },
  {
    name: 'Processor Payout → QBO Deposit',
    source_type: 'processor_payout',
    target_type: 'qbo_deposit',
    mode: 'one_to_one',
    min_score: 0.7,
    criteria: {
      amount: { weight: 3, required: true, tolerance_abs: 0.01 },
      date: { weight: 2, required: true, window_days: 4 },
      reference: { weight: 1 },
    },
  },
  {
    name: 'External Item → QBO Item',
    source_type: 'external_item',
    target_type: 'qbo_item',
    mode: 'one_to_one',
    min_score: 0.7,
    criteria: {
      reference: { weight: 3 },
      name: { weight: 2 },
      amount: { weight: 0.5, tolerance_pct: 0.05 },
    },
  },
];
