import type {
  CollectionAutomation,
  CollectionEvent,
  CollectionInvoice,
  InboundMessage,
  PaymentEvent,
  PaymentPromise,
  ProviderDeliveryEvent,
  ReminderStep,
  UserNotification,
} from './types';

export interface CollectionsStore {
  getInvoice(userId: string, invoiceId: string): Promise<CollectionInvoice | null>;
  updateInvoice(
    userId: string,
    invoiceId: string,
    patch: Partial<
      Pick<CollectionInvoice, 'collectionStatus' | 'status' | 'paidAt' | 'optedOut'>
    >
  ): Promise<void>;

  getAutomation(userId: string, automationId: string): Promise<CollectionAutomation | null>;
  findOpenAutomationForInvoice(
    userId: string,
    invoiceId: string
  ): Promise<CollectionAutomation | null>;
  insertAutomation(row: CollectionAutomation): Promise<CollectionAutomation>;
  updateAutomation(row: CollectionAutomation): Promise<CollectionAutomation>;

  listSteps(userId: string, automationId: string): Promise<ReminderStep[]>;
  getStep(userId: string, stepId: string): Promise<ReminderStep | null>;
  insertSteps(steps: ReminderStep[]): Promise<void>;
  updateStep(step: ReminderStep): Promise<void>;
  findStepByIdempotencyKey(key: string): Promise<ReminderStep | null>;

  appendEvent(event: CollectionEvent): Promise<CollectionEvent>;
  listEvents(userId: string, automationId?: string): Promise<CollectionEvent[]>;

  insertInbound(message: InboundMessage): Promise<InboundMessage>;
  findInboundByProviderEvent(
    provider: string,
    providerEventId: string
  ): Promise<InboundMessage | null>;
  updateInbound(message: InboundMessage): Promise<void>;

  insertPromise(promise: PaymentPromise): Promise<PaymentPromise>;
  getPromise(userId: string, promiseId: string): Promise<PaymentPromise | null>;
  updatePromise(promise: PaymentPromise): Promise<PaymentPromise>;

  insertProviderEvent(event: ProviderDeliveryEvent): Promise<ProviderDeliveryEvent>;
  findProviderEvent(
    provider: string,
    providerEventId: string
  ): Promise<ProviderDeliveryEvent | null>;

  insertNotification(notification: UserNotification): Promise<UserNotification>;
  listNotifications(userId: string): Promise<UserNotification[]>;

  insertPaymentEvent(event: PaymentEvent): Promise<PaymentEvent>;
  findPaymentEvent(provider: string, providerEventId: string): Promise<PaymentEvent | null>;
  listActivePromisesDueOnOrBefore(isoDate: string): Promise<PaymentPromise[]>;
}

/** Extra methods used by the collections worker (trusted server path). */
export interface WorkerStore extends CollectionsStore {
  getAutomationById(automationId: string): Promise<CollectionAutomation | null>;
  getStepById(stepId: string): Promise<ReminderStep | null>;
  hasEventTypeForStep(stepId: string, eventType: string): Promise<boolean>;
  invoiceHasUnresolvedAttention(invoiceId: string): Promise<boolean>;
  claimDueSteps(opts: {
    now: Date;
    limit: number;
    claimTtlSeconds: number;
  }): Promise<ReminderStep[]>;
  refreshAutomationNextAction(automationId: string, now: Date): Promise<void>;
  findStepByProviderMessageId(providerMessageId: string): Promise<ReminderStep | null>;
  findAutomationByReplyToken(token: string): Promise<CollectionAutomation | null>;
  findStepByRfcOrProviderMessageId(messageId: string): Promise<ReminderStep | null>;
  findStepByProviderThreadId(threadId: string): Promise<ReminderStep | null>;
  listActiveAutomationsByClientEmail(email: string): Promise<
    Array<{ automation: CollectionAutomation; invoiceId: string; userId: string }>
  >;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

export class MemoryCollectionsStore implements WorkerStore {
  invoices = new Map<string, CollectionInvoice>();
  automations = new Map<string, CollectionAutomation>();
  steps = new Map<string, ReminderStep>();
  events: CollectionEvent[] = [];
  inbounds = new Map<string, InboundMessage>();
  promises = new Map<string, PaymentPromise>();
  providerEvents = new Map<string, ProviderDeliveryEvent>();
  paymentEvents = new Map<string, PaymentEvent>();
  notifications: UserNotification[] = [];
  /** Simulates SKIP LOCKED via immediate status flip to processing (atomic in single-threaded JS). */

