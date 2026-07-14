import { supabase } from './supabase';
import type { AppSettings, Invoice, ReminderLog, ReminderStep } from '../types';
import { DEFAULT_SEQUENCE } from '../types';
import { computeStatus } from '../utils';

type InvoiceRow = {
  id: string;
  client_name: string;
  client_email: string;
  client_phone: string | null;
  amount: number;
  invoice_number: string;
  issued_at: string;
  due_at: string;
  status: string;
  payment_link: string | null;
  notes: string | null;
  reminders_sent: number;
  paid_at: string | null;
};

type LogRow = {
  id: string;
  invoice_id: string;
  step_id: string;
  subject: string;
  body: string;
  preview: string;
  sent_at: string;
  delivery_status: string;
};

type ProfileRow = {
  business_name: string;
  sender_name: string;
  sender_email: string;
  currency: string;
  locale: string;
  sequence: ReminderStep[] | null;
};

function rowToInvoice(row: InvoiceRow): Invoice {
  const invoice: Invoice = {
    id: row.id,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone ?? undefined,
    amount: Number(row.amount),
    invoiceNumber: row.invoice_number,
    issuedAt: row.issued_at,
    dueAt: row.due_at,
    status: row.status as Invoice['status'],
    paymentLink: row.payment_link ?? undefined,
    notes: row.notes ?? undefined,
    remindersSent: row.reminders_sent,
    paidAt: row.paid_at ?? undefined,
  };
  invoice.status = computeStatus(invoice);
  return invoice;
}

function rowToLog(row: LogRow): ReminderLog {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    stepId: row.step_id,
    sentAt: row.sent_at,
    preview: row.preview,
    subject: row.subject,
    body: row.body,
    deliveryStatus: row.delivery_status as ReminderLog['deliveryStatus'],
  };
}

export async function fetchSettings(userId: string): Promise<AppSettings> {
  const { data, error } = await supabase
    .from('cq_profiles')
    .select('business_name, sender_name, sender_email, currency, locale, sequence')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    return {
      businessName: '',
      senderName: '',
      senderEmail: '',
      currency: 'USD',
      locale: 'en-US',
      sequence: DEFAULT_SEQUENCE,
    };
  }

  const row = data as ProfileRow;
  return {
    businessName: row.business_name ?? '',
    senderName: row.sender_name ?? '',
    senderEmail: row.sender_email ?? '',
    currency: row.currency ?? 'USD',
    locale: row.locale ?? 'en-US',
    sequence: Array.isArray(row.sequence) && row.sequence.length > 0 ? row.sequence : DEFAULT_SEQUENCE,
  };
}

export async function saveSettings(userId: string, settings: AppSettings): Promise<void> {
  const { error } = await supabase.from('cq_profiles').upsert({
    user_id: userId,
    business_name: settings.businessName,
    sender_name: settings.senderName,
    sender_email: settings.senderEmail,
    currency: settings.currency,
    locale: settings.locale,
    sequence: settings.sequence,
  });
  if (error) throw error;
}

export async function fetchInvoices(userId: string): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('cq_invoices')
    .select('*')
    .eq('user_id', userId)
    .order('due_at', { ascending: false });

  if (error) throw error;
  return (data as InvoiceRow[]).map(rowToInvoice);
}

export async function createInvoice(
  userId: string,
  invoice: Omit<Invoice, 'id' | 'remindersSent' | 'status'> & { status?: Invoice['status'] }
): Promise<Invoice> {
  const status = invoice.status ?? computeStatus({ ...invoice, status: 'pending' });
  const { data, error } = await supabase
    .from('cq_invoices')
    .insert({
      user_id: userId,
      client_name: invoice.clientName,
      client_email: invoice.clientEmail,
      client_phone: invoice.clientPhone ?? null,
      amount: invoice.amount,
      invoice_number: invoice.invoiceNumber,
      issued_at: invoice.issuedAt,
      due_at: invoice.dueAt,
      status,
      payment_link: invoice.paymentLink ?? null,
      notes: invoice.notes ?? null,
      reminders_sent: 0,
      paid_at: invoice.paidAt ?? null,
    })
    .select('*')
    .single();

  if (error) throw error;
  return rowToInvoice(data as InvoiceRow);
}

export async function updateInvoice(
  userId: string,
  id: string,
  patch: Partial<Pick<Invoice, 'remindersSent' | 'status' | 'paidAt'>>
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.remindersSent !== undefined) payload.reminders_sent = patch.remindersSent;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.paidAt !== undefined) payload.paid_at = patch.paidAt;

  const { error } = await supabase.from('cq_invoices').update(payload).eq('id', id).eq('user_id', userId);
  if (error) throw error;
}

export async function deleteInvoice(userId: string, id: string): Promise<void> {
  const { error } = await supabase.from('cq_invoices').delete().eq('id', id).eq('user_id', userId);
  if (error) throw error;
}

export async function fetchLogs(userId: string): Promise<ReminderLog[]> {
  const { data, error } = await supabase
    .from('cq_reminder_logs')
    .select('*')
    .eq('user_id', userId)
    .order('sent_at', { ascending: false });

  if (error) throw error;
  return (data as LogRow[]).map(rowToLog);
}

export async function createReminderLog(
  userId: string,
  log: {
    invoiceId: string;
    stepId: string;
    subject: string;
    body: string;
    preview: string;
    deliveryStatus: ReminderLog['deliveryStatus'];
  }
): Promise<ReminderLog> {
  const { data, error } = await supabase
    .from('cq_reminder_logs')
    .insert({
      user_id: userId,
      invoice_id: log.invoiceId,
      step_id: log.stepId,
      subject: log.subject,
      body: log.body,
      preview: log.preview,
      delivery_status: log.deliveryStatus,
    })
    .select('*')
    .single();

  if (error) throw error;
  return rowToLog(data as LogRow);
}

export async function createInvoicesBulk(
  userId: string,
  items: Array<Omit<Invoice, 'id' | 'remindersSent' | 'status'>>
): Promise<{ imported: number; failed: Array<{ invoiceNumber: string; reason: string }> }> {
  const failed: Array<{ invoiceNumber: string; reason: string }> = [];
  let imported = 0;

  for (const item of items) {
    try {
      await createInvoice(userId, item);
      imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Insert failed';
      failed.push({
        invoiceNumber: item.invoiceNumber,
        reason: msg.includes('duplicate') ? 'Invoice number already exists.' : msg,
      });
    }
  }

  return { imported, failed };
}

export function exportCsv(invoices: Invoice[], logs: ReminderLog[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = 'invoice_number,client,email,phone,amount,status,due_date,reminders_sent,paid_at\n';
  const rows = invoices
    .map((i) =>
      [
        esc(i.invoiceNumber),
        esc(i.clientName),
        esc(i.clientEmail),
        esc(i.clientPhone ?? ''),
        i.amount,
        i.status,
        i.dueAt,
        i.remindersSent,
        i.paidAt ?? '',
      ].join(',')
    )
    .join('\n');
  const logHeader = '\n\nreminder_log\ninvoice_number,sent_at,preview,delivery_status\n';
  const logRows = logs
    .map((l) => {
      const inv = invoices.find((i) => i.id === l.invoiceId);
      return [esc(inv?.invoiceNumber ?? l.invoiceId), l.sentAt, esc(l.preview), l.deliveryStatus ?? 'logged'].join(',');
    })
    .join('\n');
  return header + rows + logHeader + logRows;
}
