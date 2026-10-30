import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateInvoice, createInvoice, defaultCompany, formatDate, formatMoney, validateInvoice } from '../lib/invoice.ts';

function sample() {
  const invoice = createInvoice();
  invoice.client.name = 'Example Client';
  return invoice;
}

test('defaults use independent company data, a local date and fourteen-day terms', () => {
  const invoice = createInvoice();
  assert.equal(invoice.from.name, 'Seladevs');
  assert.equal(invoice.from.website, 'seladevs.my');
  assert.equal(invoice.currency, 'MYR');
  assert.equal(invoice.taxRate, 0);
  assert.equal(invoice.discountRate, 0);
  assert.equal(invoice.items[0].rate, 2500);
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  assert.equal(invoice.issueDate, date);
  const due = new Date(`${invoice.issueDate}T12:00:00`);
  due.setDate(due.getDate() + 14);
  assert.equal(invoice.dueDate, `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`);
  invoice.from.name = 'Changed';
  assert.equal(defaultCompany.name, 'Seladevs');
});

test('invoice sequence advances the largest current-year number without reusing gaps', () => {
  const year = new Date().getFullYear();
  const records = ['005', '002', '014'].map(sequence => ({ ...sample(), number: `INV-${year}-${sequence}` }));
  records.push({ ...sample(), number: `INV-${year - 1}-999` });
  records.push({ ...sample(), number: 'A-CUSTOM-NUMBER' });
  assert.equal(createInvoice(undefined, records).number, `INV-${year}-015`);
  assert.equal(createInvoice().number, `INV-${year}-001`);
});

test('fractional line amounts round to cents before the subtotal', () => {
  const invoice = sample();
  invoice.items = [
    { id: '1', description: 'A', details: '', quantity: 1, rate: 1.005 },
    { id: '2', description: 'B', details: '', quantity: 1, rate: 10.075 },
    { id: '3', description: 'C', details: '', quantity: 3, rate: 0.335 },
  ];
  assert.equal(calculateInvoice(invoice).subtotal, 12.1);
});

test('discount is applied before tax and partial payments reduce the balance', () => {
  const invoice = sample();
  invoice.items[0].rate = 199.99;
  invoice.discountRate = 12.5;
  invoice.taxRate = 8;
  invoice.amountPaid = 50;
  assert.deepEqual(calculateInvoice(invoice), {
    subtotal: 199.99,
    discount: 25,
    tax: 14,
    total: 188.99,
    paid: 50,
    balance: 138.99,
  });
});

test('unsafe numeric inputs cannot produce NaN, negative totals or a negative balance', () => {
  const invoice = sample();
  invoice.items.push({ id: '2', description: 'Invalid', details: '', quantity: Number.NaN, rate: -9 });
  invoice.discountRate = -12;
  invoice.taxRate = Number.POSITIVE_INFINITY;
  invoice.amountPaid = -50;
  assert.deepEqual(calculateInvoice(invoice), {
    subtotal: 2500, discount: 0, tax: 0, total: 2500, paid: 0, balance: 2500,
  });
  invoice.discountRate = 200;
  assert.equal(calculateInvoice(invoice).total, 0);
  invoice.discountRate = 0;
  invoice.amountPaid = 3000;
  assert.equal(calculateInvoice(invoice).paid, 3000);
  assert.equal(calculateInvoice(invoice).balance, 0);
  assert.match(validateInvoice(invoice).join(' '), /cannot exceed/);
});

test('complete invoice passes validation', () => {
  assert.deepEqual(validateInvoice(sample()), []);
});

test('validation catches missing identity, invalid calendar dates and due-date ordering', () => {
  const invoice = sample();
  invoice.number = ' ';
  invoice.client.name = '';
  invoice.issueDate = '2026-02-30';
  invoice.dueDate = '';
  let errors = validateInvoice(invoice).join(' ');
  assert.match(errors, /invoice number/);
  assert.match(errors, /client name/);
  assert.match(errors, /valid invoice date/);
  assert.match(errors, /valid due date/);
  invoice.issueDate = '2026-10-30';
  invoice.dueDate = '2026-10-29';
  errors = validateInvoice(invoice).join(' ');
  assert.match(errors, /on or after/);
});

test('validation catches empty or invalid lines, invalid percentages and negative payments', () => {
  const invoice = sample();
  invoice.items = [];
  assert.match(validateInvoice(invoice).join(' '), /at least one valid line item/);
  invoice.items = [{ id: '1', description: '', details: '', quantity: 0, rate: -1 }];
  invoice.discountRate = 101;
  invoice.taxRate = Number.NaN;
  invoice.amountPaid = -1;
  const errors = validateInvoice(invoice).join(' ');
  assert.match(errors, /description/);
  assert.match(errors, /quantity must/);
  assert.match(errors, /rate must/);
  assert.match(errors, /Discount must/);
  assert.match(errors, /Tax must/);
  assert.match(errors, /Amount paid must/);
});

test('formatters provide readable currency and reject invalid dates', () => {
  assert.match(formatMoney(1234.5, 'MYR'), /1,234\.50/);
  assert.match(formatMoney(10, 'USD'), /10\.00/);
  assert.match(formatMoney(Number.NaN, 'SGD'), /0\.00/);
  assert.equal(formatDate('not-a-date'), '—');
  assert.equal(formatDate('2026-02-30'), '—');
  assert.match(formatDate('2026-10-30'), /30.*Oct.*2026/);
});
