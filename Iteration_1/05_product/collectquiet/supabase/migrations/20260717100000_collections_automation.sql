-- Collections automation persistence layer
-- Naming follows cq_* conventions. No message sending in this migration.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Profile / invoice extensions
-- ---------------------------------------------------------------------------

alter table public.cq_profiles
  add column if not exists timezone text not null default 'UTC',
  add column if not exists feature_flags jsonb not null default '{}'::jsonb;

alter table public.cq_invoices
  add column if not exists collection_status text not null default 'open',
  add column if not exists currency text,
  add column if not exists paused_at timestamptz,
  add column if not exists pause_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cq_invoices_collection_status_check'
  ) then
    alter table public.cq_invoices
      add constraint cq_invoices_collection_status_check
      check (collection_status in (
        'open', 'collecting', 'paused', 'paid', 'disputed', 'written_off', 'completed'
      ));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cq_invoices_id_user_id_key'
  ) then
    alter table public.cq_invoices
      add constraint cq_invoices_id_user_id_key unique (id, user_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A. Collection automations
-- ---------------------------------------------------------------------------

create table if not exists public.cq_collection_automations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null,
  status text not null default 'inactive'
    check (status in (
      'inactive', 'active', 'paused', 'awaiting_user', 'completed', 'cancelled', 'failed'
    )),
  channel text not null default 'email'
    check (channel in ('email', 'whatsapp_manual')),
  timezone text not null default 'UTC',
  activated_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  stop_reason text,
  next_action_at timestamptz,
  version integer not null default 1 check (version >= 1),
  reply_to_token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  dry_run boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cq_collection_automations_invoice_user_fk
    foreign key (invoice_id, user_id)
    references public.cq_invoices(id, user_id)
    on delete cascade
);

create unique index if not exists cq_collection_automations_one_open_per_invoice
  on public.cq_collection_automations (invoice_id)
  where status in ('inactive', 'active', 'paused', 'awaiting_user');

create index if not exists cq_collection_automations_user_id_idx
  on public.cq_collection_automations (user_id);
create index if not exists cq_collection_automations_status_next_idx
  on public.cq_collection_automations (status, next_action_at);

drop trigger if exists cq_collection_automations_updated_at on public.cq_collection_automations;
create trigger cq_collection_automations_updated_at
  before update on public.cq_collection_automations
  for each row execute function public.cq_set_updated_at();

-- ---------------------------------------------------------------------------
-- B. Reminder steps
-- ---------------------------------------------------------------------------

create table if not exists public.cq_reminder_steps (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.cq_collection_automations(id) on delete cascade,
  invoice_id uuid not null references public.cq_invoices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence_number integer not null check (sequence_number >= 1),
  channel text not null default 'email'
    check (channel in ('email', 'whatsapp_manual')),
  scheduled_at timestamptz not null,
  tone text not null default 'direct'
    check (tone in ('friendly', 'direct', 'firm', 'final')),
  template_id text,
  subject_snapshot text not null,
  body_snapshot text not null,
  status text not null default 'pending'
    check (status in (
      'pending', 'processing', 'sent', 'retry_scheduled', 'skipped', 'cancelled', 'failed'
    )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  maximum_attempts integer not null default 5 check (maximum_attempts >= 1),
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  sent_at timestamptz,
  skipped_at timestamptz,
  failed_at timestamptz,
  provider_message_id text,
  provider_thread_id text,
  idempotency_key text not null,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idempotency_key),
  unique (automation_id, sequence_number)
);

create index if not exists cq_reminder_steps_due_idx
  on public.cq_reminder_steps (status, scheduled_at)
  where status in ('pending', 'retry_scheduled');
create index if not exists cq_reminder_steps_user_id_idx
  on public.cq_reminder_steps (user_id);
create index if not exists cq_reminder_steps_invoice_id_idx
  on public.cq_reminder_steps (invoice_id);

drop trigger if exists cq_reminder_steps_updated_at on public.cq_reminder_steps;
create trigger cq_reminder_steps_updated_at
  before update on public.cq_reminder_steps
  for each row execute function public.cq_set_updated_at();

-- ---------------------------------------------------------------------------
-- C. Collection events (append-only for application roles)
-- ---------------------------------------------------------------------------

create table if not exists public.cq_collection_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid references public.cq_invoices(id) on delete set null,
  automation_id uuid references public.cq_collection_automations(id) on delete set null,
  reminder_step_id uuid references public.cq_reminder_steps(id) on delete set null,
  event_type text not null,
  source text not null default 'system'
    check (source in ('user', 'system', 'provider_webhook', 'worker')),
  actor_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists cq_collection_events_user_occurred_idx
  on public.cq_collection_events (user_id, occurred_at desc);
create index if not exists cq_collection_events_invoice_idx
  on public.cq_collection_events (invoice_id, occurred_at desc);
