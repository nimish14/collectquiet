/**
 * Structured collections metrics — counters only, no email bodies.
 * Emits JSON lines suitable for log drains / APM parsers.
 */

export type MetricName =
  | 'automations_activated'
  | 'reminders_scheduled'
  | 'reminders_due'
  | 'reminders_sent'
  | 'duplicate_sends_prevented'
  | 'deliveries'
  | 'bounces'
  | 'replies'
  | 'payment_claimed'
  | 'automation_pauses'
  | 'payment_promises'
  | 'disputes'
  | 'manual_interventions'
  | 'failed_jobs'
  | 'retries'
  | 'reply_to_pause_ms_sum'
  | 'reply_to_pause_samples'
  | 'due_to_payment_ms_sum'
  | 'due_to_payment_samples'
  | 'scheduler_ticks'
  | 'webhook_signature_failures'
  | 'stuck_processing_detected'
  | 'provider_auth_failures';

type CounterMap = Record<MetricName, number>;

function emptyCounters(): CounterMap {
  return {
    automations_activated: 0,
    reminders_scheduled: 0,
    reminders_due: 0,
    reminders_sent: 0,
    duplicate_sends_prevented: 0,
    deliveries: 0,
    bounces: 0,
    replies: 0,
    payment_claimed: 0,
    automation_pauses: 0,
    payment_promises: 0,
    disputes: 0,
    manual_interventions: 0,
    failed_jobs: 0,
    retries: 0,
    reply_to_pause_ms_sum: 0,
    reply_to_pause_samples: 0,
    due_to_payment_ms_sum: 0,
    due_to_payment_samples: 0,
    scheduler_ticks: 0,
    webhook_signature_failures: 0,
    stuck_processing_detected: 0,
    provider_auth_failures: 0,
  };
}

export class CollectionsMetrics {
  private counters: CounterMap = emptyCounters();
  private lastSchedulerTickAt: string | null = null;

  incr(name: MetricName, by = 1): void {
    this.counters[name] += by;
  }

  recordReplyToPauseMs(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.counters.reply_to_pause_ms_sum += Math.round(ms);
    this.counters.reply_to_pause_samples += 1;
  }

  recordDueToPaymentMs(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.counters.due_to_payment_ms_sum += Math.round(ms);
    this.counters.due_to_payment_samples += 1;
  }

  markSchedulerTick(at: Date = new Date()): void {
    this.lastSchedulerTickAt = at.toISOString();
    this.incr('scheduler_ticks');
  }

  getLastSchedulerTickAt(): string | null {
    return this.lastSchedulerTickAt;
  }

  snapshot(): {
    counters: CounterMap;
    lastSchedulerTickAt: string | null;
    rates: {
      deliveryRate: number | null;
      bounceRate: number | null;
      replyRate: number | null;
      avgReplyToPauseMs: number | null;
      avgDueToPaymentMs: number | null;
    };
  } {
    const sent = this.counters.reminders_sent;
    const deliveries = this.counters.deliveries;
    const bounces = this.counters.bounces;
    const replies = this.counters.replies;
    return {
      counters: { ...this.counters },
      lastSchedulerTickAt: this.lastSchedulerTickAt,
      rates: {
        deliveryRate: sent > 0 ? deliveries / sent : null,
        bounceRate: sent > 0 ? bounces / sent : null,
        replyRate: sent > 0 ? replies / sent : null,
        avgReplyToPauseMs:
          this.counters.reply_to_pause_samples > 0
            ? this.counters.reply_to_pause_ms_sum / this.counters.reply_to_pause_samples
            : null,
        avgDueToPaymentMs:
          this.counters.due_to_payment_samples > 0
            ? this.counters.due_to_payment_ms_sum / this.counters.due_to_payment_samples
            : null,
      },
    };
  }

  /** Structured log — never includes message bodies. */
  emit(extra: Record<string, unknown> = {}): void {
    const snap = this.snapshot();
    console.info(
      JSON.stringify({
        svc: 'collections-metrics',
        event: 'metrics_snapshot',
        ...snap.counters,
        lastSchedulerTickAt: snap.lastSchedulerTickAt,
        rates: snap.rates,
        ...extra,
        ts: new Date().toISOString(),
      })
    );
  }

  reset(): void {
    this.counters = emptyCounters();
    this.lastSchedulerTickAt = null;
  }
}

/** Process-local singleton for API routes / worker. */
export const collectionsMetrics = new CollectionsMetrics();