  seedInvoice(invoice: CollectionInvoice): void {
    this.invoices.set(invoice.id, clone(invoice));
  }

  async getInvoiceById(invoiceId: string): Promise<CollectionInvoice | null> {
    const inv = this.invoices.get(invoiceId);
    return inv ? clone(inv) : null;
  }

  async getInvoice(userId: string, invoiceId: string): Promise<CollectionInvoice | null> {
    const inv = this.invoices.get(invoiceId);
    if (!inv || inv.userId !== userId) return null;
    return clone(inv);
  }

  async updateInvoice(
    userId: string,
    invoiceId: string,
    patch: Partial<Pick<CollectionInvoice, 'collectionStatus' | 'status' | 'paidAt' | 'optedOut'>>
  ): Promise<void> {
    const inv = await this.getInvoice(userId, invoiceId);
    if (!inv) throw new Error('Invoice not found');
    this.invoices.set(invoiceId, { ...inv, ...patch });
  }

  async getAutomation(userId: string, automationId: string): Promise<CollectionAutomation | null> {
    const a = this.automations.get(automationId);
    if (!a || a.userId !== userId) return null;
    return clone(a);
  }

  async findOpenAutomationForInvoice(
    userId: string,
    invoiceId: string
  ): Promise<CollectionAutomation | null> {
    const open = ['inactive', 'active', 'paused', 'awaiting_user'];
    for (const a of this.automations.values()) {
      if (a.userId === userId && a.invoiceId === invoiceId && open.includes(a.status)) {
        return clone(a);
      }
    }
    return null;
  }

  async insertAutomation(row: CollectionAutomation): Promise<CollectionAutomation> {
    const existing = await this.findOpenAutomationForInvoice(row.userId, row.invoiceId);
    if (existing) throw new Error('Open automation already exists for invoice');
    this.automations.set(row.id, clone(row));
    return clone(row);
  }

  async updateAutomation(row: CollectionAutomation): Promise<CollectionAutomation> {
    if (!this.automations.has(row.id)) throw new Error('Automation not found');
    const owned = this.automations.get(row.id)!;
    if (owned.userId !== row.userId) throw new Error('Cross-user access denied');
    this.automations.set(row.id, clone(row));
    return clone(row);
  }

  async listSteps(userId: string, automationId: string): Promise<ReminderStep[]> {
    return [...this.steps.values()]
      .filter((s) => s.userId === userId && s.automationId === automationId)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
      .map(clone);
  }

  async getStep(userId: string, stepId: string): Promise<ReminderStep | null> {
    const step = this.steps.get(stepId);
    if (!step || step.userId !== userId) return null;
    return clone(step);
  }

  async insertSteps(steps: ReminderStep[]): Promise<void> {
    for (const s of steps) {
      if ([...this.steps.values()].some((x) => x.idempotencyKey === s.idempotencyKey)) {
        throw new Error(`Duplicate idempotency key: ${s.idempotencyKey}`);
      }
      this.steps.set(s.id, clone(s));
    }
  }

  async updateStep(step: ReminderStep): Promise<void> {
    this.steps.set(step.id, clone(step));
  }

  async findStepByIdempotencyKey(key: string): Promise<ReminderStep | null> {
    for (const s of this.steps.values()) {
      if (s.idempotencyKey === key) return clone(s);
    }
    return null;
  }

  async appendEvent(event: CollectionEvent): Promise<CollectionEvent> {
    this.events.push(clone(event));
    return clone(event);
  }

  async listEvents(userId: string, automationId?: string): Promise<CollectionEvent[]> {
    return this.events
      .filter((e) => e.userId === userId && (!automationId || e.automationId === automationId))
      .map(clone);
  }

  async insertInbound(message: InboundMessage): Promise<InboundMessage> {
    const key = `${message.provider}:${message.providerEventId}`;
    if (this.inbounds.has(key)) throw new Error('Duplicate provider event');
    this.inbounds.set(key, clone(message));
    return clone(message);
  }

  async findInboundByProviderEvent(
    provider: string,
    providerEventId: string
  ): Promise<InboundMessage | null> {
    return clone(this.inbounds.get(`${provider}:${providerEventId}`) ?? null);
  }

