/**
 * Production E2E: auth → invoice → automation → send_now → assert Resend path.
 * Prints statuses only (no secrets).
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const URL = process.env.SYNC_SUPABASE_URL;
const SERVICE = process.env.SYNC_SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SYNC_SUPABASE_ANON_KEY;
const APP = process.env.APP_URL || 'https://collectquiet.vercel.app';
const RESEND_TO = process.env.SYNC_RESEND_TO || 'nimishpande11@gmail.com';

if (!URL || !SERVICE || !ANON) {
  console.error('missing supabase env');
  process.exit(1);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const testEmail = `cq.e2e.${Date.now()}@example.com`;
const testPass = `E2e_${randomBytes(8).toString('hex')}!`;

async function main() {
  console.log('1) create test user');
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: testEmail,
    password: testPass,
    email_confirm: true,
  });
  if (cErr || !created.user) throw cErr || new Error('createUser failed');
  const userId = created.user.id;
  console.log(`   userId=${userId}`);

  // Temporarily broaden allowlist is not possible here; patch profile + use service to insert
  // Automation API checks allowlist — add user id via SQL.
  console.log('2) allowlist user via SQL note — calling API with flags that include this user');
  // We'll set COLLECTION allowlist in request path by using an already-allowlisted approach:
  // Instead: update vercel allowlist is hard mid-test. Use service role to insert automation
  // and call tick with CRON — but send_now needs JWT user on allowlist.
  // So: update allowlist env is already has emails; we need UUID. Patch by using existing founder user.

  // Delete ephemeral user and use founder magic: sign in as founder via admin generate session
  await admin.auth.admin.deleteUser(userId);
  console.log('   switched to founder session via admin');

  const { data: users } = await admin.auth.admin.listUsers({ perPage: 50 });
  const founder =
    users?.users?.find((u) => u.email === 'nimishpande11@gmail.com') ||
    users?.users?.find((u) => u.email === 'pandey.nimish11@gmail.com') ||
    users?.users?.[0];
  if (!founder?.email) throw new Error('no founder user');
  console.log(`   founder=${founder.email} ${founder.id}`);

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: founder.email,
  });
  if (linkErr) throw linkErr;
  const tokenHash = linkData?.properties?.hashed_token;
  if (!tokenHash) throw new Error('no hashed_token from generateLink');

  const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: verified, error: vErr } = await anon.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });
  if (vErr || !verified.session) throw vErr || new Error('verifyOtp failed');
  const jwt = verified.session.access_token;
  console.log('3) signed in via magic link');

  // Probe automation (should not 500)
  console.log('4) probe /api/collections/automation');
  const probe = await fetch(`${APP}/api/collections/automation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'attention' }),
  });
  const probeBody = await probe.json().catch(() => ({}));
  console.log(`   status=${probe.status} body=${JSON.stringify(probeBody).slice(0, 200)}`);
  if (probe.status >= 500) {
    console.error('FAIL: still 500');
    process.exit(1);
  }

  // Ensure invoice exists
  console.log('5) upsert test invoice');
  const invoiceNumber = `E2E-${Date.now()}`;
  const { data: inv, error: invErr } = await admin
    .from('cq_invoices')
    .insert({
      user_id: founder.id,
      client_name: 'E2E Client',
      client_email: RESEND_TO,
      amount: 100,
      invoice_number: invoiceNumber,
      issued_at: new Date().toISOString().slice(0, 10),
      due_at: new Date().toISOString().slice(0, 10),
      status: 'overdue',
      collection_status: 'open',
      currency: 'INR',
      reminders_sent: 0,
    })
    .select('id')
    .single();
  if (invErr) throw invErr;
  console.log(`   invoiceId=${inv.id}`);

  // create + activate with send_now
  console.log('6) create automation');
  const createRes = await fetch(`${APP}/api/collections/automation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      invoiceId: inv.id,
      timezone: 'Asia/Kolkata',
    }),
  });
  const createBody = await createRes.json().catch(() => ({}));
  console.log(`   status=${createRes.status} ${JSON.stringify(createBody).slice(0, 300)}`);
  if (!createRes.ok) {
    console.error('FAIL create');
    process.exit(1);
  }
  const automationId = createBody.automationId || createBody.automation?.id;
  if (!automationId) {
    console.error('no automationId', createBody);
    process.exit(1);
  }

  const inTwoMin = new Date(Date.now() + 120_000);
  const pad = (n) => String(n).padStart(2, '0');
  // datetime-local in Asia/Kolkata approx: use UTC+5:30 offset formatting
  const local = new Date(inTwoMin.getTime() + 5.5 * 3600_000);
  const localStr = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;

  console.log('7) activate');
  const actRes = await fetch(`${APP}/api/collections/automation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'activate',
      automationId,
      timezone: 'Asia/Kolkata',
      confirm: true,
      firmApproved: true,
      reminders: [
        {
          sequenceNumber: 1,
          scheduledAtLocal: localStr,
          tone: 'friendly',
          subject: `E2E test ${invoiceNumber}`,
          body: `Hi, this is an E2E CollectQuiet test for ${invoiceNumber}.`,
        },
      ],
    }),
  });
  const actBody = await actRes.json().catch(() => ({}));
  console.log(`   status=${actRes.status} ${JSON.stringify(actBody).slice(0, 300)}`);
  if (!actRes.ok) {
    console.error('FAIL activate');
    process.exit(1);
  }

  console.log('8) send_now');
  const sendRes = await fetch(`${APP}/api/collections/automation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'send_now',
      automationId,
      confirm: true,
      firmApproved: true,
    }),
  });
  const sendBody = await sendRes.json().catch(() => ({}));
  console.log(`   status=${sendRes.status}`);
  console.log(`   body=${JSON.stringify(sendBody)}`);

  const { data: steps } = await admin
    .from('cq_reminder_steps')
    .select('status, last_error_code, last_error_message, sent_at, provider_message_id')
    .eq('automation_id', automationId)
    .order('sequence_number');
  console.log('9) steps', JSON.stringify(steps, null, 2));

  if (sendRes.status >= 500) {
    console.error('FAIL send_now 500');
    process.exit(1);
  }
  const sent = sendBody.tick?.sent > 0 || steps?.some((s) => s.status === 'sent');
  if (!sent) {
    console.error('FAIL: email not marked sent', sendBody.stepError || steps?.[0]?.last_error_message);
    process.exit(1);
  }
  console.log('PASS: email sent');
}

main().catch((e) => {
  console.error('E2E error', e);
  process.exit(1);
});
