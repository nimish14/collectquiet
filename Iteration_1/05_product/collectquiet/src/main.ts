import './style.css';
import type { Session, User } from '@supabase/supabase-js';
import {
  createInvoice,
  createReminderLog,
  deleteInvoice,
  exportCsv,
  fetchInvoices,
  fetchLogs,
  fetchSettings,
  saveSettings,
  updateInvoice,
} from './lib/db';
import { escapeHtml } from './lib/escape';
import { supabase } from './lib/supabase';
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
    currency: 'INR',
    locale: 'en-IN',
    sequence: DEFAULT_SEQUENCE,
  },
  selectedId: null,
  showAddModal: false,
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
    state.view = 'auth';
    return 'auth';
  }
  return view;
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

function landingHtml(): string {
  return `
  <section class="hero">
    <div class="hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">For Indian freelancers & consultants</p>
        <h1>Get paid without the <em>awkward</em> chase.</h1>
        <p class="lead">Client stalling on payment? CollectQuiet sends polite email or WhatsApp reminders — so you stop writing "just checking in on the invoice" at midnight.</p>
        <div class="hero-cta">
          <button class="btn btn-primary" data-nav="auth">Start free</button>
          <button class="btn btn-ghost" data-scroll="proof">Why freelancers need this</button>
        </div>
        <ul class="hero-points">
          <li>Built for designers, devs, writers, consultants</li>
          <li>Email + WhatsApp reminder sequences</li>
          <li>Full audit trail — no accounting software needed</li>
        </ul>
      </div>
      <div class="hero-card">
        <div class="mock-header">
          <span>Overdue this week</span>
          <strong>${formatMoney(outstanding() || 45000, 'INR')}</strong>
        </div>
        <div class="mock-rows">
          <div class="mock-row"><span>Brand Studio Mumbai</span><span class="danger">${formatMoney(28000, 'INR')}</span></div>
          <div class="mock-row"><span>Startup Client</span><span class="danger">${formatMoney(17000, 'INR')}</span></div>
        </div>
        <div class="mock-reminder">
          <small>Next reminder · WhatsApp</small>
          <p>"Hi — gentle reminder that INV-2041 for ₹28,000 was due last week..."</p>
          <span class="badge badge-ok">Step 2 of 5</span>
        </div>
      </div>
    </div>
  </section>
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
      <article><span class="step">2</span><h3>Send the chase</h3><p>Five-step sequence from friendly nudge to final notice.</p></article>
      <article><span class="step">3</span><h3>Stop when you're paid</h3><p>Mark paid in one click. Export the audit log anytime.</p></article>
    </div>
  </section>
  <section class="pricing">
    <h2>Simple pricing</h2>
    <div class="price-grid">
      <div class="price-card"><h3>Starter</h3><p class="price">₹499<span>/mo</span></p><ul><li>25 active invoices</li><li>Email + WhatsApp</li><li>Audit export</li></ul></div>
      <div class="price-card featured"><h3>Pro</h3><p class="price">₹999<span>/mo</span></p><ul><li>Unlimited invoices</li><li>Auto-scheduling (soon)</li><li>UPI link tracking</li></ul></div>
    </div>
    <p class="pricing-note">14-day trial · Month-to-month · No lock-in contracts</p>
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
      previewBlock = `
        <p class="preview-meta">Next for <strong>${escapeHtml(selected.clientName)}</strong></p>
        <div class="email-preview">
          <div class="email-subject">Subject: ${escapeHtml(preview.subject)}</div>
          <pre>${escapeHtml(preview.body)}</pre>
        </div>
        <div class="preview-actions">
          <button class="btn btn-sm" data-copy-preview>Copy text</button>
        </div>`;
    }
  }

  return `
  <div class="dash">
    <header class="dash-head">
      <div><h1>Dashboard</h1><p>Track outstanding invoices and reminder progress.</p></div>
      <button class="btn btn-primary" data-add-invoice>+ Add invoice</button>
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
      <h4>${escapeHtml(s.subject.replace(/\{\{invoice_number\}\}/g, 'CQ-1042'))}</h4>
      <pre>${escapeHtml(s.body.slice(0, 220))}...</pre>
    </article>`
    )
    .join('');

  return `<div class="page"><h1>Reminder sequences</h1><p class="lead">Five escalating touches — friendly to final notice.</p><div class="seq-grid">${cards}</div><button class="btn btn-ghost" data-reset-seq>Reset to defaults</button></div>`;
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
      <label>Currency<select name="currency"><option value="INR" ${s.currency === 'INR' ? 'selected' : ''}>INR (₹)</option><option value="USD" ${s.currency === 'USD' ? 'selected' : ''}>USD ($)</option></select></label>
      <button class="btn btn-primary" type="submit">Save settings</button>
    </form>
    <p class="muted demo-note">Send reminders via Email or WhatsApp. Every touch is logged to your audit trail.</p>
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
        <label>Client WhatsApp / phone<input name="clientPhone" type="tel" placeholder="9876543210" /></label>
        <label>Invoice #<input name="invoiceNumber" value="${escapeHtml(state.pendingInvoiceNumber)}" required /></label>
        <label>Amount (₹)<input name="amount" type="number" min="1" step="1" required /></label>
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
        ${state.session ? navLink('dashboard', 'Dashboard') + navLink('sequences', 'Sequences') + navLink('settings', 'Settings') : ''}
      </div>
      ${state.session
        ? `<span class="nav-user">${userLabel}</span><button class="btn btn-ghost btn-sm" data-sign-out>Sign out</button>`
        : `<button class="btn btn-primary btn-sm" data-nav="auth">Sign in</button>`}
    </nav>
    <main>${content}</main>
    <footer class="footer"><p>CollectQuiet · Invoice reminders for freelancers · <a href="https://collectquiet.vercel.app">collectquiet.vercel.app</a></p></footer>
    ${addModalHtml()}
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
      state.view = requireAuth(view);
      render();
    });
  });

  document.querySelector('[data-scroll="proof"]')?.addEventListener('click', () => {
    document.getElementById('proof')?.scrollIntoView({ behavior: 'smooth' });
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

  document.querySelector('[data-modal-inner]')?.addEventListener('click', (e) => e.stopPropagation());

  document.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', () => {
      state.showAddModal = false;
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
