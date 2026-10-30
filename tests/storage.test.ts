import assert from 'node:assert/strict';
import test from 'node:test';
import { createInvoice, defaultCompany } from '../lib/invoice.ts';
import { parseBackup, parseCompany, parseStoredInvoices } from '../lib/storage.ts';

function backup() {
  return { version: 1, company: { ...defaultCompany }, invoices: [createInvoice()] };
}

test('backup restores profile and complete independent invoice records', () => {
  const input = backup();
  input.company.name = 'My company';
  input.invoices[0].client.name = 'Client';
  const result = parseBackup(input);
  assert.deepEqual(result, { company: input.company, invoices: input.invoices });
  result.company!.name = 'Changed';
  result.invoices[0].from.name = 'Changed';
  result.invoices[0].client.name = 'Changed';
  result.invoices[0].items[0].details = 'Changed';
  assert.equal(input.company.name, 'My company');
  assert.equal(input.invoices[0].from.name, defaultCompany.name);
  assert.equal(input.invoices[0].client.name, 'Client');
  assert.notEqual(input.invoices[0].items[0].details, 'Changed');
});

test('backup rejects nested values that could crash rendering or date formatting', () => {
  for (const [field, invalid] of [['notes', {}], ['issueDate', null], ['dueDate', []], ['updatedAt', 42], ['terms', true]] as const) {
    const input = backup();
    Object.assign(input.invoices[0], { [field]: invalid });
    assert.throws(() => parseBackup(input), new RegExp(`${field} must be text`));
  }
  const input = backup();
  Object.assign(input.invoices[0].items[0], { details: { content: 'not text' } });
  assert.throws(() => parseBackup(input), /items\[0\]\.details must be text/);
});

test('backup checks every company, client, line item and monetary field', () => {
  const invoice = createInvoice();
  for (const key of Object.keys(defaultCompany)) {
    assert.equal(parseCompany({ ...defaultCompany, [key]: {} }), null);
    assert.throws(() => parseBackup({ version: 1, invoices: [{ ...invoice, from: { ...invoice.from, [key]: null } }] }), /must be text/);
  }
  for (const key of Object.keys(invoice.client)) {
    assert.throws(() => parseBackup({ version: 1, invoices: [{ ...invoice, client: { ...invoice.client, [key]: {} } }] }), /must be text/);
  }
  for (const key of ['discountRate', 'taxRate', 'amountPaid']) {
    for (const invalid of [null, '8', Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => parseBackup({ version: 1, invoices: [{ ...invoice, [key]: invalid }] }), /finite number/);
    }
  }
  for (const key of ['quantity', 'rate']) {
    assert.throws(() => parseBackup({ version: 1, invoices: [{ ...invoice, items: [{ ...invoice.items[0], [key]: Number.NEGATIVE_INFINITY }] }] }), /finite number/);
  }
});

test('malformed records and missing required fields are rejected', () => {
  for (const invalid of [null, [], true, 'text', new Date()]) {
    assert.equal(parseCompany(invalid), null);
    assert.deepEqual(parseStoredInvoices(invalid), []);
    assert.throws(() => parseBackup(invalid), /object/);
  }
  for (const key of Object.keys(createInvoice())) {
    const entry: Record<string, unknown> = { ...createInvoice() };
    delete entry[key];
    assert.throws(() => parseBackup({ version: 1, invoices: [entry] }));
  }
  assert.throws(() => parseBackup({ version: 2, invoices: [] }), /version must be 1/);
  assert.throws(() => parseBackup({ version: 1, invoices: {} }), /must be a list/);
  assert.throws(() => parseBackup({ version: 1, company: [], invoices: [] }), /Company must be an object/);
});