  async updateInbound(message: InboundMessage): Promise<void> {
    this.inbounds.set(`${message.provider}:${message.providerEventId}`, clone(message));
  }

  async insertPromise(promise: PaymentPromise): Promise<PaymentPromise> {
    this.promises.set(promise.id, clone(promise));
    return clone(promise);
  }

  async getPromise(userId: string, promiseId: string): Promise<PaymentPromise | null> {
    const p = this.promises.get(promiseId);
    if (!p || p.userId !== userId) return null;
    return clone(p);
  }

  async updatePromise(promise: PaymentPromise): Promise<PaymentPromise> {
    this.promises.set(promise.id, clone(promise));
    return clone(promise);
  }

  async insertProviderEvent(event: ProviderDeliveryEvent): Promise<ProviderDeliveryEvent> {
    const key = `${event.provider}:${event.providerEventId}`;
    if (this.providerEvents.has(key)) throw new Error('Duplicate provider event');
    this.providerEvents.set(key, clone(event));
    return clone(event);
  }

  async findProviderEvent(
    provider: string,
    providerEventId: string
  ): Promise<ProviderDeliveryEvent | null> {
    return clone(this.providerEvents.get(`${provider}:${providerEventId}`) ?? null);
  }

  async insertNotification(notification: UserNotification): Promise<UserNotification> {
    this.notifications.push(clone(notification));
    return clone(notification);
  }

  async listNotifications(userId: string): Promise<UserNotification[]> {
    return this.notifications.filter((n) => n.userId === userId).map(clone);
  }

  async insertPaymentEvent(event: PaymentEvent): Promise<PaymentEvent> {
    const key = `${event.provider}:${event.providerEventId}`;
    if (this.paymentEvents.has(key)) throw new Error('Duplicate payment event');
    this.paymentEvents.set(key, clone(event));
    return clone(event);
  }

  async findPaymentEvent(
    provider: string,
    providerEventId: string
  ): Promise<PaymentEvent | null> {
    return clone(this.paymentEvents.get(`${provider}:${providerEventId}`) ?? null);
  }

  async listActivePromisesDueOnOrBefore(isoDate: string): Promise<PaymentPromise[]> {
    const out: PaymentPromise[] = [];
    for (const p of this.promises.values()) {
      if (p.status !== 'active' || !p.approvedByUser || !p.promisedPaymentDate) continue;
      if (p.promisedPaymentDate <= isoDate) out.push(clone(p));
    }
    return out;
  }

  async getAutomationById(automationId: string): Promise<CollectionAutomation | null> {
    const a = this.automations.get(automationId);
    return a ? clone(a) : null;
  }

  async getStepById(stepId: string): Promise<ReminderStep | null> {
    const s = this.steps.get(stepId);
    return s ? clone(s) : null;
  }

  async hasEventTypeForStep(stepId: string, eventType: string): Promise<boolean> {
    return this.events.some((e) => e.reminderStepId === stepId && e.eventType === eventType);
  }

  async invoiceHasUnresolvedAttention(invoiceId: string): Promise<boolean> {
    for (const m of this.inbounds.values()) {
      if (
        m.matchedInvoiceId === invoiceId &&
        m.requiresReview &&
        !m.attentionClearedAt
      ) {
        return true;
      }
    }
    return false;
  }

