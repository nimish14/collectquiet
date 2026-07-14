import './style.css';
import type { Session, User } from '@supabase/supabase-js';
import {
  createInvoice,
  createInvoicesBulk,
  createReminderLog,
  deleteInvoice,
  exportCsv,
  fetchInvoices,
  fetchLogs,
  fetchSettings,
  saveSettings,
  submitFeedback,
  updateInvoice,
} from './lib/db';
import { downloadCsvTemplate, parseInvoiceCsv, type ParsedInvoiceRow } from './lib/csv-import';
import { escapeHtml } from './lib/escape';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import type { AppSettings, Invoice } from './types';
import { DEFAULT_SEQUENCE } from './types';
import {
  copyText,
  daysOverdue,
  formatDate,
  formatMoney,
  nextInvoiceNumber,
  openMailto,
  openWhatsApp,
  renderTemplate,
} from './utils';

type View = 'landing' | 'dashboard' | 'sequences' | 'settings' | 'auth';

interface State {
  view: View;
  session: Session | null;
  user: User | null;
  loading: boolean;
  authMode: 'signin' | 'signup';
  invoices: Invoice[];
  logs: Awaited<ReturnType<typeof fetchLogs>>;
  settings: AppSettings;
  selectedId: string | null;
  showAddModal: boolean;
  showImportModal: boolean;
  showFeedbackModal: boolean;
  feedbackSubmitting: boolean;
  importPreview: ParsedInvoiceRow[] | null;
  importErrors: string[];
  importInProgress: boolean;
  toast: string | null;
  toastError: boolean;
  pendingInvoiceNumber: string;
}

const app = document.querySelector<HTMLDivElement>('#app')!;

const state: State = {
  view: 'landing',
  session: null,
  user: null,
  loading: true,
  authMode: 'signin',
  invoices: [],
  logs: [],
  settings: {
    businessName: '',
    senderName: '',
    senderEmail: '',
    currency: 'USD',
    locale: 'en-US',
    sequence: DEFAULT_SEQUENCE,
  },
  selectedId: null,
  showAddModal: false,
  showImportModal: false,
  showFeedbackModal: false,
  feedbackSubmitting: false,
  importPreview: null,
  importErrors: [],
  importInProgress: false,
  toast: null,
  toastError: false,
  pendingInvoiceNumber: nextInvoiceNumber(),
};

function toast(msg: string, isError = false): void {
  state.toast = msg;
  state.toastError = isError;
  render();
  setTimeout(() => {
    state.toast = null;
    render();
  }, 3200);
}

function outstanding(): number {
  return state.invoices.filter((i) => i.status !== 'paid').reduce((s, i) => s + i.amount, 0);
}

function collected(): number {
  return state.invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
}

function requireAuth(view: View): View {
  if (!state.session && ['dashboard', 'sequences', 'settings'].includes(view)) {
    state.authMode = 'signin';
    state.view = 'auth';
    return 'auth';
  }
  return view;
}

function resolveNav(view: View): View {
  if (view === 'auth' && state.session) return 'dashboard';
  return requireAuth(view);
}

async function loadUserData(): Promise<void> {
  if (!state.user) return;
  state.loading = true;
  render();
  try {
    const [settings, invoices, logs] = await Promise.all([
      fetchSettings(state.user.id),
      fetchInvoices(state.user.id),
      fetchLogs(state.user.id),
    ]);
    state.settings = settings;
    state.invoices = invoices;
    state.logs = logs;
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Failed to load data', true);
  } finally {
    state.loading = false;
    render();
  }
}

function closeModals(): void {
  state.showAddModal = false;
  state.showImportModal = false;
  state.showFeedbackModal = false;
  state.feedbackSubmitting = false;
  state.importPreview = null;
  state.importErrors = [];
  state.importInProgress = false;
}

async function handleImportConfirm(): Promise<void> {
  if (!state.user || !state.importPreview?.length || state.importErrors.length) return;
  state.importInProgress = true;
  render();
  try {
    const result = await createInvoicesBulk(
      state.user.id,
      state.importPreview.map((r) => ({
        clientName: r.clientName,
        clientEmail: r.clientEmail,
        clientPhone: r.clientPhone,
        amount: r.amount,
        invoiceNumber: r.invoiceNumber,
        issuedAt: r.issuedAt,
        dueAt: r.dueAt,
        paymentLink: r.paymentLink,
        notes: r.notes,
      }))
    );
    closeModals();
    if (result.failed.length) {
      toast(
        `Imported ${result.imported}. ${result.failed.length} failed.`,
        result.imported === 0
      );
    } else {
      toast(`Imported ${result.imported} invoice${result.imported === 1 ? '' : 's'}.`);
    }
    await loadUserData();
  } catch (err) {
    state.importInProgress = false;
    toast(err instanceof Error ? err.message : 'Import failed', true);
    render();
  }
}

function handleImportFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result ?? '');
    const existing = new Set(state.invoices.map((i) => i.invoiceNumber));
    const { rows, errors } = parseInvoiceCsv(text, existing);
    state.importPreview = rows.length ? rows : null;
    state.importErrors = errors;
    render();
  };
  reader.onerror = () => toast('Could not read file.', true);
  reader.readAsText(file);
}

async function sendReminder(invoice: Invoice, channel: 'email' | 'whatsapp'): Promise<void> {
  if (!state.user || invoice.status === 'paid') return;
  const step = state.settings.sequence[invoice.remindersSent];
  if (!step) {
    toast('All reminders in sequence have been sent.');
    return;
  }
  const { subject, body } = renderTemplate(step, invoice, state.settings);
  const message = `Subject: ${subject}\n\n${body}`;
  try {
    if (channel === 'whatsapp') {
      if (!invoice.clientPhone) {
        toast('Add client phone number to send WhatsApp reminders.', true);
        return;
      }
      openWhatsApp(invoice.clientPhone, message);
    } else {
      openMailto(invoice.clientEmail, subject, body);
    }
    await createReminderLog(state.user.id, {
      invoiceId: invoice.id,
      stepId: step.id,
      subject,
      body,
      preview: `${subject} — ${body.slice(0, 120)}...`,
      deliveryStatus: channel === 'whatsapp' ? 'sent' : 'mailto',
    });
    await updateInvoice(state.user.id, invoice.id, { remindersSent: invoice.remindersSent + 1 });
    toast(`Reminder ${invoice.remindersSent + 1} sent via ${channel === 'whatsapp' ? 'WhatsApp' : 'email'}.`);
    await loadUserData();
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Failed to send reminder', true);
  }
}

async function removeInvoice(id: string): Promise<void> {
  if (!state.user || !confirm('Delete this invoice and its reminder history?')) return;
  try {
    await deleteInvoice(state.user.id, id);
    if (state.selectedId === id) state.selectedId = null;
    toast('Invoice deleted.');
    await loadUserData();
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Delete failed', true);
  }
}

async function markPaid(id: string): Promise<void> {
  if (!state.user) return;
  try {
    await updateInvoice(state.user.id, id, {
      status: 'paid',
      paidAt: new Date().toISOString().slice(0, 10),
    });
    toast('Invoice marked paid — reminders stopped.');
    await loadUserData();
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Failed to update invoice', true);
  }
}

async function addInvoice(data: FormData): Promise<void> {
  if (!state.user) return;
  const dueAt = String(data.get('dueAt'));
  const issuedAt = String(data.get('issuedAt'));
  if (dueAt < issuedAt) {
    toast('Due date must be on or after issue date.', true);
    return;
  }
  try {
    await createInvoice(state.user.id, {
      clientName: String(data.get('clientName')),
      clientEmail: String(data.get('clientEmail')),
      clientPhone: String(data.get('clientPhone') || '') || undefined,
      amount: Number(data.get('amount')),
      invoiceNumber: String(data.get('invoiceNumber')),
      issuedAt,
      dueAt,
      paymentLink: String(data.get('paymentLink') || '') || undefined,
    });
    state.showAddModal = false;
    state.pendingInvoiceNumber = nextInvoiceNumber();
    toast('Invoice added.');
    await loadUserData();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to add invoice';
    toast(msg.includes('duplicate') ? 'Invoice number already exists.' : msg, true);
  }
}

async function handleSignIn(data: FormData): Promise<void> {
  if (!isSupabaseConfigured) {
    toast('App is temporarily unavailable. Please try again later.', true);
    return;
  }
  const email = String(data.get('email'));
  const password = String(data.get('password'));
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) toast(error.message, true);
  else {
    state.view = 'dashboard';
    toast('Signed in.');
  }
}

async function handleSignUp(data: FormData): Promise<void> {
  if (!isSupabaseConfigured) {
    toast('App is temporarily unavailable. Please try again later.', true);
    return;
  }
  const email = String(data.get('email'));
  const password = String(data.get('password'));
  if (password.length < 8) {
    toast('Password must be at least 8 characters.', true);
    return;
  }
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) toast(error.message, true);
  else toast('Account created. Check email if confirmation is required, then sign in.');
}

