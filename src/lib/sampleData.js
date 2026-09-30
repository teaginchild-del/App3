// Demo data: a few QuickBooks-shaped objects plus the outside-QuickBooks
// objects that should match them. Lets the whole flow be tried before a
// QuickBooks company is connected.
import { LedgerRecord, bulkCreateChunked } from '@/api/entities';

const qbo = (record_type, external_id, fields) => ({
  record_type,
  source: 'quickbooks',
  connection_id: 'sample',
  external_id,
  match_status: 'unmatched',
  ...fields,
});
const ext = (record_type, external_id, fields) => ({ record_type, source: 'csv', external_id, match_status: 'unmatched', ...fields });

export const SAMPLE_RECORDS = [
  // Sales orders from an external order system
  ext('sales_order', 'ref:SO-2001', { reference: 'SO-2001', date: '2026-08-03', counterparty: 'Acme Corp', amount: 1250,
    lines: [{ sku: 'WID-100', item_name: 'Widget', quantity: 10, unit_price: 100, amount: 1000 }, { sku: 'SVC-INST', item_name: 'Installation', quantity: 1, unit_price: 250, amount: 250 }] }),
  ext('sales_order', 'ref:SO-2002', { reference: 'SO-2002', date: '2026-08-05', counterparty: 'Globex LLC', amount: 480,
    lines: [{ sku: 'GAD-7', item_name: 'Gadget', quantity: 4, unit_price: 120, amount: 480 }] }),
  ext('sales_order', 'ref:SO-2003', { reference: 'SO-2003', date: '2026-08-11', counterparty: 'Initech', amount: 3200,
    lines: [{ sku: 'WID-100', item_name: 'Widget', quantity: 32, unit_price: 100, amount: 3200 }] }),
  // Customer deposits taken against orders
  ext('customer_deposit', 'row:dep1', { reference: 'SO-2003', date: '2026-08-12', counterparty: 'Initech', amount: 1600, memo: '50% deposit SO-2003' }),
  // Bank statement deposits
  ext('bank_deposit', 'row:bank1', { date: '2026-08-21', amount: 1730, memo: 'DEPOSIT', account: 'Operating Checking' }),
  ext('bank_deposit', 'row:bank2', { date: '2026-08-14', amount: 1600, memo: 'MOBILE DEPOSIT', account: 'Operating Checking' }),
  // Products from the order system
  ext('external_item', 'row:item1', { reference: 'WID-100', name: 'Widget 100', amount: 100 }),
  ext('external_item', 'row:item2', { reference: 'GAD-7', name: 'Gadget Seven', amount: 120 }),

  // QuickBooks
  qbo('qbo_item', '1', { reference: 'WID-100', name: 'Widget', amount: 100 }),
  qbo('qbo_item', '2', { reference: 'GAD7', name: 'Gadget', amount: 120 }),
  qbo('qbo_item', '3', { name: 'Installation', amount: 250 }),
  qbo('qbo_invoice', '101', { reference: '1045', date: '2026-08-15', counterparty: 'Acme Corporation', amount: 1250, memo: 'PO 77 / SO-2001', balance: 0,
    lines: [{ item_name: 'Widget', quantity: 10, amount: 1000 }, { item_name: 'Installation', quantity: 1, amount: 250 }] }),
  qbo('qbo_invoice', '102', { reference: '1046', date: '2026-08-16', counterparty: 'Globex', amount: 480, balance: 0,
    lines: [{ item_name: 'Gadget', quantity: 4, amount: 480 }] }),
  qbo('qbo_estimate', '90', { reference: 'EST-3', date: '2026-08-11', counterparty: 'Initech', amount: 3200, memo: 'SO-2003',
    lines: [{ item_name: 'Widget', quantity: 32, amount: 3200 }] }),
  qbo('qbo_payment', '201', { reference: '5521', date: '2026-08-19', counterparty: 'Acme Corporation', amount: 1250,
    linked: [{ record_type: 'qbo_invoice', external_id: '101' }] }),
  qbo('qbo_payment', '202', { reference: '8812', date: '2026-08-20', counterparty: 'Globex', amount: 480,
    linked: [{ record_type: 'qbo_invoice', external_id: '102' }] }),
  qbo('qbo_payment', '203', { date: '2026-08-13', counterparty: 'Initech', amount: 1600, memo: 'Deposit on order' }),
  qbo('qbo_deposit', '301', { date: '2026-08-14', amount: 1600, account: 'Operating Checking',
    linked: [{ record_type: 'qbo_payment', external_id: '203' }] }),
];

export async function loadSampleData() {
  return bulkCreateChunked(LedgerRecord, SAMPLE_RECORDS);
}
