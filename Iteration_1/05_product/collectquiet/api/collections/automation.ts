import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CollectionsService } from '../../src/collections/service';
import { createSupabaseWorkerStore } from '../_lib/supabaseWorkerStore';
import type { PlannedReminderInput, ReminderTone } from '../../src/collections/types';
import { dateTimeLocalStringToUtcIso } from '../../src/collections/time';
import { buildEmailPreview, sendTestEmailToMyself } from '../../src/collections/email/preview';
import { loadReminderEmailContext } from '../../src/collections/email/outbound';
import { ResendEmailProvider } from '../../src/collections/email/resend';
import { MockEmailProvider } from '../../src/collections/email/mock';
import { isUserAllowed, loadCollectionsFlags } from '../../src/collections/flags';
import { collectionsMetrics } from '../../src/collections/observability/metrics';

const ATTENTION_ACTIONS: Record<string, string> = {
  client_says_paid: 'Confirm payment received, or keep chasing if it was not paid.',
  client_promises_payment: 'Approve or edit the promised date, then resume with new reminders.',
  client_disputes: 'Review the dispute. Resume only after you confirm.',
  reply_unmatched: 'Match the reply to the right invoice, or dismiss after review.',
  reply_unclassified: 'Read the message and choose the next follow-up.',
  wrong_contact: 'Update the client email, then start a new automation if needed.',
  delivery_failure: 'Fix the address, then resume or cancel the automation.',
  opt_out: 'Do not message this address again unless they re-authorize contact.',
  out_of_office: 'Schedule the next reminder after their return date.',
  needs_attention: 'Open the conversation and choose the next step.',
  retry_exhaustion: 'Delivery kept failing. Fix the contact or cancel automation.',
};

async function userFromJwt(req: VercelRequest): Promise<{ id: string; email?: string } | null> {
  const auth = req.headers.authorization;
  const jwt =
    typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
  if (!jwt) return null;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const client = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email };
}

