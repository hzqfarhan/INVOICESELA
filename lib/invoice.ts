export type Currency = 'MYR' | 'USD' | 'SGD';

export interface Company {
  name: string;
  email: string;
  phone: string;
  address: string;
  website: string;
  registration: string;
  taxId: string;
}

export interface Client {
  name: string;
  email: string;
  address: string;
  registration: string;
}

export interface LineItem {
  id: string;
  description: string;
  details: string;
  quantity: number;
  rate: number;
}

export interface Invoice {
  id: string;
  number: string;
  issueDate: string;
  dueDate: string;
  currency: Currency;
  status: 'draft' | 'unpaid' | 'paid';
  from: Company;
  client: Client;
  items: LineItem[];
  discountRate: number;
  taxRate: number;
  amountPaid: number;
  notes: string;
  terms: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  reference: string;
  updatedAt: string;
}

export const defaultCompany: Company = {
  name: 'Seladevs',
  email: 'seladevs@gmail.com',
  phone: '',
  address: '',
  website: 'seladevs.my',
  registration: '',
  taxId: '',
};

const MAX_CENTS = Number.MAX_SAFE_INTEGER;

function nonnegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function percentage(value: number): number {
  return Math.min(100, nonnegative(value));
}

// Round each monetary stage to cents so the displayed lines reconcile with totals.
function toCents(value: number): number {
  const scaled = nonnegative(value) * 100;
  if (!Number.isFinite(scaled) || scaled >= MAX_CENTS) return MAX_CENTS;
  return Math.round(scaled + Number.EPSILON * Math.max(1, Math.abs(scaled)));
}

function roundCents(value: number): number {
  return Math.min(MAX_CENTS, Math.round(value + Number.EPSILON * Math.max(1, Math.abs(value))));
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const result = new Date(0);
  result.setFullYear(year, month - 1, day);
  result.setHours(12, 0, 0, 0);
  return result.getFullYear() === year && result.getMonth() === month - 1 && result.getDate() === day
    ? result
    : null;
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createInvoice(company: Company = defaultCompany, existing: Invoice[] = []): Invoice {
  const now = new Date();
  const year = now.getFullYear();
  const sequencePattern = new RegExp(`^INV-${year}-(\\d+)$`);
  const lastSequence = existing.reduce((highest, invoice) => {
    const match = sequencePattern.exec(invoice.number);
    const sequence = match ? Number(match[1]) : 0;
    return Number.isSafeInteger(sequence) ? Math.max(highest, sequence) : highest;
  }, 0);
  const due = new Date(now);
  due.setDate(due.getDate() + 14);

  return {
    id: createId(),
    number: `INV-${year}-${String(lastSequence + 1).padStart(3, '0')}`,
    issueDate: localDate(now),
    dueDate: localDate(due),
    currency: 'MYR',
    status: 'draft',
    from: { ...company },
    client: { name: '', email: '', address: '', registration: '' },
    items: [{
      id: createId(),
      description: 'Website design & development',
      details: 'Design, development and deployment',
      quantity: 1,
      rate: 2500,
    }],
    discountRate: 0,
    taxRate: 0,
    amountPaid: 0,
    notes: 'Thank you for trusting Seladevs with your next big idea.',
    terms: 'Payment is due by the date shown above. Please include the invoice number as your payment reference.',
    bankName: '',
    accountName: '',
    accountNumber: '',
    reference: '',
    updatedAt: now.toISOString(),
  };
}

export function calculateInvoice(invoice: Invoice) {
  const subtotalCents = invoice.items.reduce((sum, item) => {
    const line = toCents(nonnegative(item.quantity) * nonnegative(item.rate));
    return Math.min(MAX_CENTS, sum + line);
  }, 0);
  const discountCents = roundCents(subtotalCents * percentage(invoice.discountRate) / 100);
  const taxableCents = subtotalCents - discountCents;
  const taxCents = roundCents(taxableCents * percentage(invoice.taxRate) / 100);
  const totalCents = Math.min(MAX_CENTS, taxableCents + taxCents);
  const paidCents = toCents(invoice.amountPaid);

  return {
    subtotal: subtotalCents / 100,
    discount: discountCents / 100,
    tax: taxCents / 100,
    total: totalCents / 100,
    paid: paidCents / 100,
    balance: Math.max(0, totalCents - paidCents) / 100,
  };
}

export function formatMoney(value: number, currency: Currency = 'MYR'): string {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatDate(date: string): string {
  const parsed = parseDate(date);
  return parsed ? new Intl.DateTimeFormat('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed) : '—';
}

export function validateInvoice(invoice: Invoice): string[] {
  const errors: string[] = [];
  if (!invoice.number.trim()) errors.push('Add an invoice number.');
  if (!invoice.from.name.trim()) errors.push('Add your company name.');
  if (!invoice.client.name.trim()) errors.push('Add a client name.');

  const issue = parseDate(invoice.issueDate);
  const due = parseDate(invoice.dueDate);
  if (!issue) errors.push('Enter a valid invoice date.');
  if (!due) errors.push('Enter a valid due date.');
  if (issue && due && due < issue) errors.push('The due date must be on or after the invoice date.');

  let validLines = 0;
  invoice.items.forEach((item, index) => {
    const label = `Item ${index + 1}`;
    const hasDescription = Boolean(item.description.trim());
    const validQuantity = Number.isFinite(item.quantity) && item.quantity > 0;
    const validRate = Number.isFinite(item.rate) && item.rate >= 0;
    if (!hasDescription) errors.push(`${label}: add a description.`);
    if (!validQuantity) errors.push(`${label}: quantity must be greater than zero.`);
    if (!validRate) errors.push(`${label}: rate must be zero or greater.`);
    if (hasDescription && validQuantity && validRate) validLines += 1;
  });
  if (!validLines) errors.push('Add at least one valid line item.');

  if (!Number.isFinite(invoice.discountRate) || invoice.discountRate < 0 || invoice.discountRate > 100) {
    errors.push('Discount must be between 0% and 100%.');
  }
  if (!Number.isFinite(invoice.taxRate) || invoice.taxRate < 0 || invoice.taxRate > 100) {
    errors.push('Tax must be between 0% and 100%.');
  }
  if (!Number.isFinite(invoice.amountPaid) || invoice.amountPaid < 0) {
    errors.push('Amount paid must be zero or greater.');
  } else if (toCents(invoice.amountPaid) > toCents(calculateInvoice(invoice).total)) {
    errors.push('Amount paid cannot exceed the invoice total.');
  }
  return errors;
}
