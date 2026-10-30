import { calculateInvoice, defaultCompany, type Client, type Company, type Invoice, type LineItem } from './invoice';

const MAX_INVOICES = 10_000;
const MAX_ITEMS = 1_000;
const MAX_TEXT_LENGTH = 100_000;

type RecordValue = Record<string, unknown>;

function record(raw: unknown, path: string): RecordValue {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${path} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must be a plain object.`);
  }
  return raw as RecordValue;
}

function text(raw: unknown, path: string, required = false): string {
  if (typeof raw !== 'string') throw new Error(`${path} must be text.`);
  if (raw.length > MAX_TEXT_LENGTH) throw new Error(`${path} is too long (maximum ${MAX_TEXT_LENGTH} characters).`);
  if (required && !raw.trim()) throw new Error(`${path} cannot be empty.`);
  return raw;
}

function finiteNumber(raw: unknown, path: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return raw;
}

function company(raw: unknown, path: string): Company {
  const value = record(raw, path);
  // Construct a fresh record from known fields so imported properties cannot enter app state.
  return Object.fromEntries(Object.keys(defaultCompany).map(key => [key, text(value[key], `${path}.${key}`)])) as unknown as Company;
}

function client(raw: unknown, path: string): Client {
  const value = record(raw, path);
  return {
    name: text(value.name, `${path}.name`),
    email: text(value.email, `${path}.email`),
    address: text(value.address, `${path}.address`),
    registration: text(value.registration, `${path}.registration`),
  };
}

function lineItem(raw: unknown, path: string): LineItem {
  const value = record(raw, path);
  return {
    id: text(value.id, `${path}.id`, true),
    description: text(value.description, `${path}.description`),
    details: text(value.details, `${path}.details`),
    quantity: finiteNumber(value.quantity, `${path}.quantity`),
    rate: finiteNumber(value.rate, `${path}.rate`),
  };
}

function invoice(raw: unknown, path: string): Invoice {
  const value = record(raw, path);
  if (value.currency !== 'MYR' && value.currency !== 'USD' && value.currency !== 'SGD') {
    throw new Error(`${path}.currency must be MYR, USD or SGD.`);
  }
  if (value.status !== 'draft' && value.status !== 'unpaid' && value.status !== 'paid') {
    throw new Error(`${path}.status must be draft, unpaid or paid.`);
  }
  if (!Array.isArray(value.items)) throw new Error(`${path}.items must be a list.`);
  if (value.items.length > MAX_ITEMS) throw new Error(`${path}.items exceeds the ${MAX_ITEMS}-item limit.`);
  const items = Array.from(value.items, (item, index) => lineItem(item, `${path}.items[${index}]`));
  const itemIds = new Set<string>();
  for (const item of items) {
    if (itemIds.has(item.id)) throw new Error(`${path}.items contains a duplicate item ID.`);
    itemIds.add(item.id);
  }
  const parsed: Invoice = {
    id: text(value.id, `${path}.id`, true),
    number: text(value.number, `${path}.number`),
    issueDate: text(value.issueDate, `${path}.issueDate`),
    dueDate: text(value.dueDate, `${path}.dueDate`),
    currency: value.currency,
    status: value.status,
    from: company(value.from, `${path}.from`),
    client: client(value.client, `${path}.client`),
    items,
    discountRate: finiteNumber(value.discountRate, `${path}.discountRate`),
    taxRate: finiteNumber(value.taxRate, `${path}.taxRate`),
    amountPaid: finiteNumber(value.amountPaid, `${path}.amountPaid`),
    notes: text(value.notes, `${path}.notes`),
    terms: text(value.terms, `${path}.terms`),
    bankName: text(value.bankName, `${path}.bankName`),
    accountName: text(value.accountName, `${path}.accountName`),
    accountNumber: text(value.accountNumber, `${path}.accountNumber`),
    reference: text(value.reference, `${path}.reference`),
    updatedAt: text(value.updatedAt, `${path}.updatedAt`),
  };
  if (parsed.status !== 'draft') parsed.status = calculateInvoice(parsed).balance === 0 ? 'paid' : 'unpaid';
  return parsed;
}

/** Read a saved profile without allowing malformed fields into controlled inputs. */
export function parseCompany(raw: unknown): Company | null {
  try { return company(raw, 'Company'); }
  catch { return null; }
}

/** Recover valid local drafts independently; the first valid record for an ID wins. */
export function parseStoredInvoices(raw: unknown): Invoice[] {
  if (!Array.isArray(raw)) return [];
  const result: Invoice[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < Math.min(raw.length, MAX_INVOICES); index += 1) {
    try {
      const parsed = invoice(raw[index], `Invoices[${index}]`);
      if (!ids.has(parsed.id)) {
        ids.add(parsed.id);
        result.push(parsed);
      }
    } catch { /* A damaged draft must not prevent recovery of the remaining drafts. */ }
  }
  return result;
}

/** Validate a complete backup before the caller changes any existing state. */
export function parseBackup(raw: unknown): { company: Company | null; invoices: Invoice[] } {
  const value = record(raw, 'Backup');
  if (value.version !== 1) throw new Error('Backup version must be 1.');
  if (!Array.isArray(value.invoices)) throw new Error('Backup invoices must be a list.');
  if (value.invoices.length > MAX_INVOICES) throw new Error(`Backup exceeds the ${MAX_INVOICES}-invoice limit.`);
  const restoredCompany = value.company === undefined || value.company === null ? null : company(value.company, 'Company');
  const invoices = Array.from(value.invoices, (entry, index) => invoice(entry, `Invoices[${index}]`));
  const ids = new Set<string>();
  for (const restored of invoices) {
    if (ids.has(restored.id)) throw new Error('Backup contains a duplicate invoice ID.');
    ids.add(restored.id);
  }
  return { company: restoredCompany, invoices };
}
