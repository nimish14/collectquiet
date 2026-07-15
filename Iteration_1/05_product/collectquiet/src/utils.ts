import type { AppSettings, Invoice, ReminderStep } from './types';

export function formatMoney(n: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'INR' ? 0 : 2,
  }).format(n);
}

export function formatDate(iso: string, locale = 'en-US'): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function daysOverdue(dueAt: string): number {
  const due = new Date(dueAt + 'T12:00:00');
  const now = new Date();
  return Math.max(0, Math.floor((now.getTime() - due.getTime()) / 86400000));
}

export function daysUntilDue(dueAt: string): number {
  const due = new Date(dueAt + 'T12:00:00');
  const now = new Date();
  return Math.floor((due.getTime() - now.getTime()) / 86400000);
}

export function computeStatus(invoice: {
  status: string;
  paidAt?: string;
  dueAt: string;
}): 'pending' | 'due_soon' | 'overdue' | 'paid' {
  if (invoice.status === 'paid' || invoice.paidAt) return 'paid';
  if (daysOverdue(invoice.dueAt) > 0) return 'overdue';
  if (daysUntilDue(invoice.dueAt) <= 3) return 'due_soon';
  return 'pending';
}

export function renderTemplate(
  step: { subject: string; body: string },
  invoice: { clientName: string; invoiceNumber: string; amount: number; dueAt: string; paymentLink?: string },
  settings: AppSettings
): { subject: string; body: string } {
  const vars: Record<string, string> = {
    client_name: invoice.clientName,
    invoice_number: invoice.invoiceNumber,
    amount: formatMoney(invoice.amount, settings.currency, settings.locale),
    due_date: formatDate(invoice.dueAt, settings.locale),
    sender_name: settings.senderName,
    business_name: settings.businessName,
    payment_link: invoice.paymentLink ? `Payment link: ${invoice.paymentLink}` : '',
    final_deadline: formatDate(
      new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      settings.locale
    ),
  };
  const replace = (s: string) =>
    s
      .replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  return { subject: replace(step.subject), body: replace(step.body) };
}

/** Next reminder in sequence that is schedule-ready (dayOffset ≤ days overdue). */
export function readyReminder(
  invoice: Invoice,
  sequence: ReminderStep[]
): ReminderStep | null {
  if (invoice.status === 'paid') return null;
  const step = sequence[invoice.remindersSent];
  if (!step) return null;
  const overdue = daysOverdue(invoice.dueAt);
  if (overdue < step.dayOffset) return null;
  return step;
}

export function invoicesReadyToday(invoices: Invoice[], sequence: ReminderStep[]): Invoice[] {
  return invoices.filter((i) => readyReminder(i, sequence) !== null);
}

export function nextInvoiceNumber(): string {
  return `INV-${Math.floor(Math.random() * 9000 + 1000)}`;
}

export function openMailto(to: string, subject: string, body: string): void {
  const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.open(url, '_blank');
}

export function openWhatsApp(phone: string, message: string): void {
  const digits = phone.replace(/\D/g, '');
  window.open(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`, '_blank');
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
