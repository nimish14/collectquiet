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
    label: 'Step 1 · Soft check-in',
    tone: 'friendly',
    subject: 'Re: Invoice {{invoice_number}} — quick check-in',
    body: `Hi {{client_name}},

Hope your week's going well. Wanted to bump invoice {{invoice_number}} ({{amount}}) — it was due {{due_date}}.

If it's already in process, ignore this — just let me know either way so I can update my records.

{{payment_link}}

Thanks,
{{sender_name}}
{{business_name}}`,
  },
  {
    id: 'r2',
    dayOffset: 7,
    label: 'Step 2 · Friendly follow-up',
    tone: 'friendly',
    subject: 'Following up — Invoice {{invoice_number}}',
    body: `Hi {{client_name}},

Circling back on invoice {{invoice_number}} for {{amount}}, about a week past due on my end.

When do you expect this to go out? Happy to resend the invoice or work out partial payment if that helps.

{{payment_link}}

Best,
{{sender_name}}`,
  },
  {
    id: 'r3',
    dayOffset: 14,
    label: 'Step 3 · Clear ask',
    tone: 'direct',
    subject: 'Invoice {{invoice_number}} — still outstanding',
    body: `Hi {{client_name}},

Invoice {{invoice_number}} ({{amount}}) is now two weeks overdue.

Can you confirm a payment date this week? If something's wrong with the invoice, tell me and I'll fix it — otherwise I need to get this closed out.

{{payment_link}}

Regards,
{{sender_name}}
{{business_name}}`,
  },
  {
    id: 'r4',
    dayOffset: 21,
    label: 'Step 4 · Work pause',
    tone: 'firm',
    subject: 'Pausing work until Invoice {{invoice_number}} is settled',
    body: `Hi {{client_name}},

I've followed up a few times on invoice {{invoice_number}} ({{amount}}) and haven't received payment or a confirmed date.

I'll need to pause any new work until this balance is cleared. Please reply with when payment will be sent.

{{payment_link}}

{{sender_name}}
{{business_name}}`,
  },
  {
    id: 'r5',
    dayOffset: 30,
    label: 'Step 5 · Final reminder',
    tone: 'final',
    subject: 'Final reminder — Invoice {{invoice_number}}',
    body: `Hi {{client_name}},

Final reminder for invoice {{invoice_number}}: {{amount}}, now 30+ days past due.

Please send payment by {{final_deadline}}. I keep a log of all reminders on file.

If you've already paid, reply with the transfer date and I'll close this immediately.

{{payment_link}}

{{sender_name}}
{{business_name}}`,
  },
];
