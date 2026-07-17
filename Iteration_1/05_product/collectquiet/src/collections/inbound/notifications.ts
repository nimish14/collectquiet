import type { WorkerStore } from '../store';
import type { UserNotification, UserNotificationKind } from '../types';

function id(): string {
  return crypto.randomUUID();
}

export async function createUserNotification(
  store: WorkerStore,
  input: {
    userId: string;
    kind: UserNotificationKind;
    title: string;
    body?: string | null;
    invoiceId?: string | null;
    automationId?: string | null;
    inboundMessageId?: string | null;
  }
): Promise<UserNotification> {
  const notification: UserNotification = {
    id: id(),
    userId: input.userId,
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    invoiceId: input.invoiceId ?? null,
    automationId: input.automationId ?? null,
    inboundMessageId: input.inboundMessageId ?? null,
    readAt: null,
    createdAt: new Date().toISOString(),
  };
  await store.insertNotification(notification);
  await store.appendEvent({
    id: id(),
    userId: input.userId,
    invoiceId: input.invoiceId ?? null,
    automationId: input.automationId ?? null,
    reminderStepId: null,
    eventType: 'notification_created',
    source: 'system',
    actorId: null,
    metadata: {
      notificationId: notification.id,
      kind: notification.kind,
      inboundMessageId: input.inboundMessageId ?? null,
    },
    occurredAt: notification.createdAt,
  });
  return notification;
}
