/**
 * Controlled-rollout feature flags for collections automation.
 * Safe defaults: automation off, dry-run on, sending/replies/payment webhooks off,
 * empty allowlist = no users (deny).
 */

export type AllowlistMode = 'deny_all' | 'allow_all' | 'list';

export interface CollectionsFlags {
  automationEnabled: boolean;
  dryRun: boolean;
  emailSendingEnabled: boolean;
  replyDetectionEnabled: boolean;
  paymentWebhookEnabled: boolean;
  allowlistMode: AllowlistMode;
  /** Lowercased user IDs and/or emails when mode === 'list'. */
  allowlist: Set<string>;
  /** When non-empty, outbound mail may only go to these addresses (Stage 3). */
  outboundRecipientAllowlist: Set<string>;
  batchSize: number;
  claimTtlSeconds: number;
  maxAttempts: number;
  baseBackoffSeconds: number;
}

export function parseBoolFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

export function parseAllowlist(raw: string | undefined): {
  mode: AllowlistMode;
  entries: Set<string>;
} {
  if (raw === undefined || raw.trim() === '') {
    return { mode: 'deny_all', entries: new Set() };
  }
  const trimmed = raw.trim();
  if (trimmed === '*' || trimmed.toLowerCase() === 'all') {
    return { mode: 'allow_all', entries: new Set() };
  }
  const entries = new Set(
    trimmed
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  if (entries.size === 0) return { mode: 'deny_all', entries };
  return { mode: 'list', entries };
}

export function loadCollectionsFlags(
  env: Record<string, string | undefined> = process.env
): CollectionsFlags {
  const allow = parseAllowlist(env.COLLECTION_AUTOMATION_ALLOWLIST);
  const recipients = parseAllowlist(env.COLLECTION_OUTBOUND_RECIPIENT_ALLOWLIST);
  return {
    automationEnabled: parseBoolFlag(env.COLLECTION_AUTOMATION_ENABLED, false),
    dryRun: parseBoolFlag(env.COLLECTION_AUTOMATION_DRY_RUN, true),
    emailSendingEnabled: parseBoolFlag(env.COLLECTION_EMAIL_SENDING_ENABLED, false),
    replyDetectionEnabled: parseBoolFlag(env.COLLECTION_REPLY_DETECTION_ENABLED, false),
    paymentWebhookEnabled: parseBoolFlag(env.COLLECTION_PAYMENT_WEBHOOK_ENABLED, false),
    allowlistMode: allow.mode,
    allowlist: allow.entries,
    // Recipient allowlist: empty env means no extra filter (founder may email any client).
    // Explicit list restricts Stage 3 internal-only sending.
    outboundRecipientAllowlist:
      env.COLLECTION_OUTBOUND_RECIPIENT_ALLOWLIST === undefined ||
      env.COLLECTION_OUTBOUND_RECIPIENT_ALLOWLIST.trim() === ''
        ? new Set()
        : recipients.mode === 'allow_all'
          ? new Set()
          : recipients.entries,
    batchSize: Math.min(100, Math.max(1, Number(env.COLLECTION_WORKER_BATCH_SIZE ?? 25))),
    claimTtlSeconds: Math.max(30, Number(env.COLLECTION_CLAIM_TTL_SECONDS ?? 300)),
    maxAttempts: Math.max(1, Number(env.COLLECTION_MAX_ATTEMPTS ?? 3)),
    baseBackoffSeconds: Math.max(1, Number(env.COLLECTION_BASE_BACKOFF_SECONDS ?? 60)),
  };
}

export function isUserAllowed(
  flags: Pick<CollectionsFlags, 'allowlistMode' | 'allowlist'>,
  identity: { userId: string; email?: string | null }
): boolean {
  if (flags.allowlistMode === 'allow_all') return true;
  if (flags.allowlistMode === 'deny_all') return false;
  const id = identity.userId.toLowerCase();
  if (flags.allowlist.has(id)) return true;
  const email = identity.email?.trim().toLowerCase();
  if (email && flags.allowlist.has(email)) return true;
  return false;
}

export function isRecipientAllowed(
  flags: Pick<CollectionsFlags, 'outboundRecipientAllowlist'>,
  to: string
): boolean {
  if (flags.outboundRecipientAllowlist.size === 0) return true;
  return flags.outboundRecipientAllowlist.has(to.trim().toLowerCase());
}

/** True when provider must not be called. */
export function shouldDryRunSend(
  flags: Pick<CollectionsFlags, 'dryRun' | 'emailSendingEnabled'>,
  automationDryRun?: boolean
): boolean {
  return Boolean(flags.dryRun || !flags.emailSendingEnabled || automationDryRun);
}

/** Pilot stage helper for docs/ops (not used to auto-enable production). */
export type PilotStage = 1 | 2 | 3 | 4 | 5;

export function recommendPilotStage(flags: CollectionsFlags): PilotStage {
  if (!flags.automationEnabled) return 1;
  if (flags.dryRun || !flags.emailSendingEnabled) return 2;
  if (flags.outboundRecipientAllowlist.size > 0) return 3;
  if (flags.allowlistMode === 'list' && flags.allowlist.size <= 1) return 4;
  if (flags.allowlistMode === 'list') return 5;
  // allow_all + real sending is not a supported production stage
  return 5;
}
