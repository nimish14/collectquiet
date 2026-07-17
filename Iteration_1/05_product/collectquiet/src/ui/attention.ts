import { escapeHtml } from '../lib/escape';
import type { AttentionItem } from '../lib/collections-client';
import { labelAttentionKind } from './automation-helpers';

export function attentionPageHtml(opts: {
  loading: boolean;
  error: string | null;
  items: AttentionItem[];
  invoiceLabels: Record<string, string>;
}): string {
  if (opts.loading) {
    return `<div class="page"><h1>Needs Attention</h1><p class="lead" aria-busy="true">Loading items…</p></div>`;
  }
  if (opts.error) {
    return `<div class="page"><h1>Needs Attention</h1><p class="form-error" role="alert">${escapeHtml(opts.error)}</p><button class="btn" data-attention-reload>Retry</button></div>`;
  }
  if (!opts.items.length) {
    return `<div class="page">
      <h1>Needs Attention</h1>
      <p class="lead">Nothing waiting on you right now.</p>
      <div class="action-queue empty"><p><strong>Inbox clear.</strong> Client replies, disputes, and delivery issues will show up here with a recommended action.</p></div>
    </div>`;
  }

  const cards = opts.items
    .map((item) => {
      const invLabel = item.invoiceId
        ? opts.invoiceLabels[item.invoiceId] ?? 'Invoice'
        : 'No invoice';
      return `
      <article class="attention-card panel" data-attention-id="${escapeHtml(item.id)}">
        <header class="attention-head">
          <span class="badge badge-warn">${escapeHtml(labelAttentionKind(item.kind))}</span>
          <time datetime="${escapeHtml(item.createdAt)}">${escapeHtml(new Date(item.createdAt).toLocaleString())}</time>
        </header>
        <h3>${escapeHtml(item.title)}</h3>
        <p class="muted">${escapeHtml(invLabel)}</p>
        ${item.body ? `<p>${escapeHtml(item.body)}</p>` : ''}
        <p class="recommended"><strong>Recommended:</strong> ${escapeHtml(item.recommendedAction)}</p>
        <div class="attention-actions">
          ${item.invoiceId ? `<button class="btn btn-sm btn-primary" data-attention-open="${escapeHtml(item.invoiceId)}">Open invoice</button>` : ''}
          <button class="btn btn-sm" data-attention-resolve="${escapeHtml(item.id)}">Mark resolved</button>
        </div>
      </article>`;
    })
    .join('');

  return `<div class="page">
    <h1>Needs Attention</h1>
    <p class="lead">${opts.items.length} item${opts.items.length === 1 ? '' : 's'} need a decision before chasing continues.</p>
    <div class="attention-grid">${cards}</div>
  </div>`;
}
