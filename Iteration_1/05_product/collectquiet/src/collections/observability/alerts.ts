/**
 * Operational alerts for collections automation.
 * Emits structured alert events (wire to PagerDuty/Slack via log drain).
 * Never includes email bodies or secrets.
 */

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertCode =
  | 'scheduler_stale'
  | 'repeated_worker_failure'
  | 'webhook_signature_failure'
  | 'bounce_spike'
  | 'stuck_processing_lease'
  | 'duplicate_send_prevented'
  | 'reply_webhook_unavailable'
  | 'provider_authorization_revoked';

export interface AlertEvent {
  code: AlertCode;
  severity: AlertSeverity;
  message: string;
  metadata?: Record<string, unknown>;
  occurredAt: string;
}

export interface AlertEvaluatorInput {
  lastSchedulerTickAt: string | null;
  now?: Date;
  /** Minutes without a tick before scheduler_stale (default 15). */
  schedulerStaleMinutes?: number;
  workerFailureStreak?: number;
  webhookSignatureFailuresRecent?: number;
  bounceCountRecent?: number;
  sentCountRecent?: number;
  stuckProcessingCount?: number;
  duplicateSendPrevented?: boolean;
  replyWebhookUnavailable?: boolean;
  providerAuthRevoked?: boolean;
}

export function evaluateAlerts(input: AlertEvaluatorInput): AlertEvent[] {
  const now = input.now ?? new Date();
  const out: AlertEvent[] = [];
  const at = now.toISOString();

  const staleMin = input.schedulerStaleMinutes ?? 15;
  if (input.lastSchedulerTickAt) {
    const ageMs = now.getTime() - new Date(input.lastSchedulerTickAt).getTime();
    if (ageMs > staleMin * 60_000) {
      out.push({
        code: 'scheduler_stale',
        severity: 'critical',
        message: `Collections scheduler has not run for ${Math.round(ageMs / 60_000)} minutes.`,
        metadata: { lastSchedulerTickAt: input.lastSchedulerTickAt, staleMin },
        occurredAt: at,
      });
    }
  } else if (input.schedulerStaleMinutes != null) {
    // Explicit probe with no heartbeat yet
    out.push({
      code: 'scheduler_stale',
      severity: 'warning',
      message: 'Collections scheduler has never reported a heartbeat in this process.',
      occurredAt: at,
    });
  }

  if ((input.workerFailureStreak ?? 0) >= 3) {
    out.push({
      code: 'repeated_worker_failure',
      severity: 'critical',
      message: 'Collections worker failed repeatedly.',
      metadata: { streak: input.workerFailureStreak },
      occurredAt: at,
    });
  }

  if ((input.webhookSignatureFailuresRecent ?? 0) >= 1) {
    out.push({
      code: 'webhook_signature_failure',
      severity: 'warning',
      message: 'Webhook signature verification failed.',
      metadata: { count: input.webhookSignatureFailuresRecent },
      occurredAt: at,
    });
  }

  const sent = input.sentCountRecent ?? 0;
  const bounces = input.bounceCountRecent ?? 0;
  if (sent >= 5 && bounces / sent >= 0.2) {
    out.push({
      code: 'bounce_spike',
      severity: 'critical',
      message: 'Sudden bounce spike detected.',
      metadata: { sent, bounces, rate: bounces / sent },
      occurredAt: at,
    });
  }

  if ((input.stuckProcessingCount ?? 0) > 0) {
    out.push({
      code: 'stuck_processing_lease',
      severity: 'critical',
      message: 'Processing jobs stuck beyond lease TTL.',
      metadata: { count: input.stuckProcessingCount },
      occurredAt: at,
    });
  }

  if (input.duplicateSendPrevented) {
    out.push({
      code: 'duplicate_send_prevented',
      severity: 'warning',
      message: 'Duplicate-send prevention triggered.',
      occurredAt: at,
    });
  }

  if (input.replyWebhookUnavailable) {
    out.push({
      code: 'reply_webhook_unavailable',
      severity: 'critical',
      message: 'Reply webhook endpoint unavailable or misconfigured.',
      occurredAt: at,
    });
  }

  if (input.providerAuthRevoked) {
    out.push({
      code: 'provider_authorization_revoked',
      severity: 'critical',
      message: 'Email provider authorization revoked or unauthorized.',
      occurredAt: at,
    });
  }

  return out;
}

export function emitAlerts(alerts: AlertEvent[]): void {
  for (const alert of alerts) {
    console.warn(
      JSON.stringify({
        svc: 'collections-alerts',
        event: 'operational_alert',
        ...alert,
        ts: new Date().toISOString(),
      })
    );
  }
}