async function handleResetPassword(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/`,
  });
  if (error) toast(error.message, true);
  else toast('Password reset link sent to your email.');
}

async function handleFeedbackSubmit(data: FormData): Promise<void> {
  if (!isSupabaseConfigured) {
    toast('App is temporarily unavailable. Please try again later.', true);
    return;
  }
  const message = String(data.get('message') ?? '').trim();
  if (!message) {
    toast('Please enter your feedback.', true);
    return;
  }
  const category = String(data.get('category') ?? 'other');
  const email = state.user?.email ?? String(data.get('email') ?? '').trim();
  if (!state.user && !email) {
    toast('Enter your email so we can follow up.', true);
    return;
  }

  state.feedbackSubmitting = true;
  render();
  try {
    await submitFeedback({
      userId: state.user?.id ?? null,
      email: email || undefined,
      category: category === 'bug' || category === 'feature' ? category : 'other',
      message,
      page: state.view,
    });
    closeModals();
    toast('Thanks — we got your feedback.');
  } catch (err) {
    state.feedbackSubmitting = false;
    toast(err instanceof Error ? err.message : 'Could not send feedback', true);
    render();
  }
}

async function handleSignOut(): Promise<void> {
  await supabase.auth.signOut();
  state.invoices = [];
  state.logs = [];
  state.view = 'landing';
  toast('Signed out.');
}

function navLink(view: View, label: string): string {
  const active = state.view === view ? 'nav-link active' : 'nav-link';
  return `<button class="${active}" data-nav="${view}">${label}</button>`;
}

function statusBadge(status: Invoice['status']): string {
  const map = {
    pending: 'badge badge-neutral',
    due_soon: 'badge badge-warn',
    overdue: 'badge badge-danger',
    paid: 'badge badge-ok',
  };
  const labels = { pending: 'Pending', due_soon: 'Due soon', overdue: 'Overdue', paid: 'Paid' };
  return `<span class="${map[status]}">${labels[status]}</span>`;
}

const LANDING_DEMO_SETTINGS: AppSettings = {
  businessName: 'Northline Studio',
  senderName: 'Jordan',
  senderEmail: 'jordan@example.com',
  currency: 'USD',
  locale: 'en-US',
  sequence: DEFAULT_SEQUENCE,
};

const LANDING_DEMO_INVOICE = {
  clientName: 'Alex at Brand Studio',
  invoiceNumber: 'INV-2041',
  amount: 2800,
  dueAt: '2026-06-15',
  paymentLink: undefined as string | undefined,
};

function landingReminderShowcase(): string {
  const showcaseSteps = [0, 1, 4];
  const cards = showcaseSteps
    .map((idx) => {
      const step = DEFAULT_SEQUENCE[idx];
      const { subject, body } = renderTemplate(step, LANDING_DEMO_INVOICE, LANDING_DEMO_SETTINGS);
      return `
      <article class="showcase-card tone-${escapeHtml(step.tone)}">
        <header>
          <span class="badge badge-neutral">${escapeHtml(step.label)}</span>
          <span class="tone-tag">${escapeHtml(step.tone)}</span>
        </header>
        <p class="showcase-subject">${escapeHtml(subject)}</p>
        <pre class="showcase-body">${escapeHtml(body)}</pre>
      </article>`;
    })
    .join('');

  return `
  <section class="reminders-showcase" id="reminders">
    <h2>The awkward message — already written for you</h2>
    <p class="lead">You don't have to stare at a blank screen at midnight. CollectQuiet gives you five ready-to-send reminders that sound like a professional, not a collections agency.</p>
    <div class="showcase-grid">${cards}</div>
    <p class="showcase-note">Steps 3–5 escalate tone automatically. You send via email or WhatsApp — we fill in client name, amount, and invoice #.</p>
  </section>`;
}

function landingHtml(): string {
  const heroPreview = renderTemplate(DEFAULT_SEQUENCE[1], LANDING_DEMO_INVOICE, LANDING_DEMO_SETTINGS);

  return `
  <section class="hero">
    <div class="hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">For freelancers, consultants & small studios</p>
        <h1>You did the work. <em>We'll help you ask for the money.</em></h1>
        <p class="lead">Late invoices stall because the follow-up feels awkward — not because the client forgot. CollectQuiet gives you ready-to-send reminder messages (email or WhatsApp) that escalate from polite to firm, so you stop drafting "just checking in on the invoice" at midnight and start getting paid.</p>
        <div class="hero-cta">
          ${state.session
            ? `<button class="btn btn-primary" data-nav="dashboard">Go to dashboard</button>`
            : `<button class="btn btn-primary" data-nav="auth">Start free</button>
          <button class="btn btn-ghost" data-nav="auth">Sign in</button>`}
          <button class="btn btn-ghost" data-scroll="reminders">See the messages</button>
          <button class="btn btn-ghost" data-scroll="proof">Why chasing feels awkward</button>
        </div>
        <ul class="hero-points">
          <li>Pre-written chase messages — friendly to final notice</li>
          <li>Send via email or WhatsApp in one click</li>
          <li>Track every reminder so money doesn't slip through</li>
        </ul>
      </div>
      <div class="hero-card">
        <div class="mock-header">
          <span>Overdue this week</span>
          <strong>${formatMoney(outstanding() || 4500, 'USD')}</strong>
        </div>
        <div class="mock-rows">
          <div class="mock-row"><span>Brand Studio</span><span class="danger">${formatMoney(2800, 'USD')}</span></div>
          <div class="mock-row"><span>Startup Client</span><span class="danger">${formatMoney(1700, 'USD')}</span></div>
        </div>
        <div class="mock-reminder">
          <small>Next reminder · Step 2 · WhatsApp</small>
          <p class="mock-reminder-subject">${escapeHtml(heroPreview.subject)}</p>
          <pre class="mock-reminder-body">${escapeHtml(heroPreview.body)}</pre>
          <span class="badge badge-ok">Sounds professional — not desperate</span>
        </div>
      </div>
    </div>
  </section>
  ${landingReminderShowcase()}
  <section class="proof" id="proof">
    <h2>Real people. Real pain. Fetched from the open web.</h2>
    <div class="quote-grid">
      <blockquote><p>"The worst part isn't sending the invoice, it's chasing it afterwards."</p><cite><a href="https://www.indiehackers.com/post/chasing-overdue-invoices-is-awkward-i-built-a-small-tool-to-automate-reminders-4f89bae266" target="_blank" rel="noopener">Indie Hackers · Mar 2026</a></cite></blockquote>
      <blockquote><p>"It makes him feel like he's being desperate, which he hates."</p><cite><a href="https://www.indiehackers.com/post/chasing-overdue-invoices-is-awkward-i-built-a-small-tool-to-automate-reminders-4f89bae266" target="_blank" rel="noopener">Indie Hackers · electrician persona</a></cite></blockquote>
      <blockquote><p>"She wrote off $12,000 last year because she didn't want to 'bother' her clients."</p><cite><a href="https://www.indiehackers.com/post/i-built-an-ai-that-collects-overdue-invoices-for-quickbooks-users-looking-for-beta-testers-GvUXtcIzt3SEt9bfLP4l" target="_blank" rel="noopener">Indie Hackers · Dueflo founder</a></cite></blockquote>
    </div>
  </section>
  <section class="features">
    <h2>How CollectQuiet works</h2>
    <div class="feature-grid">
      <article><span class="step">1</span><h3>Log the invoice once</h3><p>Client, amount, due date. No QuickBooks required.</p></article>
      <article><span class="step">2</span><h3>Send the chase</h3><p>Pick email or WhatsApp. The message is written — you just hit send.</p></article>
      <article><span class="step">3</span><h3>Stop when you're paid</h3><p>Mark paid in one click. Export the audit log anytime.</p></article>
    </div>
  </section>`;
}

function authHtml(): string {
  const isSignIn = state.authMode === 'signin';
  return `
  <div class="page auth-page">
    <h1>${isSignIn ? 'Sign in' : 'Create account'}</h1>
    <p class="lead">Your invoices and reminder history are stored securely in your account.</p>
    <form class="settings-form" id="auth-form">
      <label>Email<input name="email" type="email" required autocomplete="email" /></label>
      <label>Password<input name="password" type="password" required minlength="8" autocomplete="${isSignIn ? 'current-password' : 'new-password'}" /></label>
      <button class="btn btn-primary" type="submit">${isSignIn ? 'Sign in' : 'Sign up'}</button>
    </form>
    <p class="muted"><button class="link-btn" data-auth-toggle>${isSignIn ? 'Need an account? Sign up' : 'Already have an account? Sign in'}</button></p>
    ${isSignIn ? '<p class="muted"><button class="link-btn" data-reset-password>Forgot password?</button></p>' : ''}
  </div>`;
}

function dashboardHtml(): string {
  if (state.loading) return '<div class="page"><p class="lead">Loading your invoices…</p></div>';

  const selected = state.invoices.find((i) => i.id === state.selectedId);
  const overdue = state.invoices.filter((i) => i.status === 'overdue');

  const rows = state.invoices.length
    ? state.invoices
        .map(
          (i) => `
    <tr class="inv-row ${state.selectedId === i.id ? 'selected' : ''}" data-select="${escapeHtml(i.id)}">
      <td><strong>${escapeHtml(i.invoiceNumber)}</strong><br><small>${escapeHtml(i.clientName)}</small></td>
      <td>${formatMoney(i.amount, state.settings.currency, state.settings.locale)}</td>
      <td>${formatDate(i.dueAt, state.settings.locale)}</td>
      <td>${statusBadge(i.status)}</td>
      <td>${i.status === 'overdue' ? daysOverdue(i.dueAt) + 'd' : '—'}</td>
      <td>${i.remindersSent}/${state.settings.sequence.length}</td>
      <td class="actions">
        ${i.status !== 'paid' && i.remindersSent < state.settings.sequence.length ? `<button class="btn btn-sm" data-remind-email="${escapeHtml(i.id)}">Email</button>` : ''}
        ${i.status !== 'paid' && i.remindersSent < state.settings.sequence.length ? `<button class="btn btn-sm" data-remind-wa="${escapeHtml(i.id)}">WhatsApp</button>` : ''}
        ${i.status !== 'paid' ? `<button class="btn btn-sm btn-ok" data-paid="${escapeHtml(i.id)}">Paid</button>` : ''}
        <button class="btn btn-sm btn-ghost" data-delete="${escapeHtml(i.id)}">Del</button>
      </td>
    </tr>`
        )
        .join('')
    : '<tr><td colspan="7" class="muted">No invoices yet. Add your first one above.</td></tr>';

  let previewBlock = '<p class="muted">Select an unpaid invoice to preview the next reminder.</p>';
  if (selected && selected.status !== 'paid') {
    if (selected.remindersSent >= state.settings.sequence.length) {
      previewBlock = '<p class="muted">Reminder sequence complete for this invoice.</p>';
    } else {
      const preview = renderTemplate(state.settings.sequence[selected.remindersSent], selected, state.settings);
      const step = state.settings.sequence[selected.remindersSent];
      previewBlock = `
        <p class="preview-meta">Next for <strong>${escapeHtml(selected.clientName)}</strong> · <span class="badge badge-neutral">${escapeHtml(step.label)}</span></p>
        <div class="email-preview">
          <div class="email-subject">Subject: ${escapeHtml(preview.subject)}</div>
          <pre>${escapeHtml(preview.body)}</pre>
        </div>
        <p class="muted preview-hint">Review, then send via Email or WhatsApp from the table.</p>
        <div class="preview-actions">
          <button class="btn btn-sm" data-copy-preview>Copy text</button>
        </div>`;
    }
  }

  return `
  <div class="dash">
    <header class="dash-head">
      <div><h1>Dashboard</h1><p>Track outstanding invoices and reminder progress.</p></div>
      <div class="dash-actions">
        <button class="btn btn-ghost" data-import-csv>Import CSV</button>
        <button class="btn btn-primary" data-add-invoice>+ Add invoice</button>
      </div>
    </header>
    <div class="stats">
      <div class="stat"><span>Outstanding</span><strong>${formatMoney(outstanding(), state.settings.currency, state.settings.locale)}</strong></div>
      <div class="stat"><span>Collected</span><strong>${formatMoney(collected(), state.settings.currency, state.settings.locale)}</strong></div>
      <div class="stat"><span>Overdue</span><strong>${overdue.length}</strong></div>
      <div class="stat"><span>Reminders sent</span><strong>${state.logs.length}</strong></div>
    </div>
    <div class="dash-grid">
      <div class="panel"><table class="inv-table"><thead><tr><th>Invoice</th><th>Amount</th><th>Due</th><th>Status</th><th>Overdue</th><th>Seq</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="panel preview-panel"><h3>Reminder preview</h3>${previewBlock}<button class="btn btn-ghost btn-sm" data-export>Export audit CSV</button></div>
    </div>
    <div class="panel log-panel"><h3>Reminder log</h3>
      ${state.logs.length ? `<ul class="log-list">${state.logs.slice(0, 12).map((l) => {
        const inv = state.invoices.find((i) => i.id === l.invoiceId);
        return `<li><time>${escapeHtml(new Date(l.sentAt).toLocaleString())}</time> · ${escapeHtml(inv?.invoiceNumber ?? l.invoiceId)} — ${escapeHtml(l.preview)}</li>`;
      }).join('')}</ul>` : '<p class="muted">No reminders sent yet.</p>'}
    </div>
  </div>`;
}

function sequencesHtml(): string {
  const cards = state.settings.sequence
    .map(
      (s) => `
    <article class="seq-card tone-${escapeHtml(s.tone)}">
      <header><span class="badge badge-neutral">${escapeHtml(s.label)}</span><span class="tone-tag">${escapeHtml(s.tone)}</span></header>
      <h4>${escapeHtml(s.subject.replace(/\{\{invoice_number\}\}/g, 'INV-2041'))}</h4>
      <pre>${escapeHtml(s.body)}</pre>
    </article>`
    )
    .join('');

  return `<div class="page"><h1>Your reminder messages</h1><p class="lead">Five messages that escalate from a soft check-in to a final reminder — professional tone, no desperate midnight drafts.</p><div class="seq-grid">${cards}</div><button class="btn btn-ghost" data-reset-seq>Reset to defaults</button></div>`;
}

function settingsHtml(): string {
  const s = state.settings;
  return `
  <div class="page">
    <h1>Settings</h1>
    <form class="settings-form" id="settings-form">
      <label>Business name<input name="businessName" value="${escapeHtml(s.businessName)}" required /></label>
      <label>Your name<input name="senderName" value="${escapeHtml(s.senderName)}" required /></label>
      <label>Sender email<input name="senderEmail" type="email" value="${escapeHtml(s.senderEmail)}" required /></label>
      <label>Currency<select name="currency"><option value="USD" ${s.currency === 'USD' ? 'selected' : ''}>USD ($)</option><option value="INR" ${s.currency === 'INR' ? 'selected' : ''}>INR (₹)</option></select></label>
      <button class="btn btn-primary" type="submit">Save settings</button>
    </form>
    <p class="muted demo-note">Send reminders via Email or WhatsApp. Every touch is logged to your audit trail.</p>
  </div>`;
}

function importModalHtml(): string {
  if (!state.showImportModal) return '';
  const previewRows = state.importPreview ?? [];
  const hasPreview = previewRows.length > 0 && state.importErrors.length === 0;

  const errorBlock = state.importErrors.length
    ? `<div class="import-errors"><p><strong>Fix these before importing:</strong></p><ul>${state.importErrors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`
    : '';

  const previewBlock = hasPreview
    ? `<div class="import-preview">
        <p><strong>${previewRows.length} invoice${previewRows.length === 1 ? '' : 's'} ready to import</strong></p>
        <div class="import-table-wrap">
          <table class="import-table">
            <thead><tr><th>Client</th><th>Invoice #</th><th>Amount</th><th>Due</th></tr></thead>
            <tbody>${previewRows.slice(0, 8).map((r) => `
              <tr>
                <td>${escapeHtml(r.clientName)}</td>
                <td>${escapeHtml(r.invoiceNumber)}</td>
                <td>${formatMoney(r.amount, state.settings.currency, state.settings.locale)}</td>
                <td>${escapeHtml(formatDate(r.dueAt))}</td>
              </tr>`).join('')}
              ${previewRows.length > 8 ? `<tr><td colspan="4" class="muted">…and ${previewRows.length - 8} more</td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>`
    : '';

  return `
  <div class="modal-backdrop" data-close-modal>
    <div class="modal modal-lg" role="dialog" data-modal-inner>
      <h2>Import invoices from CSV</h2>
      <p class="muted import-lead">Bulk upload for agencies and businesses with many clients. Solo freelancers can keep using <strong>+ Add invoice</strong>.</p>
      <p class="muted import-lead">Dates use <code>YYYY-MM-DD</code>. Phone numbers accept any country format (e.g. +1, +44, +91).</p>
      <div class="import-hints">
        <button type="button" class="btn btn-sm btn-ghost" data-download-template>Download template</button>
      </div>
      ${!hasPreview ? `<label class="import-file-label">Choose CSV file<input type="file" accept=".csv,text/csv" data-import-file /></label>` : ''}
      ${errorBlock}
      ${previewBlock}
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>
        ${hasPreview ? `<button type="button" class="btn btn-primary" data-confirm-import ${state.importInProgress ? 'disabled' : ''}>Import ${previewRows.length} invoice${previewRows.length === 1 ? '' : 's'}</button>` : ''}
      </div>
    </div>
  </div>`;
}

function feedbackModalHtml(): string {
  if (!state.showFeedbackModal) return '';
  const signedIn = Boolean(state.user);
  return `
  <div class="modal-backdrop" data-close-modal>
    <div class="modal" role="dialog" data-modal-inner>
      <h2>Send feedback</h2>
      <p class="muted feedback-lead">Bug reports, feature ideas, or anything else — we read every message.</p>
      <form id="feedback-form">
        <label>Category
          <select name="category">
            <option value="bug">Bug report</option>
            <option value="feature">Feature request</option>
            <option value="other" selected>Other</option>
          </select>
        </label>
        ${signedIn ? '' : '<label>Your email<input name="email" type="email" required autocomplete="email" placeholder="you@example.com" /></label>'}
        <label>Message<textarea name="message" rows="5" required placeholder="Tell us what happened or what you'd like to see…"></textarea></label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>
          <button type="submit" class="btn btn-primary" ${state.feedbackSubmitting ? 'disabled' : ''}>${state.feedbackSubmitting ? 'Sending…' : 'Submit'}</button>
        </div>
      </form>
    </div>
  </div>`;
}

function addModalHtml(): string {
  if (!state.showAddModal) return '';
  const today = new Date().toISOString().slice(0, 10);
  return `
  <div class="modal-backdrop" data-close-modal>
    <div class="modal" role="dialog" data-modal-inner>
      <h2>Add invoice</h2>
      <form id="add-form">
        <label>Client name<input name="clientName" required /></label>
        <label>Client email<input name="clientEmail" type="email" required /></label>
        <label>Client WhatsApp / phone<input name="clientPhone" type="tel" placeholder="+1 555 123 4567" /></label>
        <label>Invoice #<input name="invoiceNumber" value="${escapeHtml(state.pendingInvoiceNumber)}" required /></label>
        <label>Amount<input name="amount" type="number" min="1" step="1" required /></label>
        <label>Issued<input name="issuedAt" type="date" value="${today}" required /></label>
        <label>Due<input name="dueAt" type="date" value="${today}" required /></label>
        <label>Payment link (optional)<input name="paymentLink" type="url" placeholder="https://" /></label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>
          <button type="submit" class="btn btn-primary">Add invoice</button>
        </div>
      </form>
    </div>
  </div>`;
}

function shell(): string {
  const view = state.view;
  const content =
    view === 'landing' ? landingHtml()
    : view === 'auth' ? authHtml()
    : view === 'dashboard' ? dashboardHtml()
    : view === 'sequences' ? sequencesHtml()
    : settingsHtml();

  const userLabel = state.user?.email ? escapeHtml(state.user.email) : '';

  return `
  <div class="app-shell">
    <nav class="topnav">
      <button class="brand" data-nav="landing">
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="8" fill="#0F3D2E"/><path d="M8 16c0-4.4 3.6-8 8-8 2.2 0 4.2.9 5.7 2.3" stroke="#7EE0B8" stroke-width="2.5" stroke-linecap="round"/><path d="M24 16c0 4.4-3.6 8-8 8" stroke="#C8F7E2" stroke-width="2.5" stroke-linecap="round"/><circle cx="16" cy="16" r="2.5" fill="#7EE0B8"/></svg>
        CollectQuiet
      </button>
      <div class="nav-links">
        ${navLink('landing', 'Home')}
        ${state.session ? navLink('dashboard', 'Dashboard') + navLink('sequences', 'Messages') + navLink('settings', 'Settings') : navLink('auth', 'Sign in')}
      </div>
      ${state.session
        ? `<span class="nav-user">${userLabel}</span><button class="btn btn-ghost btn-sm" data-sign-out>Sign out</button>`
        : `<button class="btn btn-primary btn-sm nav-signin" data-nav="auth">Sign in</button>`}
    </nav>
    <main>${content}</main>
    <footer class="footer"><p>CollectQuiet · Invoice reminders for freelancers · <a href="https://collectquiet.vercel.app">collectquiet.vercel.app</a> · <button class="link-btn" data-open-feedback>Send feedback</button></p></footer>
    ${addModalHtml()}
    ${importModalHtml()}
    ${feedbackModalHtml()}
    ${state.toast ? `<div class="toast ${state.toastError ? 'toast-error' : ''}">${escapeHtml(state.toast)}</div>` : ''}
  </div>`;
}

function render(): void {
  app.innerHTML = shell();
  bindEvents();
}

function bindEvents(): void {
  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', () => {
      const view = (el as HTMLElement).dataset.nav as View;
      state.view = resolveNav(view);
      render();
    });
  });

  document.querySelectorAll('[data-scroll]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.scroll;
      if (id) document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    });
  });

  document.querySelector('[data-sign-out]')?.addEventListener('click', () => void handleSignOut());

  document.querySelector('[data-auth-toggle]')?.addEventListener('click', () => {
    state.authMode = state.authMode === 'signin' ? 'signup' : 'signin';
    render();
  });

  document.getElementById('auth-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    void (state.authMode === 'signin' ? handleSignIn(fd) : handleSignUp(fd));
  });

  document.querySelector('[data-add-invoice]')?.addEventListener('click', () => {
    state.showAddModal = true;
    render();
  });

  document.querySelector('[data-open-feedback]')?.addEventListener('click', () => {
    state.showFeedbackModal = true;
    render();
  });

  document.getElementById('feedback-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    void handleFeedbackSubmit(new FormData(e.target as HTMLFormElement));
  });

  document.querySelector('[data-import-csv]')?.addEventListener('click', () => {
    state.showImportModal = true;
    state.importPreview = null;
    state.importErrors = [];
    render();
  });

  document.querySelector('[data-download-template]')?.addEventListener('click', () => {
    downloadCsvTemplate();
    toast('Template downloaded.');
  });

  document.querySelector('[data-import-file]')?.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) handleImportFile(file);
    input.value = '';
  });

  document.querySelector('[data-confirm-import]')?.addEventListener('click', () => {
    void handleImportConfirm();
  });

  document.querySelectorAll('[data-modal-inner]').forEach((el) => {
    el.addEventListener('click', (e) => e.stopPropagation());
  });

  document.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', () => {
      closeModals();
      render();
    });
  });

  document.getElementById('add-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    void addInvoice(new FormData(e.target as HTMLFormElement));
  });

  document.getElementById('settings-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!state.user) return;
    const fd = new FormData(e.target as HTMLFormElement);
    state.settings = {
      ...state.settings,
      businessName: String(fd.get('businessName')),
      senderName: String(fd.get('senderName')),
      senderEmail: String(fd.get('senderEmail')),
      currency: String(fd.get('currency')),
      locale: String(fd.get('currency')) === 'INR' ? 'en-IN' : 'en-US',
    };
    void saveSettings(state.user.id, state.settings)
      .then(() => toast('Settings saved.'))
      .catch((err) => toast(err instanceof Error ? err.message : 'Save failed', true));
  });

  document.querySelector('[data-reset-seq]')?.addEventListener('click', () => {
    if (!state.user) return;
    state.settings.sequence = [...DEFAULT_SEQUENCE];
    void saveSettings(state.user.id, state.settings)
      .then(() => toast('Sequence reset to defaults.'))
      .catch((err) => toast(err instanceof Error ? err.message : 'Reset failed', true));
    render();
  });

  document.querySelector('[data-reset-password]')?.addEventListener('click', () => {
    const email = (document.querySelector('#auth-form input[name="email"]') as HTMLInputElement)?.value;
    if (!email) {
      toast('Enter your email first.', true);
      return;
    }
    void handleResetPassword(email);
  });

  document.querySelector('[data-copy-preview]')?.addEventListener('click', () => {
    const selected = state.invoices.find((i) => i.id === state.selectedId);
    if (!selected || selected.status === 'paid') return;
    const step = state.settings.sequence[selected.remindersSent];
    if (!step) return;
    const { subject, body } = renderTemplate(step, selected, state.settings);
    void copyText(`Subject: ${subject}\n\n${body}`).then(() => toast('Copied to clipboard.'));
  });

  document.querySelector('[data-export]')?.addEventListener('click', () => {
    const csv = exportCsv(state.invoices, state.logs);
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'collectquiet-audit.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Audit CSV downloaded.');
  });

  document.querySelectorAll('[data-select]').forEach((el) => {
    el.addEventListener('click', () => {
      state.selectedId = (el as HTMLElement).dataset.select!;
      render();
    });
  });

  document.querySelectorAll('[data-remind-email]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const inv = state.invoices.find((i) => i.id === (el as HTMLElement).dataset.remindEmail);
      if (inv) void sendReminder(inv, 'email');
    });
  });

  document.querySelectorAll('[data-remind-wa]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const inv = state.invoices.find((i) => i.id === (el as HTMLElement).dataset.remindWa);
      if (inv) void sendReminder(inv, 'whatsapp');
    });
  });

  document.querySelectorAll('[data-delete]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      void removeInvoice((el as HTMLElement).dataset.delete!);
    });
  });

  document.querySelectorAll('[data-paid]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      void markPaid((el as HTMLElement).dataset.paid!);
    });
  });
}

async function init(): Promise<void> {
  if (!isSupabaseConfigured) {
    state.loading = false;
    render();
    return;
  }

  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  state.user = data.session?.user ?? null;
  state.loading = false;

  if (state.user) await loadUserData();

  supabase.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    state.user = session?.user ?? null;
    if (session?.user) void loadUserData();
    render();
  });

  render();
}

void init();