function serviceSb(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_not_configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function sanitizeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta ?? {})) {
    const lk = k.toLowerCase();
    if (lk.includes('secret') || lk.includes('authorization') || lk.includes('api_key')) continue;
    if (lk.includes('payload') || lk.includes('raw_')) continue;
    if ((lk.endsWith('_id') || lk === 'id') && typeof v === 'string' && /^[0-9a-f-]{20,}$/i.test(v)) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

type UiReminder = {
  id?: string;
  sequenceNumber: number;
  scheduledAtLocal: string;
  tone: ReminderTone;
  subject: string;
  body: string;
  requireApproval?: boolean;
};

function toPlanned(
  automationId: string,
  planned: UiReminder[],
  timezone: string,
  firmApproved: boolean
): PlannedReminderInput[] {
  return planned.map((r, i) => {
    const seq = r.sequenceNumber || i + 1;
    const needsApproval = r.requireApproval || r.tone === 'firm' || r.tone === 'final';
    return {
      sequenceNumber: seq,
      channel: 'email' as const,
      scheduledAtUtc: dateTimeLocalStringToUtcIso(r.scheduledAtLocal, timezone),
      tone: r.tone,
      subjectSnapshot: r.subject,
      bodySnapshot: r.body,
      idempotencyKey: `${automationId}:${seq}:${r.scheduledAtLocal}`,
      manualApprovedAt: needsApproval && firmApproved ? new Date().toISOString() : null,
    };
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const user = await userFromJwt(req);
  if (!user) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
  const action = String(body.action ?? '');
  const store = createSupabaseWorkerStore();
  const svc = new CollectionsService(store);
  const ctx = { userId: user.id, source: 'user' as const, actorId: user.id };
  const flags = loadCollectionsFlags(process.env);

  const mutatingPilotActions = new Set([
    'create',
    'activate',
    'update_pending',
    'pause',
    'resume',
    'cancel',
    'skip_next',
    'send_now',
    'mark_disputed',
    'test_email',
  ]);
  if (mutatingPilotActions.has(action)) {
    if (!flags.automationEnabled) {
      res.status(503).json({ ok: false, error: 'automation_disabled' });
      return;
    }
    if (!isUserAllowed(flags, { userId: user.id, email: user.email })) {
      res.status(403).json({ ok: false, error: 'not_on_allowlist' });
      return;
    }
  }

  try {
    switch (action) {
      case 'get': {
        const invoiceId = String(body.invoiceId ?? '');
        const inv = await store.getInvoice(user.id, invoiceId);
        if (!inv) {
          res.status(403).json({ ok: false, error: 'forbidden' });
          return;
        }

        let automation = await store.findOpenAutomationForInvoice(user.id, invoiceId);
        if (!automation) {
          const sb = serviceSb();
          const { data } = await sb
            .from('cq_collection_automations')
            .select('id')
            .eq('user_id', user.id)
            .eq('invoice_id', invoiceId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (data?.id) automation = await store.getAutomation(user.id, data.id);
        }

        const steps = automation ? await store.listSteps(user.id, automation.id) : [];
        const events = automation
          ? (await store.listEvents(user.id, automation.id)).slice(-60)
          : [];

        const sb = serviceSb();
        const { data: inboundRow } = await sb
          .from('cq_inbound_messages')
          .select(
            'classification, subject, text_content, received_at, requires_review'
          )
          .eq('user_id', user.id)
          .eq('matched_invoice_id', invoiceId)
          .order('received_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const { data: promiseRow } = await sb
          .from('cq_payment_promises')
          .select('id, promised_payment_date, status, approved_by_user')
          .eq('user_id', user.id)
          .eq('invoice_id', invoiceId)
          .in('status', ['detected', 'awaiting_approval', 'active', 'due_notified'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const needsAttention = await store.invoiceHasUnresolvedAttention(invoiceId);

        res.status(200).json({
          ok: true,
          automation: automation
            ? {
                id: automation.id,
                status: automation.status,
                channel: automation.channel,
                timezone: automation.timezone,
                nextActionAt: automation.nextActionAt,
                stopReason: automation.stopReason,
                dryRun: automation.dryRun,
                replyToToken: automation.replyToToken,
              }
            : null,
          steps: steps.map((s) => ({
            id: s.id,
            sequenceNumber: s.sequenceNumber,
            scheduledAt: s.scheduledAt,
            tone: s.tone,
            subjectSnapshot: s.subjectSnapshot,
            bodySnapshot: s.bodySnapshot,
            status: s.status,
            sentAt: s.sentAt,
            lastErrorCode: s.lastErrorCode,
            manualApprovedAt: s.manualApprovedAt,
          })),
          events: events.map((e) => ({
            id: e.id,
            eventType: e.eventType,
            occurredAt: e.occurredAt,
            metadata: sanitizeMeta(e.metadata),
          })),
          lastInbound: inboundRow
            ? {
                classification: inboundRow.classification,
                subject: inboundRow.subject,
                textContent: inboundRow.text_content
                  ? String(inboundRow.text_content).slice(0, 280)
                  : null,
                receivedAt: inboundRow.received_at,
                requiresReview: Boolean(inboundRow.requires_review),
              }
            : null,
          promise: promiseRow
            ? {
                id: promiseRow.id,
                promisedPaymentDate: promiseRow.promised_payment_date,
                status: promiseRow.status,
                approvedByUser: Boolean(promiseRow.approved_by_user),
              }
            : null,
          needsAttention,
        });
        return;
      }

      case 'create': {
        const invoiceId = String(body.invoiceId ?? '');
        const timezone = String(body.timezone || 'UTC');
        const inv = await store.getInvoice(user.id, invoiceId);
        if (!inv) {
          res.status(403).json({ ok: false, error: 'forbidden' });
          return;
        }
        const existing = await store.findOpenAutomationForInvoice(user.id, invoiceId);
        if (existing) {
          res.status(200).json({ ok: true, automationId: existing.id, reused: true });
          return;
        }
        const automation = await svc.createCollectionAutomation(ctx, {
          invoiceId,
          timezone,
          channel: 'email',
          dryRun: false,
        });
        res.status(200).json({ ok: true, automationId: automation.id, reused: false });
        return;
      }

      case 'activate': {
        const automationId = String(body.automationId ?? '');
        const timezone = String(body.timezone || 'UTC');
        if (!body.confirm) {
          res.status(400).json({ ok: false, error: 'confirmation_required' });
          return;
        }
        const a = await store.getAutomation(user.id, automationId);
        if (!a) {
          res.status(403).json({ ok: false, error: 'forbidden' });
          return;
        }
        const planned = (body.reminders ?? []) as UiReminder[];
        const firmApproved = Boolean(body.firmApproved);
        const hasFirm = planned.some(
          (r) => r.tone === 'firm' || r.tone === 'final' || r.requireApproval
        );
        if (hasFirm && !firmApproved) {
          res.status(400).json({ ok: false, error: 'firm_approval_required' });
          return;
        }
        if (a.timezone !== timezone) {
          await store.updateAutomation({
            ...a,
            timezone,
            updatedAt: new Date().toISOString(),
          });
        }
        const reminders = toPlanned(automationId, planned, timezone, firmApproved);
        const result = await svc.activateCollectionAutomation(ctx, automationId, reminders);
        collectionsMetrics.incr('automations_activated');
        collectionsMetrics.incr('reminders_scheduled', result.steps.length);
        res.status(200).json({
          ok: true,
          automationId: result.automation.id,
          stepCount: result.steps.length,
        });
        return;
      }

      case 'update_pending': {
        const automationId = String(body.automationId ?? '');
        const timezone = String(body.timezone || 'UTC');
        const a = await store.getAutomation(user.id, automationId);
        if (!a) {
          res.status(403).json({ ok: false, error: 'forbidden' });
          return;
        }
        if (a.status === 'completed' || a.status === 'cancelled') {
          res.status(400).json({ ok: false, error: 'terminal_automation' });
          return;
        }
        const planned = (body.reminders ?? []) as UiReminder[];
        const firmApproved = Boolean(body.firmApproved);
        const steps = await store.listSteps(user.id, automationId);
        const pending = steps.filter(
          (s) => s.status === 'pending' || s.status === 'retry_scheduled'
        );
        for (const r of planned) {
          const step =
            (r.id ? pending.find((s) => s.id === r.id) : null) ??
            pending.find((s) => s.sequenceNumber === r.sequenceNumber);
          if (!step) continue;
          const needsApproval = r.requireApproval || r.tone === 'firm' || r.tone === 'final';
          if (needsApproval && !firmApproved && !step.manualApprovedAt) {
            res.status(400).json({ ok: false, error: 'firm_approval_required' });
            return;
          }
          await store.updateStep({
            ...step,
            scheduledAt: dateTimeLocalStringToUtcIso(r.scheduledAtLocal, timezone),
            tone: r.tone,
            subjectSnapshot: r.subject,
            bodySnapshot: r.body,
            manualApprovedAt:
              needsApproval && firmApproved
                ? step.manualApprovedAt ?? new Date().toISOString()
                : step.manualApprovedAt,
            updatedAt: new Date().toISOString(),
          });
        }
        if (a.timezone !== timezone) {
          await store.updateAutomation({
            ...a,
            timezone,
            updatedAt: new Date().toISOString(),
          });
        }
        await store.refreshAutomationNextAction(automationId, new Date());
        await store.appendEvent({
          id: crypto.randomUUID(),
          userId: user.id,
          invoiceId: a.invoiceId,
          automationId,
          reminderStepId: null,
          eventType: 'manual_override',
          source: 'user',
          actorId: user.id,
          metadata: { action: 'update_pending_reminders' },
          occurredAt: new Date().toISOString(),
        });
        res.status(200).json({ ok: true });
        return;
      }

      case 'pause': {
        await svc.pauseCollectionAutomation(
          ctx,
          String(body.automationId),
          'user_paused'
        );
        res.status(200).json({ ok: true });
        return;
      }

      case 'resume': {
        const automationId = String(body.automationId ?? '');
        const afterDispute = Boolean(body.afterDispute);
        if (afterDispute && !body.confirm) {
          res.status(400).json({ ok: false, error: 'confirmation_required' });
          return;
        }
        await svc.resumeCollectionAutomation(
          {
            ...ctx,
            allowOverride: afterDispute && Boolean(body.confirm),
          },
          automationId
        );
        res.status(200).json({ ok: true });
        return;
      }

      case 'cancel': {
        if (!body.confirm) {
          res.status(400).json({ ok: false, error: 'confirmation_required' });
          return;
        }
        await svc.cancelCollectionAutomation(
          ctx,
          String(body.automationId),
          'user_cancelled'
        );
        res.status(200).json({ ok: true });
        return;
      }

      case 'skip_next': {
        const automationId = String(body.automationId ?? '');
        const steps = await store.listSteps(user.id, automationId);
        const next = steps
          .filter((s) => s.status === 'pending' || s.status === 'retry_scheduled')
          .sort(
            (a, b) =>
              new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
          )[0];
        if (!next) {
          res.status(400).json({ ok: false, error: 'no_pending_step' });
          return;
        }
        await store.updateStep({
          ...next,
          status: 'skipped',
          skippedAt: new Date().toISOString(),
          claimedAt: null,
          claimExpiresAt: null,
          lastErrorCode: 'user_skip',
          lastErrorMessage: 'Skipped by user',
          updatedAt: new Date().toISOString(),
        });
        await store.refreshAutomationNextAction(automationId, new Date());
        await store.appendEvent({
          id: crypto.randomUUID(),
          userId: user.id,
          invoiceId: next.invoiceId,
          automationId,
          reminderStepId: next.id,
          eventType: 'reminders_skipped',
          source: 'user',
          actorId: user.id,
          metadata: { reason: 'skip_next' },
          occurredAt: new Date().toISOString(),
        });
        res.status(200).json({ ok: true });
        return;
      }

      case 'send_now': {
        if (!body.confirm) {
          res.status(400).json({ ok: false, error: 'confirmation_required' });
          return;
        }
        const automationId = String(body.automationId ?? '');
        const steps = await store.listSteps(user.id, automationId);
        const next = steps
          .filter((s) => s.status === 'pending' || s.status === 'retry_scheduled')
          .sort(
            (a, b) =>
              new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
          )[0];
        if (!next) {
          res.status(400).json({ ok: false, error: 'no_pending_step' });
          return;
        }
        if (
          (next.tone === 'firm' || next.tone === 'final') &&
          !next.manualApprovedAt &&
          !body.firmApproved
        ) {
          res.status(400).json({ ok: false, error: 'firm_approval_required' });
          return;
        }
        const nowIso = new Date().toISOString();
        await store.updateStep({
          ...next,
          scheduledAt: nowIso,
          status: 'pending',
          manualApprovedAt:
            body.firmApproved && !next.manualApprovedAt
              ? nowIso
              : next.manualApprovedAt,
          updatedAt: nowIso,
        });
        await store.refreshAutomationNextAction(automationId, new Date());
        await store.appendEvent({
          id: crypto.randomUUID(),
          userId: user.id,
          invoiceId: next.invoiceId,
          automationId,
          reminderStepId: next.id,
          eventType: 'manual_override',
          source: 'user',
          actorId: user.id,
          metadata: { action: 'send_now' },
          occurredAt: nowIso,
        });
        res.status(200).json({ ok: true, scheduledAt: nowIso });
        return;
      }

      case 'mark_disputed': {
        const invoiceId = String(body.invoiceId ?? '');
        const inv = await store.getInvoice(user.id, invoiceId);
        if (!inv) {
          res.status(403).json({ ok: false, error: 'forbidden' });
          return;
        }
        await svc.markInvoiceDisputed(ctx, invoiceId);
        res.status(200).json({ ok: true });
        return;
      }

      case 'attention': {
        const notes = await store.listNotifications(user.id);
        const items = notes
          .filter((n) => !n.readAt)
          .map((n) => ({
            id: n.id,
            kind: n.kind,
            title: n.title,
            body: n.body,
            invoiceId: n.invoiceId,
            automationId: n.automationId,
            recommendedAction:
              ATTENTION_ACTIONS[n.kind] ?? 'Review and choose the next action.',
            createdAt: n.createdAt,
          }));
        res.status(200).json({ ok: true, items });
        return;
      }

      case 'resolve_attention': {
        const notificationId = String(body.notificationId ?? '');
        const sb = serviceSb();
        const { data: n, error } = await sb
          .from('cq_user_notifications')
          .select('*')
          .eq('id', notificationId)
          .eq('user_id', user.id)
          .maybeSingle();
        if (error) throw error;
        if (!n) {
          res.status(403).json({ ok: false, error: 'forbidden' });
          return;
        }
        await sb
          .from('cq_user_notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('id', notificationId)
          .eq('user_id', user.id);
        if (n.invoice_id) {
          await sb
            .from('cq_inbound_messages')
            .update({ attention_cleared_at: new Date().toISOString(), requires_review: false })
            .eq('matched_invoice_id', n.invoice_id)
            .eq('user_id', user.id)
            .eq('requires_review', true);
        }
        await store.appendEvent({
          id: crypto.randomUUID(),
          userId: user.id,
          invoiceId: n.invoice_id,
          automationId: n.automation_id,
          reminderStepId: null,
          eventType: 'manual_override',
          source: 'user',
          actorId: user.id,
          metadata: { action: 'resolve_attention' },
          occurredAt: new Date().toISOString(),
        });
        res.status(200).json({ ok: true });
        return;
      }

      case 'preview_compose': {
        // Preview draft copy without a step id (setup flow)
        const subject = String(body.subject ?? '');
        const text = String(body.body ?? '');
        const tone = String(body.tone ?? 'friendly') as ReminderTone;
        res.status(200).json({
          ok: true,
          preview: {
            subject,
            text,
            tone,
            firmToneWarning:
              tone === 'firm' || tone === 'final'
                ? 'Firm reminders require your approval before they can send.'
                : null,
          },
        });
        return;
      }

      case 'preview_step': {
        const stepId = String(body.stepId ?? '');
        const step = await store.getStep(user.id, stepId);
        if (!step) {
          res.status(403).json({ ok: false, error: 'forbidden' });
          return;
        }
        const { ctx: emailCtx, block } = await loadReminderEmailContext(
          store,
          step,
          crypto.randomUUID(),
          {
            senderName: String(body.senderName || 'Freelancer'),
            businessName: String(body.businessName || ''),
          }
        );
        const preview = buildEmailPreview(emailCtx);
        res.status(200).json({
          ok: true,
          preview: {
            from: preview.from,
            replyTo: preview.replyTo,
            to: preview.to,
            subject: preview.subject,
            text: preview.text,
            tone: preview.tone,
            firmToneWarning: preview.firmToneWarning,
            scheduledAtUtc: preview.scheduledAtUtc,
            timezone: preview.timezone,
          },
          safetyBlock: block,
        });
        return;
      }

      case 'test_email': {
        const subject = String(body.subject ?? '');
        const textBody = String(body.body ?? '');
        const ownerEmail = String(body.ownerEmail || user.email || '');
        if (!ownerEmail) {
          res.status(400).json({ ok: false, error: 'owner_email_required' });
          return;
        }
        const useMock =
          process.env.COLLECTION_USE_RECORDING_SENDER === 'true' ||
          !process.env.RESEND_API_KEY;
        const provider = useMock
          ? new MockEmailProvider()
          : new ResendEmailProvider({
              apiKey: process.env.RESEND_API_KEY!,
              webhookSecret: process.env.RESEND_WEBHOOK_SECRET ?? '',
            });

        // Prefer step-based test when stepId provided
        if (body.stepId) {
          const step = await store.getStep(user.id, String(body.stepId));
          if (!step) {
            res.status(403).json({ ok: false, error: 'forbidden' });
            return;
          }
          const before = { ...step };
          const { ctx: emailCtx } = await loadReminderEmailContext(
            store,
            step,
            crypto.randomUUID(),
            {
              senderName: String(body.senderName || 'Freelancer'),
              businessName: String(body.businessName || ''),
            }
          );
          const result = await sendTestEmailToMyself(provider, emailCtx, ownerEmail);
          const after = await store.getStep(user.id, step.id);
          res.status(200).json({
            ok: true,
            providerMessageId: result.providerMessageId,
            reminderStateUnchanged:
              before.status === after?.status && before.sentAt === after?.sentAt,
            mock: useMock,
          });
          return;
        }

        // Draft test during setup (no step yet)
        const invoiceId = String(body.invoiceId ?? '');
        const inv = await store.getInvoice(user.id, invoiceId);
        if (!inv) {
          res.status(403).json({ ok: false, error: 'forbidden' });
          return;
        }
        const draftCtx = {
          to: ownerEmail,
          clientName: inv.clientName ?? null,
          invoiceNumber: inv.invoiceNumber ?? 'UNKNOWN',
          amount: inv.amount ?? 0,
          currency: inv.currency ?? 'USD',
          dueAt: inv.dueAt ?? new Date().toISOString().slice(0, 10),
          paymentLink: inv.paymentLink ?? null,
          attachment: null,
          subjectSnapshot: subject || 'Test reminder',
          bodySnapshot: textBody || 'Test body',
          tone: (body.tone as ReminderTone) || 'friendly',
          senderDisplayName: String(body.senderName || 'Freelancer'),
          businessName: String(body.businessName || '') || null,
          replyToToken: 'test-token',
          invoiceId: inv.id,
          automationId: 'draft',
          reminderStepId: 'draft',
          userId: user.id,
          idempotencyKey: `test-draft:${user.id}:${Date.now()}`,
          correlationId: crypto.randomUUID(),
          timezone: String(body.timezone || 'UTC'),
          scheduledAtUtc: new Date().toISOString(),
          manualApprovedAt: null,
        };
        const result = await sendTestEmailToMyself(provider, draftCtx, ownerEmail);
        res.status(200).json({
          ok: true,
          providerMessageId: result.providerMessageId,
          reminderStateUnchanged: true,
          mock: useMock,
        });
        return;
      }

      default:
        res.status(400).json({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'automation_failed';
    const code = (err as { code?: string }).code;
    if (code === 'cross_user_or_missing') {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }
    res.status(500).json({ ok: false, error: message, code });
  }
}
