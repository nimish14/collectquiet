import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CollectionsService } from '../../../src/collections/service';
import { createSupabaseWorkerStore } from '../_lib/supabaseWorkerStore';
import { isSupabaseAuthConfigured, userFromRequest } from '../_lib/auth';

/**
 * Manual mark-paid — trusted user session or service role with userId.
 * Completes automation and cancels in-flight reminders (domain service).
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
    const invoiceId = body.invoiceId as string | undefined;
    if (!invoiceId) {
      res.status(400).json({ ok: false, error: 'invoice_id_required' });
      return;
    }

    if (!isSupabaseAuthConfigured()) {
      res.status(503).json({ ok: false, error: 'supabase_not_configured' });
      return;
    }

    const user = await userFromRequest(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }

    const store = createSupabaseWorkerStore();
    const svc = new CollectionsService(store);
    const result = await svc.markInvoicePaid({ userId: user.id }, invoiceId);
    const updated = await store.getInvoice(user.id, invoiceId);

    res.status(200).json({
      ok: true,
      invoiceId,
      collectionStatus: updated?.collectionStatus ?? 'paid',
      automationStatus: result.automation?.status ?? null,
      alreadyPaid: result.alreadyPaid,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'mark_paid_failed';
    const status = message.includes('not found') ? 404 : 400;
    res.status(status).json({ ok: false, error: message });
  }
}
