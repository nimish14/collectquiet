import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { CollectionsService } from '../../src/collections/service';
import { createSupabaseWorkerStore } from '../_lib/supabaseWorkerStore';

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

    const auth = req.headers.authorization;
    const jwt =
      typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
    if (!jwt) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }

    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) {
      res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      return;
    }

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }

    const store = createSupabaseWorkerStore();
    const svc = new CollectionsService(store);
    const result = await svc.markInvoicePaid({ userId: userData.user.id }, invoiceId);

    res.status(200).json({
      ok: true,
      alreadyPaid: result.alreadyPaid,
      automationId: result.automation?.id ?? null,
      automationStatus: result.automation?.status ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'mark_paid_failed';
    const code = (err as { code?: string }).code;
    if (code === 'cross_user_or_missing') {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }
    res.status(500).json({ ok: false, error: message });
  }
}
