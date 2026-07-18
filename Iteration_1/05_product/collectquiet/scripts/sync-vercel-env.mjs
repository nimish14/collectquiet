/**
 * One-shot: push CollectQuiet production env to Vercel (no stdout of secrets).
 * Usage: node scripts/sync-vercel-env.mjs
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function parseEnvFile(path) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

function addEnv(name, value) {
  if (!value) {
    console.error(`skip ${name}: empty`);
    return;
  }
  execFileSync(
    'npx',
    ['vercel', 'env', 'add', name, 'production', '--value', value, '--yes', '--force'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], shell: true }
  );
  console.log(`set ${name}`);
}

// Keys from supabase CLI / local files — pass via env for this script only.
const anon =
  process.env.SYNC_SUPABASE_ANON_KEY ||
  '';
const service =
  process.env.SYNC_SUPABASE_SERVICE_ROLE_KEY ||
  '';
const url =
  process.env.SYNC_SUPABASE_URL ||
  parseEnvFile(join(root, '.env.production')).VITE_SUPABASE_URL ||
  'https://vyywwljyjmblofqyejvi.supabase.co';
const publishable =
  process.env.SYNC_VITE_SUPABASE_ANON_KEY ||
  parseEnvFile(join(root, '.env.production')).VITE_SUPABASE_ANON_KEY ||
  '';

const allowlist =
  process.env.SYNC_ALLOWLIST ||
  'e061d437-008c-4e4f-9fb4-b49f9b2dbb3b,nimishpande11@gmail.com';

const cron =
  process.env.SYNC_CRON_SECRET || randomBytes(32).toString('hex');

if (!anon || !service) {
  console.error('Set SYNC_SUPABASE_ANON_KEY and SYNC_SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

/** @type {Array<[string, string]>} */
const pairs = [
  ['SUPABASE_URL', url],
  ['VITE_SUPABASE_URL', url],
  ['SUPABASE_ANON_KEY', anon],
  ['VITE_SUPABASE_ANON_KEY', publishable || anon],
  ['SUPABASE_SERVICE_ROLE_KEY', service],
  ['COLLECTION_AUTOMATION_ENABLED', 'true'],
  ['COLLECTION_AUTOMATION_DRY_RUN', 'false'],
  ['COLLECTION_EMAIL_SENDING_ENABLED', process.env.SYNC_EMAIL_SENDING || 'false'],
  ['COLLECTION_REPLY_DETECTION_ENABLED', 'true'],
  ['COLLECTION_PAYMENT_WEBHOOK_ENABLED', 'false'],
  ['COLLECTION_AUTOMATION_ALLOWLIST', allowlist],
  ['CRON_SECRET', cron],
  ['COLLECTION_EMAIL_PROVIDER', 'resend'],
  ['COLLECTION_DEFAULT_SENDER_NAME', 'Nimish'],
];

if (process.env.SYNC_RESEND_API_KEY) {
  pairs.push(['RESEND_API_KEY', process.env.SYNC_RESEND_API_KEY]);
}
if (process.env.SYNC_RESEND_WEBHOOK_SECRET) {
  pairs.push(['RESEND_WEBHOOK_SECRET', process.env.SYNC_RESEND_WEBHOOK_SECRET]);
}
if (process.env.SYNC_COLLECTION_EMAIL_FROM) {
  pairs.push(['COLLECTION_EMAIL_FROM', process.env.SYNC_COLLECTION_EMAIL_FROM]);
}
if (process.env.SYNC_COLLECTION_INBOUND_DOMAIN) {
  pairs.push(['COLLECTION_INBOUND_DOMAIN', process.env.SYNC_COLLECTION_INBOUND_DOMAIN]);
}

for (const [k, v] of pairs) addEnv(k, v);

console.log('done. CRON_SECRET was set (check Vercel dashboard to copy if needed).');
