/**
 * Local dry-run cycle (no Supabase, no provider).
 *
 *   npx tsx scripts/dry-run-tick.ts
 *
 * Or: npm run collections:dry-run
 */
import { CollectionsService } from '../src/collections/service';
import { MemoryCollectionsStore } from '../src/collections/store';
import { CollectionsWorker } from '../src/collections/worker/tick';
import {
  FakeClock,
  RecordingMessageSender,
  loadWorkerConfig,
} from '../src/collections/worker/types';

const USER = '11111111-1111-1111-1111-111111111111';
const INVOICE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function main(): Promise<void> {
  const store = new MemoryCollectionsStore();
  const now = new Date('2026-07-17T12:00:00.000Z');
  store.seedInvoice({
    id: INVOICE,
    userId: USER,
    status: 'overdue',
    collectionStatus: 'collecting',
    clientEmail: 'client@example.com',
  });

  const svc = new CollectionsService(store);
  const auto = await svc.createCollectionAutomation(
    { userId: USER },
    { invoiceId: INVOICE, timezone: 'UTC', dryRun: true }
  );
  await svc.activateCollectionAutomation({ userId: USER }, auto.id, [
    {
      sequenceNumber: 1,
      channel: 'email',
      scheduledAtUtc: '2026-07-17T11:00:00.000Z',
      tone: 'direct',
      subjectSnapshot: 'Invoice due',
      bodySnapshot: 'Please pay invoice INV-1',
      idempotencyKey: `dry-${auto.id}-1`,
    },
  ]);
  await store.updateInvoice(USER, INVOICE, { collectionStatus: 'collecting' });

  const config = loadWorkerConfig({
    COLLECTION_AUTOMATION_ENABLED: 'true',
    COLLECTION_AUTOMATION_DRY_RUN: 'true',
  });

  const worker = new CollectionsWorker(
    store,
    new RecordingMessageSender(),
    config,
    new FakeClock(now),
    async (step, correlationId) => {
      const inv = await store.getInvoice(step.userId, step.invoiceId);
      if (!inv?.clientEmail) return { block: 'invalid_recipient' };
      return {
        outbound: {
          to: inv.clientEmail,
          subject: step.subjectSnapshot,
          body: step.bodySnapshot,
          idempotencyKey: step.idempotencyKey,
          correlationId,
          channel: step.channel,
        },
      };
    }
  );

  const summary = await worker.tick(crypto.randomUUID());
  console.log(JSON.stringify({ summary, events: store.events.map((e) => e.eventType) }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
