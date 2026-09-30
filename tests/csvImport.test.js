import { describe, expect, it } from 'vitest';
import { guessMapping, parseAmount, parseDateString, rowsToRecords } from '../src/lib/csvImport.js';

describe('parsers', () => {
  it('parses amounts in common formats', () => {
    expect(parseAmount('$1,234.50')).toBe(1234.5);
    expect(parseAmount('(12.00)')).toBe(-12);
    expect(parseAmount('12.00-')).toBe(-12);
    expect(parseAmount('-1.234,56')).toBe(-1234.56);
    expect(parseAmount('')).toBeNull();
  });

  it('parses dates', () => {
    expect(parseDateString('2026-03-05')).toBe('2026-03-05');
    expect(parseDateString('3/5/2026')).toBe('2026-03-05');
    expect(parseDateString('3/5/2026', 'DMY')).toBe('2026-05-03');
    expect(parseDateString('25/03/26')).toBe('2026-03-25');
    expect(parseDateString('Mar 5, 2026')).toBe('2026-03-05');
    expect(parseDateString('20260305')).toBe('2026-03-05');
    expect(parseDateString('2/30/2026')).toBeNull();
  });
});

describe('guessMapping', () => {
  it('maps a bank statement', () => {
    const map = guessMapping(['Posted Date', 'Description', 'Debit', 'Credit', 'Check Number']);
    expect(map).toMatchObject({ date: 'Posted Date', memo: 'Description', debit: 'Debit', credit: 'Credit', reference: 'Check Number' });
  });
});

describe('rowsToRecords', () => {
  it('builds bank deposits from debit/credit columns', () => {
    const { records } = rowsToRecords(
      [
        { Date: '03/02/2026', Desc: 'DEPOSIT', Debit: '', Credit: '350.00' },
        { Date: '03/03/2026', Desc: 'FEE', Debit: '15.00', Credit: '' },
      ],
      { record_type: 'bank_deposit', column_map: { date: 'Date', memo: 'Desc', debit: 'Debit', credit: 'Credit' } },
    );
    expect(records.map((r) => r.amount)).toEqual([350, -15]);
    expect(records[0].date).toBe('2026-03-02');
    expect(records[0].external_id).toMatch(/^row:/);
  });

  it('groups sales order lines by reference', () => {
    const rows = [
      { SO: 'SO-1', Customer: 'Acme', Date: '2026-01-05', Item: 'Widget', Qty: '2', Price: '10' },
      { SO: 'SO-1', Customer: 'Acme', Date: '2026-01-05', Item: 'Gadget', Qty: '1', Price: '5.5' },
      { SO: 'SO-2', Customer: 'Globex', Date: '2026-01-06', Item: 'Widget', Qty: '1', Price: '10' },
    ];
    const { records, errors } = rowsToRecords(rows, {
      record_type: 'sales_order',
      group_by_reference: true,
      column_map: { reference: 'SO', counterparty: 'Customer', date: 'Date', line_item_name: 'Item', line_quantity: 'Qty', line_unit_price: 'Price' },
    });
    expect(errors).toEqual([]);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ reference: 'SO-1', external_id: 'ref:SO-1', amount: 25.5 });
    expect(records[0].lines).toHaveLength(2);
  });
});
