export type InvoiceStatus = 'pending' | 'due_soon' | 'overdue' | 'paid';

export interface ReminderStep {
  id: string;
  dayOffset: number;
  label: string;
  tone: 'friendly' | 'direct' | 'firm' | 'final';
  subject: string;
  body: string;
}

export interface ReminderLog {
  id: string;
  invoiceId: string;
  stepId: string;
  sentAt: string;
  preview: string;
  subject?: string;
  body?: string;
  deliveryStatus?: 'logged' | 'mailto' | 'sent' | 'failed';
}

export interface Invoice {
  id: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  amount: number;
  invoiceNumber: string;
  issuedAt: string;
  dueAt: string;
  status: InvoiceStatus;
  paymentLink?: string;
  notes?: string;
  remindersSent: number;
  paidAt?: string;
}

export interface AppSettings {
  businessName: string;
  senderName: string;
  senderEmail: string;
  currency: string;
  locale: string;
  sequence: ReminderStep[];
}

/** Default reminder copy: short, direct, no apology fluff. */
export const DEFAULT_SEQUENCE: ReminderStep[] = [
  {
    id: 'r1',
    dayOffset: 1,
    label: 'Step 1 · Day after due',
    tone: 'friendly',
    subject: 'Invoice {{invoice_number}} was due {{due_date}}',
    body: `Hi {{client_name}},

Invoice {{invoice_number}} for {{amount}} was due {{due_date}}.

{{payment_link}}

Let me know when it goes out.

{{sender_name}}
{{business_name}}`,
  },
  {
    id: 'r2',
    dayOffset: 7,
    label: 'Step 2 · 7 days overdue',
    tone: 'direct',
    subject: 'Following up on invoice {{invoice_number}}',
    body: `Hi {{client_name}},

Following up on invoice {{invoice_number}} for {{amount}} (due {{due_date}}). Shout if you need the invoice resent.

{{payment_link}}

{{sender_name}}
{{business_name}}`,
  },
  {
    id: 'r3',
    dayOffset: 14,
    label: 'Step 3 · Clear ask',
    tone: 'firm',
    subject: 'Invoice {{invoice_number}}: payment needed this week',
    body: `Hi {{client_name}},

Invoice {{invoice_number}} for {{amount}} is two weeks past due.

Can you confirm when you'll send it this week?

{{payment_link}}

{{sender_name}}
{{business_name}}`,
  },
  {
    id: 'r4',
    dayOffset: 21,
    label: 'Step 4 · Pause work',
    tone: 'firm',
    subject: 'Pausing work until invoice {{invoice_number}} is paid',
    body: `Hi {{client_name}},

I still haven't received payment for invoice {{invoice_number}} ({{amount}}).

I'm pausing new work until this is cleared. Reply with a date if you want to keep going.

{{payment_link}}

{{sender_name}}
{{business_name}}`,
  },
  {
    id: 'r5',
    dayOffset: 30,
    label: 'Step 5 · Final notice',
    tone: 'final',
    subject: 'Final notice: invoice {{invoice_number}}',
    body: `Hi {{client_name}},

Last follow up on invoice {{invoice_number}} for {{amount}}. It's 30+ days overdue.

Please pay by {{final_deadline}}. If you already sent it, reply with the date.

{{payment_link}}

{{sender_name}}
{{business_name}}`,
  },
];
