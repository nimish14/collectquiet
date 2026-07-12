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

export const DEFAULT_SEQUENCE: ReminderStep[] = [
  {
    id: 'r1',
    dayOffset: 1,
    label: 'Day +1 · Gentle nudge',
    tone: 'friendly',
    subject: 'Quick reminder — Invoice {{invoice_number}}',
    body: `Hi {{client_name}},

Hope you're doing well. This is a gentle reminder that invoice {{invoice_number}} for {{amount}} was due on {{due_date}}.

If you've already sent payment, please ignore this message — thank you!

{{payment_link}}

Best,
{{sender_name}}
{{business_name}}`,
  },
  {
    id: 'r2',
    dayOffset: 7,
    label: 'Day +7 · Friendly follow-up',
    tone: 'friendly',
    subject: 'Following up on Invoice {{invoice_number}}',
    body: `Hi {{client_name}},

Wanted to follow up on invoice {{invoice_number}} ({{amount}}), now a week past due.

Could you let me know when I can expect payment? Happy to resend the invoice if needed.

{{payment_link}}

Thanks,
{{sender_name}}`,
  },
  {
    id: 'r3',
    dayOffset: 14,
    label: 'Day +14 · Direct',
    tone: 'direct',
    subject: 'Payment needed — Invoice {{invoice_number}}',
    body: `Hi {{client_name}},

Invoice {{invoice_number}} for {{amount}} is now 14 days overdue per our terms.

Please arrange payment this week or reply if there's an issue we should know about.

{{payment_link}}

Regards,
{{sender_name}}
{{business_name}}`,
  },
  {
    id: 'r4',
    dayOffset: 21,
    label: 'Day +21 · Work pause warning',
    tone: 'firm',
    subject: 'Action required — Invoice {{invoice_number}} overdue',
    body: `Hi {{client_name}},

Invoice {{invoice_number}} ({{amount}}) remains unpaid after multiple reminders.

Per our agreement, I will pause any active work until this balance is cleared.

Please confirm payment date within 3 business days.

{{payment_link}}

{{sender_name}}`,
  },
  {
    id: 'r5',
    dayOffset: 30,
    label: 'Day +30 · Final notice',
    tone: 'final',
    subject: 'Final notice — Invoice {{invoice_number}}',
    body: `Hi {{client_name}},

This is a final notice for invoice {{invoice_number}}: {{amount}}, now 30+ days overdue.

If payment is not received by {{final_deadline}}, I will suspend services and consider further collection options. A log of all reminder correspondence is on file.

{{payment_link}}

{{sender_name}}
{{business_name}}`,
  },
];

