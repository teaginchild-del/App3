// Built-in record types. `native: true` means the object exists in QuickBooks Online
// and is pulled by the quickbooksImport function; everything else is brought in
// from outside QuickBooks (CSV today) and matched against QuickBooks objects.
//
// `qbo` is the QuickBooks API entity name used by the import function.

export const BUILT_IN_TYPES = [
  // --- Not native to QuickBooks Online ---
  { key: 'sales_order', label: 'Sales Order', category: 'sales', native: false, has_lines: true,
    description: 'Orders from an ERP, e-commerce store or CRM. QBO has no sales orders; they usually become estimates or invoices.' },
  { key: 'customer_deposit', label: 'Customer Deposit', category: 'payments', native: false,
    description: 'Deposits / prepayments taken against an order before it is invoiced.' },
  { key: 'bank_deposit', label: 'Bank Deposit', category: 'banking', native: false,
    description: 'Deposit lines from a bank statement. One bank deposit often equals several QBO payments or one QBO deposit.' },
  { key: 'bank_transaction', label: 'Bank Transaction', category: 'banking', native: false,
    description: 'Any other bank statement line (withdrawals, fees, transfers).' },
  { key: 'processor_payout', label: 'Processor Payout', category: 'banking', native: false,
    description: 'Payouts from Stripe, Square, PayPal, Shopify Payments, etc.' },
  { key: 'external_item', label: 'External Item', category: 'items', native: false,
    description: 'Products / SKUs from another system to map onto QuickBooks items.' },

  // --- Native QuickBooks Online objects ---
  { key: 'qbo_invoice', label: 'QBO Invoice', category: 'sales', native: true, qbo: 'Invoice', has_lines: true },
  { key: 'qbo_estimate', label: 'QBO Estimate', category: 'sales', native: true, qbo: 'Estimate', has_lines: true },
  { key: 'qbo_sales_receipt', label: 'QBO Sales Receipt', category: 'sales', native: true, qbo: 'SalesReceipt', has_lines: true },
  { key: 'qbo_credit_memo', label: 'QBO Credit Memo', category: 'sales', native: true, qbo: 'CreditMemo', has_lines: true },
  { key: 'qbo_refund_receipt', label: 'QBO Refund Receipt', category: 'sales', native: true, qbo: 'RefundReceipt', has_lines: true },
  { key: 'qbo_payment', label: 'QBO Payment', category: 'payments', native: true, qbo: 'Payment' },
  { key: 'qbo_deposit', label: 'QBO Deposit', category: 'banking', native: true, qbo: 'Deposit' },
  { key: 'qbo_transfer', label: 'QBO Transfer', category: 'banking', native: true, qbo: 'Transfer' },
  { key: 'qbo_purchase', label: 'QBO Expense / Check', category: 'purchasing', native: true, qbo: 'Purchase', has_lines: true },
  { key: 'qbo_purchase_order', label: 'QBO Purchase Order', category: 'purchasing', native: true, qbo: 'PurchaseOrder', has_lines: true },
  { key: 'qbo_bill', label: 'QBO Bill', category: 'purchasing', native: true, qbo: 'Bill', has_lines: true },
  { key: 'qbo_bill_payment', label: 'QBO Bill Payment', category: 'purchasing', native: true, qbo: 'BillPayment' },
  { key: 'qbo_journal_entry', label: 'QBO Journal Entry', category: 'other', native: true, qbo: 'JournalEntry' },
  { key: 'qbo_item', label: 'QBO Item', category: 'items', native: true, qbo: 'Item' },
  { key: 'qbo_customer', label: 'QBO Customer', category: 'contacts', native: true, qbo: 'Customer' },
  { key: 'qbo_vendor', label: 'QBO Vendor', category: 'contacts', native: true, qbo: 'Vendor' },
];

export const QBO_TYPES = BUILT_IN_TYPES.filter((t) => t.native);

/** Merge built-in types with user-defined RecordType entities. */
export function allRecordTypes(customTypes = []) {
  const byKey = new Map(BUILT_IN_TYPES.map((t) => [t.key, t]));
  for (const c of customTypes) {
    if (!c?.key || byKey.has(c.key)) continue;
    byKey.set(c.key, { ...c, native: false, custom: true });
  }
  return [...byKey.values()];
}

export function typeLabel(key, types = BUILT_IN_TYPES) {
  return types.find((t) => t.key === key)?.label ?? key;
}

export function toTypeKey(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Human label for a record in lists: reference/name + counterparty. */
export function recordLabel(r) {
  if (!r) return '';
  const head = r.reference || r.name || (r.memo && r.memo.slice(0, 40)) || r.external_id || r.id;
  return r.counterparty ? `${head} · ${r.counterparty}` : String(head);
}
