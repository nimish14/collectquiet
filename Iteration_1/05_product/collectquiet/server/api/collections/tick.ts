import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runCollectionsTick } from '../_lib/runTick';

function readSecret(req: VercelRequest): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice('Bearer '.length);
  const header = req.headers['x-cron-secret'];
  if (typeof header === 'string') return header;
  if (Array.isArray(header) && header[0]) return header[0];
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'GET' || req.method === 'HEAD') {
    res.status(200).json({ ok: true, service: 'collections-tick', provider: 'resend' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const expected = process.env.CRON_SECRET;
  if (!expected) {
    res.status(401).json({ ok: false, error: 'cron_secret_not_configured' });
    return;
  }
  const provided = readSecret(req);
  if (!provided || provided !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const correlationId = crypto.randomUUID();
  try {
    const { summary } = await runCollectionsTick(correlationId);
    res.status(200).json({
      ok: true,
      provider: 'resend',
      correlationId: summary.correlationId,
      enabled: summary.enabled,
      dryRun: summary.dryRun,
      claimed: summary.claimed,
      sent: summary.sent,
      dryRunLogged: summary.dryRunLogged,
      retried: summary.retried,
      failed: summary.failed,
      skipped: summary.skipped,
      errorCount: summary.errors.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'tick_failed';
    console.error(JSON.stringify({ correlationId, event: 'tick_failed', error: message }));
    res.status(500).json({ ok: false, correlationId, error: 'tick_failed', message });
  }
}
