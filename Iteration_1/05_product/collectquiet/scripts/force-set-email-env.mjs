/**
 * Force-set production env with known-good values (prints names only).
 * Usage (PowerShell):
 *   $env:SYNC_SUPABASE_ANON_KEY=...
 *   $env:SYNC_SUPABASE_SERVICE_ROLE_KEY=...
 *   $env:SYNC_RESEND_API_KEY=...
 *   $env:SYNC_CRON_SECRET=...
 *   node scripts/force-set-email-env.mjs
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const root = process.cwd();

function add(name, value) {
  if (!value) throw new Error(`missing value for ${name}`);
  execFileSync(
    'npx',
    ['vercel', 'env', 'add', name, 'production', '--value', String(value), '--yes', '--force', '--sensitive'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], shell: true }
  );
  console.log(`set ${name} (len=${String(value).length})`);
}

const url = process.env.SYNC_SUPABASE_URL || 'https://vyywwljyjmblofqyejvi.supabase.co';
const anon = process.env.SYNC_SUPABASE_ANON_KEY;
const service = process.env.SYNC_SUPABASE_SERVICE_ROLE_KEY;
const publishable = process.env.SYNC_VITE_SUPABASE_ANON_KEY || anon;
const resend = process.env.SYNC_RESEND_API_KEY;
const cron = process.env.SYNC_CRON_SECRET || randomBytes(32).toString('hex');
const allowlist =
  process.env.SYNC_ALLOWLIST ||
  'e061d437-008c-4e4f-9fb4-b49f9b2dbb3b,nimishpande11@gmail.com,c5f4a411-6812-43d5-a238-e6c30b1847a8,wehshigujer@gmail.com';

// Resend only allows verified domains; use their onboarding sender until a domain is verified.
const from = process.env.SYNC_COLLECTION_EMAIL_FROM || 'onboarding@resend.dev';

if (!anon || !service || !resend) {
  console.error('Need SYNC_SUPABASE_ANON_KEY, SYNC_SUPABASE_SERVICE_ROLE_KEY, SYNC_RESEND_API_KEY');
  process.exit(1);
}

const pairs = [
  ['SUPABASE_URL', url],
  ['VITE_SUPABASE_URL', url],
  ['SUPABASE_ANON_KEY', anon],
  ['VITE_SUPABASE_ANON_KEY', publishable],
  ['SUPABASE_SERVICE_ROLE_KEY', service],
  ['RESEND_API_KEY', resend],
  ['COLLECTION_EMAIL_FROM', from],
  ['COLLECTION_EMAIL_PROVIDER', 'resend'],
  ['COLLECTION_DEFAULT_SENDER_NAME', 'Nimish'],
  ['COLLECTION_AUTOMATION_ENABLED', 'true'],
  ['COLLECTION_AUTOMATION_DRY_RUN', 'false'],
  ['COLLECTION_EMAIL_SENDING_ENABLED', 'true'],
  ['COLLECTION_REPLY_DETECTION_ENABLED', 'true'],
  ['COLLECTION_TEST_REPLY_TO', process.env.SYNC_COLLECTION_TEST_REPLY_TO || 'nimishpande11@gmail.com'],
  ['COLLECTION_OWNER_EMAIL', process.env.SYNC_COLLECTION_OWNER_EMAIL || 'nimishpande11@gmail.com'],
  ['COLLECTION_PAYMENT_WEBHOOK_ENABLED', 'false'],
  ['COLLECTION_AUTOMATION_ALLOWLIST', allowlist],
  ['CRON_SECRET', cron],
];

for (const [k, v] of pairs) add(k, v);
console.log('done');
console.log(`CRON_SECRET len=${cron.length} (copy from Vercel dashboard if needed)`);
console.log(`COLLECTION_EMAIL_FROM=${from}`);