create index if not exists cq_collection_events_automation_idx
  on public.cq_collection_events (automation_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- D. Inbound messages
-- ---------------------------------------------------------------------------

create table if not exists public.cq_inbound_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_event_id text not null,
  provider_message_id text,
  provider_thread_id text,
  reply_token text,
  sender_address text,
  recipient_address text,
  subject text,
  text_content text,
  html_content text,
  received_at timestamptz not null default now(),
  classification text
    check (classification is null or classification in (
      'human_reply', 'auto_reply', 'bounce', 'payment_claim', 'dispute', 'unknown'
    )),
  classification_confidence numeric(4, 3),
  matched_invoice_id uuid references public.cq_invoices(id) on delete set null,
  matched_automation_id uuid references public.cq_collection_automations(id) on delete set null,
  requires_review boolean not null default false,
  processed_at timestamptz,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists cq_inbound_messages_user_id_idx
  on public.cq_inbound_messages (user_id, received_at desc);
create index if not exists cq_inbound_messages_reply_token_idx
  on public.cq_inbound_messages (reply_token);

-- ---------------------------------------------------------------------------
-- E. Payment promises
-- ---------------------------------------------------------------------------

create table if not exists public.cq_payment_promises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null references public.cq_invoices(id) on delete cascade,
  automation_id uuid references public.cq_collection_automations(id) on delete set null,
  promised_payment_date date not null,
  source_message_id uuid references public.cq_inbound_messages(id) on delete set null,
  status text not null default 'detected'
    check (status in (
      'detected', 'awaiting_approval', 'active', 'fulfilled', 'missed', 'cancelled'
    )),
  confidence numeric(4, 3),
  approved_by_user boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cq_payment_promises_user_id_idx
  on public.cq_payment_promises (user_id);
create index if not exists cq_payment_promises_invoice_idx
  on public.cq_payment_promises (invoice_id, status);

drop trigger if exists cq_payment_promises_updated_at on public.cq_payment_promises;
create trigger cq_payment_promises_updated_at
  before update on public.cq_payment_promises
  for each row execute function public.cq_set_updated_at();

-- ---------------------------------------------------------------------------
-- F. Provider delivery events
-- ---------------------------------------------------------------------------

create table if not exists public.cq_provider_delivery_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  provider text not null,
  provider_event_id text not null,
  provider_message_id text,
  reminder_step_id uuid references public.cq_reminder_steps(id) on delete set null,
  event_status text not null
    check (event_status in (
      'queued', 'delivered', 'delayed', 'bounced', 'complained', 'rejected'
    )),
  payload_hash text,
  raw_metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  processed_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists cq_provider_delivery_events_message_idx
  on public.cq_provider_delivery_events (provider_message_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.cq_collection_automations enable row level security;
alter table public.cq_reminder_steps enable row level security;
alter table public.cq_collection_events enable row level security;
alter table public.cq_inbound_messages enable row level security;
alter table public.cq_payment_promises enable row level security;
alter table public.cq_provider_delivery_events enable row level security;

drop policy if exists "cq_automations_select_own" on public.cq_collection_automations;
drop policy if exists "cq_automations_insert_own" on public.cq_collection_automations;
drop policy if exists "cq_automations_update_own" on public.cq_collection_automations;
drop policy if exists "cq_automations_delete_own" on public.cq_collection_automations;
create policy "cq_automations_select_own" on public.cq_collection_automations
  for select using (auth.uid() = user_id);
create policy "cq_automations_insert_own" on public.cq_collection_automations
  for insert with check (auth.uid() = user_id);
create policy "cq_automations_update_own" on public.cq_collection_automations
  for update using (auth.uid() = user_id);
create policy "cq_automations_delete_own" on public.cq_collection_automations
  for delete using (auth.uid() = user_id);

drop policy if exists "cq_reminder_steps_select_own" on public.cq_reminder_steps;
drop policy if exists "cq_reminder_steps_insert_own" on public.cq_reminder_steps;
drop policy if exists "cq_reminder_steps_update_own" on public.cq_reminder_steps;
drop policy if exists "cq_reminder_steps_delete_own" on public.cq_reminder_steps;
create policy "cq_reminder_steps_select_own" on public.cq_reminder_steps
  for select using (auth.uid() = user_id);
create policy "cq_reminder_steps_insert_own" on public.cq_reminder_steps
  for insert with check (auth.uid() = user_id);
create policy "cq_reminder_steps_update_own" on public.cq_reminder_steps
  for update using (auth.uid() = user_id);
create policy "cq_reminder_steps_delete_own" on public.cq_reminder_steps
  for delete using (auth.uid() = user_id);

drop policy if exists "cq_collection_events_select_own" on public.cq_collection_events;
drop policy if exists "cq_collection_events_insert_own" on public.cq_collection_events;
create policy "cq_collection_events_select_own" on public.cq_collection_events
  for select using (auth.uid() = user_id);
create policy "cq_collection_events_insert_own" on public.cq_collection_events
  for insert with check (auth.uid() = user_id);

drop policy if exists "cq_inbound_messages_select_own" on public.cq_inbound_messages;
create policy "cq_inbound_messages_select_own" on public.cq_inbound_messages
  for select using (auth.uid() = user_id);

drop policy if exists "cq_payment_promises_select_own" on public.cq_payment_promises;
drop policy if exists "cq_payment_promises_insert_own" on public.cq_payment_promises;
drop policy if exists "cq_payment_promises_update_own" on public.cq_payment_promises;
create policy "cq_payment_promises_select_own" on public.cq_payment_promises
  for select using (auth.uid() = user_id);
create policy "cq_payment_promises_insert_own" on public.cq_payment_promises
  for insert with check (auth.uid() = user_id);
create policy "cq_payment_promises_update_own" on public.cq_payment_promises
  for update using (auth.uid() = user_id);

drop policy if exists "cq_provider_delivery_events_select_own" on public.cq_provider_delivery_events;
create policy "cq_provider_delivery_events_select_own" on public.cq_provider_delivery_events
  for select using (auth.uid() = user_id);