  async claimDueSteps(opts: {
    now: Date;
    limit: number;
    claimTtlSeconds: number;
  }): Promise<ReminderStep[]> {
    const nowIso = opts.now.toISOString();
    const nowMs = opts.now.getTime();

    // Recover expired processing claims
    for (const step of this.steps.values()) {
      if (
        step.status === 'processing' &&
        step.claimExpiresAt &&
        new Date(step.claimExpiresAt).getTime() < nowMs
      ) {
        step.status = step.attemptCount > 0 ? 'retry_scheduled' : 'pending';
        step.claimedAt = null;
        step.claimExpiresAt = null;
        step.lastErrorCode = step.lastErrorCode ?? 'claim_expired';
        step.lastErrorMessage = step.lastErrorMessage ?? 'Processing claim expired; requeued';
        step.updatedAt = nowIso;
        this.events.push({
          id: crypto.randomUUID(),
          userId: step.userId,
          invoiceId: step.invoiceId,
          automationId: step.automationId,
          reminderStepId: step.id,
          eventType: 'claim_expired_requeued',
          source: 'worker',
          actorId: null,
          metadata: { idempotencyKey: step.idempotencyKey },
          occurredAt: nowIso,
        });
      }
    }

    const candidates = [...this.steps.values()]
      .filter((s) => ['pending', 'retry_scheduled'].includes(s.status))
      .filter((s) => new Date(s.scheduledAt).getTime() <= nowMs)
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

    const claimed: ReminderStep[] = [];
    for (const step of candidates) {
      if (claimed.length >= opts.limit) break;

      const automation = this.automations.get(step.automationId);
      if (!automation || automation.status !== 'active') continue;

      const invoice = this.invoices.get(step.invoiceId);
      if (!invoice) continue;
      if (!['open', 'collecting'].includes(invoice.collectionStatus)) continue;
      if (['paid', 'disputed', 'written_off', 'completed'].includes(invoice.collectionStatus)) {
        continue;
      }
      if (invoice.status === 'paid' || invoice.paidAt) continue;
      if (this.hasUnresolvedAttentionSync(step.invoiceId)) continue;

      step.status = 'processing';
      step.claimedAt = nowIso;
      step.claimExpiresAt = new Date(nowMs + opts.claimTtlSeconds * 1000).toISOString();
      step.updatedAt = nowIso;
      claimed.push(clone(step));
    }

    return claimed;
  }

  private hasUnresolvedAttentionSync(invoiceId: string): boolean {
    for (const m of this.inbounds.values()) {
      if (
        m.matchedInvoiceId === invoiceId &&
        m.requiresReview &&
        !m.attentionClearedAt
      ) {
        return true;
      }
    }
    return false;
  }

  async refreshAutomationNextAction(automationId: string, now: Date): Promise<void> {
    const automation = this.automations.get(automationId);
    if (!automation) return;
    const next = [...this.steps.values()]
      .filter(
        (s) =>
          s.automationId === automationId &&
          ['pending', 'retry_scheduled', 'processing'].includes(s.status)
      )
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
    automation.nextActionAt = next?.scheduledAt ?? null;
    automation.updatedAt = now.toISOString();
  }

  async findStepByProviderMessageId(providerMessageId: string): Promise<ReminderStep | null> {
    for (const s of this.steps.values()) {
      if (s.providerMessageId === providerMessageId) return clone(s);
    }
    return null;
  }

  async findAutomationByReplyToken(token: string): Promise<CollectionAutomation | null> {
    const t = token.toLowerCase();
    for (const a of this.automations.values()) {
      if (a.replyToToken.toLowerCase() === t) return clone(a);
    }
    return null;
  }

  async findStepByRfcOrProviderMessageId(messageId: string): Promise<ReminderStep | null> {
    const needle = messageId.replace(/^<|>$/g, '').toLowerCase();
    for (const s of this.steps.values()) {
      const rfc = (s.rfcMessageId ?? '').replace(/^<|>$/g, '').toLowerCase();
      if (rfc && (rfc === needle || rfc.includes(needle) || needle.includes(rfc))) {
        return clone(s);
      }
      if (s.providerMessageId && s.providerMessageId.toLowerCase() === needle) {
        return clone(s);
      }
    }
    return null;
  }

  async findStepByProviderThreadId(threadId: string): Promise<ReminderStep | null> {
    for (const s of this.steps.values()) {
      if (s.providerThreadId === threadId) return clone(s);
    }
    return null;
  }

  async listActiveAutomationsByClientEmail(
    email: string
  ): Promise<Array<{ automation: CollectionAutomation; invoiceId: string; userId: string }>> {
    const target = email.toLowerCase();
    const out: Array<{ automation: CollectionAutomation; invoiceId: string; userId: string }> =
      [];
    for (const a of this.automations.values()) {
      if (a.status !== 'active' && a.status !== 'awaiting_user') continue;
      const inv = this.invoices.get(a.invoiceId);
      if (!inv?.clientEmail) continue;
      if (inv.clientEmail.toLowerCase() !== target) continue;
      if (!['open', 'collecting', 'paused'].includes(inv.collectionStatus)) continue;
      out.push({ automation: clone(a), invoiceId: a.invoiceId, userId: a.userId });
    }
    return out;
  }
}
