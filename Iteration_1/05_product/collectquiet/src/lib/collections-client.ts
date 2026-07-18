/**
 * Browser client for collections automation API (JWT session).
 */

import { supabase } from './supabase';

async function authHeaders(): Promise<HeadersInit> {
  let { data } = await supabase.auth.getSession();
  let token = data.session?.access_token;
  if (!token) throw new Error('Sign in required');

  // Refresh if the access token is near expiry so API JWT validation succeeds.
  const expiresAt = data.session?.expires_at ?? 0;
  if (expiresAt * 1000 < Date.now() + 60_000) {
    const refreshed = await supabase.auth.refreshSession();
    token = refreshed.data.session?.access_token ?? token;
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function collectionsRequest<T>(
  body: Record<string, unknown>
): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch('/api/collections/automation', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok) {
    const code = (json as { error?: string }).error || `Request failed (${res.status})`;
    const friendly: Record<string, string> = {
      unauthorized: 'Session expired — sign out and sign in again.',
      supabase_not_configured: 'Server is missing Supabase configuration.',
      automation_disabled: 'Automatic follow-ups are not enabled yet.',
      not_on_allowlist: 'Your account is not on the pilot allowlist.',
      forbidden: 'You do not have access to this invoice.',
    };
    throw new Error(friendly[code] || code);
  }
  return json;
}

export interface AutomationSnapshot {
  collectionStatus?: string | null;
  automation: {
    id: string;
    status: string;
    channel: string;
    timezone: string;
    nextActionAt: string | null;
    stopReason: string | null;
    dryRun: boolean;
    replyToToken: string;
  } | null;
  steps: Array<{
    id: string;
    sequenceNumber: number;
    scheduledAt: string;
    tone: string;
    subjectSnapshot: string;
    bodySnapshot: string;
    status: string;
    sentAt: string | null;
    lastErrorCode: string | null;
    manualApprovedAt: string | null;
  }>;
  events: Array<{
    id: string;
    eventType: string;
    occurredAt: string;
    metadata: Record<string, unknown>;
  }>;
  lastInbound: {
    classification: string | null;
    subject: string | null;
    textContent: string | null;
    receivedAt: string;
    requiresReview: boolean;
  } | null;
  promise: {
    id: string;
    promisedPaymentDate: string | null;
    status: string;
    approvedByUser: boolean;
  } | null;
  needsAttention: boolean;
}

export interface AttentionItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  /** Actual client reply text (preferred over body for display). */
  replyText?: string | null;
  replySubject?: string | null;
  replyFrom?: string | null;
  invoiceId: string | null;
  automationId: string | null;
  recommendedAction: string;
  createdAt: string;
}

export type PlannedUiStep = {
  id?: string;
  sequenceNumber: number;
  scheduledAtLocal: string; // datetime-local value
  tone: 'friendly' | 'direct' | 'firm' | 'final';
  subject: string;
  body: string;
  requireApproval?: boolean;
};

export async function fetchAutomationSnapshot(invoiceId: string): Promise<AutomationSnapshot> {
  return collectionsRequest<AutomationSnapshot & { ok: boolean }>({
    action: 'get',
    invoiceId,
  });
}

export async function fetchAttentionItems(): Promise<AttentionItem[]> {
  const res = await collectionsRequest<{ ok: boolean; items: AttentionItem[] }>({
    action: 'attention',
  });
  return res.items ?? [];
}
