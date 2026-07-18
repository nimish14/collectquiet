import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { WorkerStore } from '../../../src/collections/store';
import type {
  CollectionAutomation,
  CollectionEvent,
  CollectionInvoice,
  InboundMessage,
  PaymentPromise,
  ProviderDeliveryEvent,
  ReminderStep,
  ReminderStepStatus,
  ReminderTone,
  CollectionChannel,
  InvoiceCollectionStatus,
  AutomationStatus,
} from '../../../src/collections/types';

type StepRow = Record<string, unknown>;

function rowToStep(row: StepRow): ReminderStep {
  return {
    id: String(row.id),
    automationId: String(row.automation_id),
    invoiceId: String(row.invoice_id),
    userId: String(row.user_id),
    sequenceNumber: Number(row.sequence_number),
    channel: row.channel as CollectionChannel,
    scheduledAt: String(row.scheduled_at),
    tone: row.tone as ReminderTone,
    templateId: (row.template_id as string) ?? null,
    subjectSnapshot: String(row.subject_snapshot),
    bodySnapshot: String(row.body_snapshot),
    status: row.status as ReminderStepStatus,
    attemptCount: Number(row.attempt_count),
    maximumAttempts: Number(row.maximum_attempts),
    claimedAt: (row.claimed_at as string) ?? null,
    claimExpiresAt: (row.claim_expires_at as string) ?? null,
    sentAt: (row.sent_at as string) ?? null,
    skippedAt: (row.skipped_at as string) ?? null,
    failedAt: (row.failed_at as string) ?? null,
    providerMessageId: (row.provider_message_id as string) ?? null,
    providerThreadId: (row.provider_thread_id as string) ?? null,
    rfcMessageId: (row.rfc_message_id as string) ?? null,
    idempotencyKey: String(row.idempotency_key),
    lastErrorCode: (row.last_error_code as string) ?? null,
    lastErrorMessage: (row.last_error_message as string) ?? null,
    lastDryRunAt: (row.last_dry_run_at as string) ?? null,
    manualApprovedAt: (row.manual_approved_at as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function stepToRow(step: ReminderStep): Record<string, unknown> {
  return {
    status: step.status,
    attempt_count: step.attemptCount,
    claimed_at: step.claimedAt,
    claim_expires_at: step.claimExpiresAt,
    sent_at: step.sentAt,
    skipped_at: step.skippedAt,
    failed_at: step.failedAt,
    provider_message_id: step.providerMessageId,
    provider_thread_id: step.providerThreadId,
    rfc_message_id: step.rfcMessageId,
    last_error_code: step.lastErrorCode,
    last_error_message: step.lastErrorMessage,
    last_dry_run_at: step.lastDryRunAt,
    manual_approved_at: step.manualApprovedAt,
    scheduled_at: step.scheduledAt,
    updated_at: step.updatedAt,
  };
}

function stepToInsertRow(step: ReminderStep): Record<string, unknown> {
  return {
    id: step.id,
    automation_id: step.automationId,
    invoice_id: step.invoiceId,
    user_id: step.userId,
    sequence_number: step.sequenceNumber,
    channel: step.channel,
    scheduled_at: step.scheduledAt,
    tone: step.tone,
    template_id: step.templateId,
    subject_snapshot: step.subjectSnapshot,
    body_snapshot: step.bodySnapshot,
    status: step.status,
    attempt_count: step.attemptCount,
    maximum_attempts: step.maximumAttempts,
    claimed_at: step.claimedAt,
    claim_expires_at: step.claimExpiresAt,
    sent_at: step.sentAt,
    skipped_at: step.skippedAt,
    failed_at: step.failedAt,
    provider_message_id: step.providerMessageId,
    provider_thread_id: step.providerThreadId,
    rfc_message_id: step.rfcMessageId,
    idempotency_key: step.idempotencyKey,
    last_error_code: step.lastErrorCode,
    last_error_message: step.lastErrorMessage,
    last_dry_run_at: step.lastDryRunAt,
    manual_approved_at: step.manualApprovedAt,
    created_at: step.createdAt,
    updated_at: step.updatedAt,
  };
}

function automationToInsertRow(row: CollectionAutomation): Record<string, unknown> {
  return {
    id: row.id,
    user_id: row.userId,
    invoice_id: row.invoiceId,
    status: row.status,
    channel: row.channel,
    timezone: row.timezone,
    activated_at: row.activatedAt,
    paused_at: row.pausedAt,
    completed_at: row.completedAt,
    cancelled_at: row.cancelledAt,
    stop_reason: row.stopReason,
    next_action_at: row.nextActionAt,
    version: row.version,
    reply_to_token: row.replyToToken,
    dry_run: row.dryRun,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function createSupabaseWorkerStore(
  client?: SupabaseClient
): WorkerStore {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!client && (!url || !key)) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  const sb =
    client ??
    createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

  const store: WorkerStore = {
    async getInvoice(userId, invoiceId) {
      const { data, error } = await sb
        .from('cq_invoices')
        .select(
          'id, user_id, status, collection_status, paid_at, client_email, client_name, invoice_number, amount, currency, due_at, payment_link, opted_out'
        )
        .eq('id', invoiceId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        userId: data.user_id,
        status: data.status,
        collectionStatus: data.collection_status as InvoiceCollectionStatus,
        paidAt: data.paid_at,
        clientEmail: data.client_email ?? undefined,
        clientName: data.client_name ?? undefined,
        invoiceNumber: data.invoice_number ?? undefined,
        amount: data.amount != null ? Number(data.amount) : undefined,
        currency: data.currency ?? undefined,
        dueAt: data.due_at ?? undefined,
        paymentLink: data.payment_link ?? null,
        optedOut: Boolean(data.opted_out),
      };
    },
    async updateInvoice(userId, invoiceId, patch) {
      const row: Record<string, unknown> = {};
      if (patch.collectionStatus !== undefined) row.collection_status = patch.collectionStatus;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.paidAt !== undefined) row.paid_at = patch.paidAt;
      if (patch.optedOut !== undefined) row.opted_out = patch.optedOut;
      if (Object.keys(row).length === 0) return;
      const { error } = await sb
        .from('cq_invoices')
        .update(row)
        .eq('id', invoiceId)
        .eq('user_id', userId);
      if (error) throw error;
    },
    async getAutomation(userId, automationId) {
      const a = await store.getAutomationById(automationId);
      if (!a || a.userId !== userId) return null;
      return a;
    },
    async findOpenAutomationForInvoice(userId, invoiceId) {
      const { data, error } = await sb
        .from('cq_collection_automations')
        .select('id')
        .eq('user_id', userId)
        .eq('invoice_id', invoiceId)
        .in('status', ['inactive', 'active', 'paused', 'awaiting_user'])
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return store.getAutomationById(data.id);
    },
    async getInvoiceById(invoiceId: string) {
      const { data, error } = await sb
        .from('cq_invoices')
        .select(
          'id, user_id, status, collection_status, paid_at, client_email, client_name, invoice_number, amount, currency, due_at, payment_link, opted_out'
        )
        .eq('id', invoiceId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        userId: data.user_id,
        status: data.status,
        collectionStatus: data.collection_status as InvoiceCollectionStatus,
        paidAt: data.paid_at,
        clientEmail: data.client_email ?? undefined,
        clientName: data.client_name ?? undefined,
        invoiceNumber: data.invoice_number ?? undefined,
        amount: data.amount != null ? Number(data.amount) : undefined,
        currency: data.currency ?? undefined,
        dueAt: data.due_at ?? undefined,
        paymentLink: data.payment_link ?? null,
        optedOut: Boolean(data.opted_out),
      };
    },
    async insertPaymentEvent(event) {
      const { error } = await sb.from('cq_payment_events').insert({
        id: event.id,
        user_id: event.userId,
        invoice_id: event.invoiceId,
        automation_id: event.automationId,
        provider: event.provider,
        provider_event_id: event.providerEventId,
        provider_transaction_id: event.providerTransactionId,
        amount: event.amount,
        currency: event.currency,
        outcome: event.outcome,
        raw_metadata: event.rawMetadata,
        occurred_at: event.occurredAt,
        processed_at: event.processedAt,
      });
      if (error) throw error;
      return event;
    },
    async findPaymentEvent(provider, providerEventId) {
      const { data, error } = await sb
        .from('cq_payment_events')
        .select('*')
        .eq('provider', provider)
        .eq('provider_event_id', providerEventId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        userId: data.user_id,
        invoiceId: data.invoice_id,
        automationId: data.automation_id,
        provider: data.provider,
        providerEventId: data.provider_event_id,
        providerTransactionId: data.provider_transaction_id,
        amount: data.amount != null ? Number(data.amount) : null,
        currency: data.currency,
        outcome: data.outcome,
        rawMetadata: data.raw_metadata ?? {},
        occurredAt: data.occurred_at,
        processedAt: data.processed_at,
      };
    },
    async listActivePromisesDueOnOrBefore(isoDate) {
      const { data, error } = await sb
        .from('cq_payment_promises')
        .select('*')
        .eq('status', 'active')
        .eq('approved_by_user', true)
        .not('promised_payment_date', 'is', null)
        .lte('promised_payment_date', isoDate);
      if (error) throw error;
      return (data ?? []).map((p) => ({
        id: p.id,
        userId: p.user_id,
        invoiceId: p.invoice_id,
        automationId: p.automation_id,
        promisedPaymentDate: p.promised_payment_date,
        sourceMessageId: p.source_message_id,
        status: p.status,
        confidence: p.confidence,
        approvedByUser: p.approved_by_user,
        dueNotifiedAt: p.due_notified_at,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      }));
    },

    async insertAutomation(row) {
      const { error } = await sb.from('cq_collection_automations').insert(automationToInsertRow(row));
      if (error) throw error;
      return row;
    },
    async updateAutomation(row) {
      const { error } = await sb
        .from('cq_collection_automations')
        .update({
          status: row.status,
          channel: row.channel,
          timezone: row.timezone,
          activated_at: row.activatedAt,
          paused_at: row.pausedAt,
          completed_at: row.completedAt,
          cancelled_at: row.cancelledAt,
          stop_reason: row.stopReason,
          next_action_at: row.nextActionAt,
          version: row.version,
          dry_run: row.dryRun,
          updated_at: row.updatedAt,
        })
        .eq('id', row.id)
        .eq('user_id', row.userId);
      if (error) throw error;
      return row;
    },
    async listSteps(userId, automationId) {
      const { data, error } = await sb
        .from('cq_reminder_steps')
        .select('*')
        .eq('user_id', userId)
        .eq('automation_id', automationId)
        .order('sequence_number', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => rowToStep(row as StepRow));
    },
    async getStep(userId, stepId) {
      const step = await store.getStepById(stepId);
      if (!step || step.userId !== userId) return null;
      return step;
    },
    async insertSteps(steps) {
      if (!steps.length) return;
      const { error } = await sb.from('cq_reminder_steps').insert(steps.map(stepToInsertRow));
      if (error) throw error;
    },
    async updateStep(step) {
      const { error } = await sb
        .from('cq_reminder_steps')
        .update(stepToRow(step))
        .eq('id', step.id)
        .eq('user_id', step.userId);
      if (error) throw error;
    },
    async findStepByIdempotencyKey(key) {
      const { data, error } = await sb
        .from('cq_reminder_steps')
        .select('*')
        .eq('idempotency_key', key)
        .maybeSingle();
      if (error) throw error;
      return data ? rowToStep(data) : null;
    },
    async appendEvent(event: CollectionEvent) {
      const { error } = await sb.from('cq_collection_events').insert({
        id: event.id,
        user_id: event.userId,
        invoice_id: event.invoiceId,
        automation_id: event.automationId,
        reminder_step_id: event.reminderStepId,
        event_type: event.eventType,
        source: event.source,
        actor_id: event.actorId,
        metadata: event.metadata,
        occurred_at: event.occurredAt,
      });
      if (error) throw error;
      return event;
    },
    async listEvents(userId: string, automationId?: string) {
      let q = sb
        .from('cq_collection_events')
        .select('*')
        .eq('user_id', userId)
        .order('occurred_at', { ascending: true });
      if (automationId) q = q.eq('automation_id', automationId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((e) => ({
        id: e.id as string,
        userId: e.user_id as string,
        invoiceId: e.invoice_id as string | null,
        automationId: e.automation_id as string | null,
        reminderStepId: e.reminder_step_id as string | null,
        eventType: e.event_type,
        source: e.source,
        actorId: e.actor_id as string | null,
        metadata: (e.metadata ?? {}) as Record<string, unknown>,
        occurredAt: e.occurred_at as string,
      })) as CollectionEvent[];
    },
    async insertInbound(message) {
      const { error } = await sb.from('cq_inbound_messages').insert({
        id: message.id,
        user_id: message.userId,
        provider: message.provider,
        provider_event_id: message.providerEventId,
        provider_message_id: message.providerMessageId,
        provider_thread_id: message.providerThreadId,
        reply_token: message.replyToken,
        sender_address: message.senderAddress,
        recipient_address: message.recipientAddress,
        subject: message.subject,
        text_content: message.textContent,
        html_content: message.htmlContent,
        received_at: message.receivedAt,
        classification: message.classification,
        classification_confidence: message.classificationConfidence,
        matched_invoice_id: message.matchedInvoiceId,
        matched_automation_id: message.matchedAutomationId,
        requires_review: message.requiresReview,
        attention_cleared_at: message.attentionClearedAt,
        processed_at: message.processedAt,
        raw_metadata: message.rawMetadata,
        created_at: message.createdAt,
      });
      if (error) throw error;
      return message;
    },
    async findInboundByProviderEvent(provider, providerEventId) {
      const { data, error } = await sb
        .from('cq_inbound_messages')
        .select('*')
        .eq('provider', provider)
        .eq('provider_event_id', providerEventId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        userId: data.user_id,
        provider: data.provider,
        providerEventId: data.provider_event_id,
        providerMessageId: data.provider_message_id,
        providerThreadId: data.provider_thread_id,
        replyToken: data.reply_token,
        senderAddress: data.sender_address,
        recipientAddress: data.recipient_address,
        subject: data.subject,
        textContent: data.text_content,
        htmlContent: data.html_content,
        receivedAt: data.received_at,
        classification: data.classification,
        classificationConfidence: data.classification_confidence,
        matchedInvoiceId: data.matched_invoice_id,
        matchedAutomationId: data.matched_automation_id,
        requiresReview: data.requires_review,
        attentionClearedAt: data.attention_cleared_at,
        processedAt: data.processed_at,
        rawMetadata: data.raw_metadata ?? {},
        createdAt: data.created_at,
      } satisfies InboundMessage;
    },
    async updateInbound(message) {
      const { error } = await sb
        .from('cq_inbound_messages')
        .update({
          classification: message.classification,
          classification_confidence: message.classificationConfidence,
          matched_invoice_id: message.matchedInvoiceId,
          matched_automation_id: message.matchedAutomationId,
          requires_review: message.requiresReview,
          attention_cleared_at: message.attentionClearedAt,
          processed_at: message.processedAt,
          text_content: message.textContent,
          html_content: message.htmlContent,
          raw_metadata: message.rawMetadata,
        })
        .eq('id', message.id);
      if (error) throw error;
    },
    async insertPromise(promise) {
      const { error } = await sb.from('cq_payment_promises').insert({
        id: promise.id,
        user_id: promise.userId,
        invoice_id: promise.invoiceId,
        automation_id: promise.automationId,
        promised_payment_date: promise.promisedPaymentDate,
        source_message_id: promise.sourceMessageId,
        status: promise.status,
        confidence: promise.confidence,
        approved_by_user: promise.approvedByUser,
        due_notified_at: promise.dueNotifiedAt ?? null,
        created_at: promise.createdAt,
        updated_at: promise.updatedAt,
      });
      if (error) throw error;
      return promise;
    },
    async getPromise(userId, promiseId) {
      const { data, error } = await sb
        .from('cq_payment_promises')
        .select('*')
        .eq('id', promiseId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        userId: data.user_id,
        invoiceId: data.invoice_id,
        automationId: data.automation_id,
        promisedPaymentDate: data.promised_payment_date,
        sourceMessageId: data.source_message_id,
        status: data.status,
        confidence: data.confidence,
        approvedByUser: data.approved_by_user,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      } satisfies PaymentPromise;
    },
    async updatePromise(promise) {
      const { error } = await sb
        .from('cq_payment_promises')
        .update({
          status: promise.status,
          approved_by_user: promise.approvedByUser,
          promised_payment_date: promise.promisedPaymentDate,
          due_notified_at: promise.dueNotifiedAt ?? null,
          updated_at: promise.updatedAt,
        })
        .eq('id', promise.id);
      if (error) throw error;
      return promise;
    },
    async insertNotification(notification) {
      const { error } = await sb.from('cq_user_notifications').insert({
        id: notification.id,
        user_id: notification.userId,
        kind: notification.kind,
        title: notification.title,
        body: notification.body,
        invoice_id: notification.invoiceId,
        automation_id: notification.automationId,
        inbound_message_id: notification.inboundMessageId,
        read_at: notification.readAt,
        created_at: notification.createdAt,
      });
      if (error) throw error;
      return notification;
    },
    async listNotifications(userId) {
      const { data, error } = await sb
        .from('cq_user_notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((n) => ({
        id: n.id,
        userId: n.user_id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        invoiceId: n.invoice_id,
        automationId: n.automation_id,
        inboundMessageId: n.inbound_message_id,
        readAt: n.read_at,
        createdAt: n.created_at,
      }));
    },
    async insertProviderEvent(event) {
      const { error } = await sb.from('cq_provider_delivery_events').insert({
        id: event.id,
        user_id: event.userId,
        provider: event.provider,
        provider_event_id: event.providerEventId,
        provider_message_id: event.providerMessageId,
        reminder_step_id: event.reminderStepId,
        event_status: event.eventStatus,
        payload_hash: event.payloadHash,
        raw_metadata: event.rawMetadata,
        occurred_at: event.occurredAt,
        processed_at: event.processedAt,
      });
      if (error) throw error;
      return event;
    },
    async findProviderEvent(provider, providerEventId) {
      const { data, error } = await sb
        .from('cq_provider_delivery_events')
        .select('*')
        .eq('provider', provider)
        .eq('provider_event_id', providerEventId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        userId: data.user_id,
        provider: data.provider,
        providerEventId: data.provider_event_id,
        providerMessageId: data.provider_message_id,
        reminderStepId: data.reminder_step_id,
        eventStatus: data.event_status,
        payloadHash: data.payload_hash,
        rawMetadata: data.raw_metadata ?? {},
        occurredAt: data.occurred_at,
        processedAt: data.processed_at,
      };
    },
    async getAutomationById(automationId) {
      const { data, error } = await sb
        .from('cq_collection_automations')
        .select('*')
        .eq('id', automationId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        userId: data.user_id,
        invoiceId: data.invoice_id,
        status: data.status as AutomationStatus,
        channel: data.channel as CollectionChannel,
        timezone: data.timezone,
        activatedAt: data.activated_at,
        pausedAt: data.paused_at,
        completedAt: data.completed_at,
        cancelledAt: data.cancelled_at,
        stopReason: data.stop_reason,
        nextActionAt: data.next_action_at,
        version: data.version,
        replyToToken: data.reply_to_token,
        dryRun: data.dry_run,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      } satisfies CollectionAutomation;
    },
    async getStepById(stepId) {
      const { data, error } = await sb.from('cq_reminder_steps').select('*').eq('id', stepId).maybeSingle();
      if (error) throw error;
      return data ? rowToStep(data) : null;
    },
    async hasEventTypeForStep(stepId, eventType) {
      const { data, error } = await sb
        .from('cq_collection_events')
        .select('id')
        .eq('reminder_step_id', stepId)
        .eq('event_type', eventType)
        .limit(1);
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    async invoiceHasUnresolvedAttention(invoiceId) {
      const { data, error } = await sb
        .from('cq_inbound_messages')
        .select('id')
        .eq('matched_invoice_id', invoiceId)
        .eq('requires_review', true)
        .is('attention_cleared_at', null)
        .limit(1);
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    async claimDueSteps(opts) {
      const { data, error } = await sb.rpc('cq_claim_due_reminder_steps', {
        p_limit: opts.limit,
        p_claim_ttl_seconds: opts.claimTtlSeconds,
        p_now: opts.now.toISOString(),
      });
      if (error) throw error;
      return ((data as StepRow[]) ?? []).map(rowToStep);
    },
    async refreshAutomationNextAction(automationId, now) {
      const { data: steps, error } = await sb
        .from('cq_reminder_steps')
        .select('scheduled_at, status')
        .eq('automation_id', automationId)
        .in('status', ['pending', 'retry_scheduled', 'processing'])
        .order('scheduled_at', { ascending: true })
        .limit(1);
      if (error) throw error;
      const next = steps?.[0]?.scheduled_at ?? null;
      const { error: upErr } = await sb
        .from('cq_collection_automations')
        .update({ next_action_at: next, updated_at: now.toISOString() })
        .eq('id', automationId);
      if (upErr) throw upErr;
    },
    async findStepByProviderMessageId(providerMessageId) {
      const { data, error } = await sb
        .from('cq_reminder_steps')
        .select('*')
        .eq('provider_message_id', providerMessageId)
        .maybeSingle();
      if (error) throw error;
      return data ? rowToStep(data) : null;
    },
    async findAutomationByReplyToken(token) {
      const { data, error } = await sb
        .from('cq_collection_automations')
        .select('*')
        .eq('reply_to_token', token)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return store.getAutomationById(data.id);
    },
    async findStepByRfcOrProviderMessageId(messageId) {
      const bare = messageId.replace(/^<|>$/g, '');
      const { data, error } = await sb
        .from('cq_reminder_steps')
        .select('*')
        .or(`rfc_message_id.eq.<${bare}>,rfc_message_id.eq.${bare},provider_message_id.eq.${bare}`)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? rowToStep(data) : null;
    },
    async findStepByProviderThreadId(threadId) {
      const { data, error } = await sb
        .from('cq_reminder_steps')
        .select('*')
        .eq('provider_thread_id', threadId)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? rowToStep(data) : null;
    },
    async listActiveAutomationsByClientEmail(email) {
      const { data: invoices, error } = await sb
        .from('cq_invoices')
        .select('id, user_id, client_email, collection_status')
        .ilike('client_email', email)
        .in('collection_status', ['open', 'collecting', 'paused']);
      if (error) throw error;
      const out: Array<{
        automation: CollectionAutomation;
        invoiceId: string;
        userId: string;
      }> = [];
      for (const inv of invoices ?? []) {
        const { data: autos, error: aErr } = await sb
          .from('cq_collection_automations')
          .select('id')
          .eq('invoice_id', inv.id)
          .in('status', ['active', 'awaiting_user']);
        if (aErr) throw aErr;
        for (const row of autos ?? []) {
          const automation = await store.getAutomationById(row.id);
          if (automation) {
            out.push({ automation, invoiceId: inv.id, userId: inv.user_id });
          }
        }
      }
      return out;
    },
  };

  return store;
}

// silence unused type imports in some TS configs
export type _Keep = PaymentPromise | ProviderDeliveryEvent | InboundMessage;
