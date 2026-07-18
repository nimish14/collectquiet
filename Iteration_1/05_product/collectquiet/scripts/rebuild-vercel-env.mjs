/**
 * Nuke + recreate production env (non-sensitive) to fix EnvFileReadError.
 * Prints names/lengths only.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const root = process.cwd();

function run(args, input) {
  return execFileSync('npx', args, {
    cwd: root,
    input,
    encoding: 'utf8',
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function rm(name) {
  try {
    run(['vercel', 'env', 'rm', name, 'production', '--yes']);
    console.log(`removed ${name}`);
  } catch {
    console.log(`skip rm ${name}`);
  }
}

function add(name, value) {
  if (!value) throw new Error(`empty ${name}`);
  // Avoid --sensitive: encrypted env blobs have been failing at runtime (EnvFileReadError).
  run(['vercel', 'env', 'add', name, 'production', '--value', String(value), '--yes', '--force', '--no-sensitive']);
  console.log(`set ${name} len=${String(value).length}`);
}

const names = [
  'COLLECTION_EMAIL_FROM',
  'RESEND_API_KEY',
  'COLLECTION_DEFAULT_SENDER_NAME',
  'COLLECTION_EMAIL_PROVIDER',
  'CRON_SECRET',
  'COLLECTION_AUTOMATION_ALLOWLIST',
  'COLLECTION_PAYMENT_WEBHOOK_ENABLED',
  'COLLECTION_REPLY_DETECTION_ENABLED',
  'COLLECTION_EMAIL_SENDING_ENABLED',
  'COLLECTION_AUTOMATION_DRY_RUN',
  'COLLECTION_AUTOMATION_ENABLED',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_ANON_KEY',
  'VITE_SUPABASE_URL',
  'SUPABASE_URL',
];

for (const n of names) rm(n);

const url = process.env.SYNC_SUPABASE_URL || 'https://vyywwljyjmblofqyejvi.supabase.co';
const anon = process.env.SYNC_SUPABASE_ANON_KEY;
const service = process.env.SYNC_SUPABASE_SERVICE_ROLE_KEY;
const publishable = process.env.SYNC_VITE_SUPABASE_ANON_KEY || anon;
const resend = process.env.SYNC_RESEND_API_KEY;
const cron = process.env.SYNC_CRON_SECRET || randomBytes(32).toString('hex');
const allowlist = process.env.SYNC_ALLOWLIST || '*';

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
  ['COLLECTION_EMAIL_FROM', 'onboarding@resend.dev'],
  ['COLLECTION_EMAIL_PROVIDER', 'resend'],
  ['COLLECTION_DEFAULT_SENDER_NAME', 'Nimish'],
  ['COLLECTION_AUTOMATION_ENABLED', 'true'],
  ['COLLECTION_AUTOMATION_DRY_RUN', 'false'],
  ['COLLECTION_EMAIL_SENDING_ENABLED', 'true'],
  ['COLLECTION_REPLY_DETECTION_ENABLED', 'true'],
  ['COLLECTION_TEST_REPLY_TO', 'nimishpande11@gmail.com'],
  ['COLLECTION_OWNER_EMAIL', 'nimishpande11@gmail.com'],
  ['COLLECTION_PAYMENT_WEBHOOK_ENABLED', 'false'],
  ['COLLECTION_AUTOMATION_ALLOWLIST', allowlist],
  ['CRON_SECRET', cron],
];

for (const [k, v] of pairs) add(k, v);
console.log('env rebuilt (non-sensitive)');
console.log(`CRON_SECRET_LEN=${cron.length}`);
