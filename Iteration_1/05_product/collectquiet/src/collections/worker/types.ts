import type { CollectionEventType, ReminderStep } from '../types';
import { loadCollectionsFlags } from '../flags';

export interface WorkerClock {
  now(): Date;
}

export const systemClock: WorkerClock = {
  now: () => new Date(),
};

export class FakeClock implements WorkerClock {
  private current: Date;

  constructor(current: Date) {
    this.current = current;
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(date: Date | string): void {
    this.current = new Date(date);
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  advanceMinutes(minutes: number): void {
    this.advanceMs(minutes * 60_000);
  }
}

export interface WorkerConfig {
  enabled: boolean;
  dryRun: boolean;
  /** When false, provider send is suppressed (effective dry-run). */
  emailSendingEnabled: boolean;
  allowlistMode: 'deny_all' | 'allow_all' | 'list';
  allowlist: Set<string>;
  outboundRecipientAllowlist: Set<string>;
  batchSize: number;
  claimTtlSeconds: number;
  maxAttempts: number;
  baseBackoffSeconds: number;
}

export function loadWorkerConfig(
  env: Record<string, string | undefined> = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {}
): WorkerConfig {
  const f = loadCollectionsFlags(env);
  return {
    enabled: f.automationEnabled,
    dryRun: f.dryRun,
    emailSendingEnabled: f.emailSendingEnabled,
    allowlistMode: f.allowlistMode,
    allowlist: f.allowlist,
    outboundRecipientAllowlist: f.outboundRecipientAllowlist,
    batchSize: f.batchSize,
    claimTtlSeconds: f.claimTtlSeconds,
    maxAttempts: f.maxAttempts,
    baseBackoffSeconds: f.baseBackoffSeconds,
  };
}

export type SendFailureKind = 'temporary' | 'permanent';

export class SendError extends Error {
  readonly kind: SendFailureKind;
  readonly code: string;
  constructor(message: string, kind: SendFailureKind, code: string) {
    super(message);
    this.name = 'SendError';
    this.kind = kind;
    this.code = code;
  }
}

export interface OutboundMessage {
  to: string;
  subject: string;
  body: string;
  idempotencyKey: string;
  correlationId: string;
  channel: string;
  replyToToken?: string | null;
  /** Pre-composed provider payload (Phase 4). */
  composed?: import('../email/types').ComposedReminderEmail;
}

export interface SendResult {
  providerMessageId: string;
  providerThreadId?: string | null;
  rfcMessageId?: string | null;
}

/** Provider-neutral adapter — Phase 3 does not call real providers from production dry-run. */
export interface MessageSender {
  send(message: OutboundMessage): Promise<SendResult>;
}

export class NoopMessageSender implements MessageSender {
  async send(_message: OutboundMessage): Promise<SendResult> {
    throw new Error('NoopMessageSender cannot send; enable a real adapter later');
  }
}

export class RecordingMessageSender implements MessageSender {
  readonly sent: OutboundMessage[] = [];
  nextError: SendError | null = null;
  autoId = 0;
  /** Optional hook invoked inside send (after acceptance, before return) for race tests. */
  duringSend: ((message: OutboundMessage) => Promise<void>) | null = null;

  async send(message: OutboundMessage): Promise<SendResult> {
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = null;
      throw err;
    }
    if (this.duringSend) {
      await this.duringSend(message);
    }
    this.sent.push(message);
    this.autoId += 1;
    return {
      providerMessageId: `msg_${this.autoId}_${message.idempotencyKey.slice(0, 8)}`,
      providerThreadId: `thread_${message.idempotencyKey.slice(0, 8)}`,
    };
  }
}

export const PERMANENT_ERROR_CODES = new Set([
  'invalid_recipient',
  'unsubscribed',
  'invalid_destination',
  'provider_rejected',
  'permanent_failure',
]);

export function classifySendError(err: unknown): SendError {
  if (err instanceof SendError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (
    lower.includes('invalid recipient') ||
    lower.includes('unsubscribed') ||
    lower.includes('invalid destination') ||
    lower.includes('permanent')
  ) {
    return new SendError(msg, 'permanent', 'permanent_failure');
  }
  return new SendError(msg, 'temporary', 'temporary_failure');
}

/** Exponential backoff: base * 2^(attempt-1), capped at 6 hours. */
export function computeBackoffSeconds(attemptCount: number, baseSeconds: number): number {
  const exp = Math.max(0, attemptCount - 1);
  return Math.min(6 * 3600, baseSeconds * 2 ** exp);
}

export function isAlreadySent(step: ReminderStep): boolean {
  return Boolean(step.sentAt || step.providerMessageId || step.status === 'sent');
}

export type WorkerEventType = CollectionEventType;