test('identity and enum checks reject invalid values without rejecting incomplete drafts', () => {
  const invoice = createInvoice();
  invoice.number = '';
  invoice.issueDate = '';
  invoice.dueDate = '';
  invoice.client.name = '';
  invoice.items = [];
  assert.deepEqual(parseBackup({ version: 1, invoices: [invoice] }).invoices[0], invoice);
  assert.deepEqual(parseStoredInvoices([invoice])[0], invoice);
  assert.throws(() => parseBackup({ version: 1, invoices: [{ ...invoice, id: ' ' }] }), /cannot be empty/);
  assert.throws(() => parseBackup({ version: 1, invoices: [{ ...invoice, currency: 'EUR' }] }), /currency/);
  assert.throws(() => parseBackup({ version: 1, invoices: [{ ...invoice, status: 'sent' }] }), /status/);
});

test('legacy non-draft statuses follow actual balance while drafts remain drafts', () => {
  const unpaid = { ...createInvoice(), status: 'paid' as const, amountPaid: 100 };
  const paid = { ...createInvoice(), status: 'unpaid' as const, amountPaid: 2500 };
  const draft = { ...createInvoice(), status: 'draft' as const, amountPaid: 2500 };
  assert.deepEqual(parseBackup({ version: 1, invoices: [unpaid, paid, draft] }).invoices.map(entry => entry.status), ['unpaid', 'paid', 'draft']);
  assert.deepEqual(parseStoredInvoices([unpaid, paid, draft]).map(entry => entry.status), ['unpaid', 'paid', 'draft']);
});

test('duplicate invoice IDs reject backup but stored drafts recover the first valid record', () => {
  const first = createInvoice();
  const duplicate = { ...first, notes: 'duplicate' };
  const other = createInvoice();
  assert.throws(() => parseBackup({ version: 1, invoices: [first, duplicate] }), /duplicate invoice ID/);
  const result = parseStoredInvoices([null, { ...first, notes: {} }, first, duplicate, other]);
  assert.deepEqual(result.map(entry => entry.id), [first.id, other.id]);
  assert.equal(result[0].notes, first.notes);
  // Number conflicts are editable and validated before PDF export, not destructive to a restore.
  assert.equal(parseBackup({ version: 1, invoices: [first, { ...other, number: first.number }] }).invoices.length, 2);
});

test('duplicate or absent line item IDs reject the whole damaged invoice', () => {
  const entry = createInvoice();
  entry.items.push({ ...entry.items[0] });
  assert.throws(() => parseBackup({ version: 1, invoices: [entry] }), /duplicate item ID/);
  assert.deepEqual(parseStoredInvoices([entry]), []);
  entry.items = [{ ...entry.items[0], id: '' }];
  assert.throws(() => parseBackup({ version: 1, invoices: [entry] }), /id cannot be empty/);
});

test('resource limits reject oversized backups, item lists and text', () => {
  assert.throws(() => parseBackup({ version: 1, invoices: new Array(10_001) }), /invoice limit/);
  const entry = createInvoice();
  entry.items = new Array(1_001).fill(entry.items[0]);
  assert.throws(() => parseBackup({ version: 1, invoices: [entry] }), /item limit/);
  const longText = 'a'.repeat(100_001);
  assert.throws(() => parseBackup({ version: 1, invoices: [{ ...createInvoice(), notes: longText }] }), /too long/);
  assert.equal(parseCompany({ ...defaultCompany, address: longText }), null);
});

test('optional profile and unknown imported properties are handled safely', () => {
  assert.deepEqual(parseBackup({ version: 1, invoices: [] }), { company: null, invoices: [] });
  assert.deepEqual(parseBackup({ version: 1, company: null, invoices: [] }), { company: null, invoices: [] });
  const input = backup();
  const raw = JSON.parse(JSON.stringify(input).replace('"version":1', '"version":1,"__proto__":{"polluted":true}'));
  raw.invoices[0].unexpected = { bad: 'ignored' };
  raw.company.unexpected = ['ignored'];
  const result = parseBackup(raw);
  assert.equal(Object.hasOwn(result, '__proto__'), false);
  assert.equal(Object.hasOwn(result.invoices[0], 'unexpected'), false);
  assert.equal(Object.hasOwn(result.company!, 'unexpected'), false);
});
