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

/** Short, early, matter-of-fact — validated with freelancers who said apologetic copy creates awkwardness. */
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

Please confirm once it's sent.

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

Following up on invoice {{invoice_number}} for {{amount}} (due {{due_date}}). Let me know if you need anything from my end.

{{payment_link}}

{{sender_name}}
{{business_name}}`,
  },
  {
    id: 'r3',
    dayOffset: 14,
    label: 'Step 3 · Clear ask',
    tone: 'firm',
    subject: 'Invoice {{invoice_number}} — payment needed this week',
    body: `Hi {{client_name}},

Invoice {{invoice_number}} ({{amount}}) is now two weeks overdue.

Please confirm a payment date this week so I can close this out.

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

I still have not received payment for invoice {{invoice_number}} ({{amount}}).

I am pausing further work / final deliverables until this is settled. Reply with a payment date if you want to continue.

{{payment_link}}

{{sender_name}}
{{business_name}}`,
  },
  {
    id: 'r5',
    dayOffset: 30,
    label: 'Step 5 · Final notice',
    tone: 'final',
    subject: 'Final notice — invoice {{invoice_number}}',
    body: `Hi {{client_name}},

Final notice for invoice {{invoice_number}}: {{amount}}, now 30+ days past due.

Please send payment by {{final_deadline}}. I keep a record of all follow-ups.

If you already paid, reply with the transfer date and I will close this.

{{payment_link}}

{{sender_name}}
{{business_name}}`,
  },
];
