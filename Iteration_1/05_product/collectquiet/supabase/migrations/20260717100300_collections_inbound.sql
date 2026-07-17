-- Phase 5: inbound reply detection — classifications, statuses, notifications

-- Expand invoice collection statuses
alter table public.cq_invoices drop constraint if exists cq_invoices_collection_status_check;
alter table public.cq_invoices
  add constraint cq_invoices_collection_status_check
  check (collection_status in (
    'open', 'collecting', 'paused', 'paid', 'disputed', 'written_off', 'completed',
    'payment_confirmation_pending'
  ));

-- Expand inbound classifications (drop + recreate check)
alter table public.cq_inbound_messages drop constraint if exists cq_inbound_messages_classification_check;
alter table public.cq_inbound_messages
  add constraint cq_inbound_messages_classification_check
  check (
    classification is null or classification in (
      'payment_claimed', 'payment_promise', 'dispute', 'request_invoice_copy',
      'request_payment_details', 'wrong_contact', 'out_of_office', 'unsubscribe',
      'general_reply', 'automated_response', 'unknown',
      'human_reply', 'auto_reply', 'bounce', 'payment_claim'
    )
  );

alter table public.cq_inbound_messages
  add column if not exists attention_cleared_at timestamptz,
  add column if not exists in_reply_to text,
  add column if not exists references_header text,
  add column if not exists match_method text,
  add column if not exists classification_summary text,
  add column if not exists classification_reason text;

-- Allow payment promises without a detected date (user must approve)
alter table public.cq_payment_promises
  alter column promised_payment_date drop not null;

create table if not exists public.cq_user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  invoice_id uuid references public.cq_invoices(id) on delete set null,
  automation_id uuid references public.cq_collection_automations(id) on delete set null,
  inbound_message_id uuid references public.cq_inbound_messages(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists cq_user_notifications_user_unread_idx
  on public.cq_user_notifications (user_id, created_at desc)
  where read_at is null;

alter table public.cq_user_notifications enable row level security;

drop policy if exists "cq_user_notifications_select_own" on public.cq_user_notifications;
create policy "cq_user_notifications_select_own" on public.cq_user_notifications
  for select using (auth.uid() = user_id);

drop policy if exists "cq_user_notifications_update_own" on public.cq_user_notifications;
create policy "cq_user_notifications_update_own" on public.cq_user_notifications
  for update using (auth.uid() = user_id);

create index if not exists cq_automations_reply_token_idx
  on public.cq_collection_automations (reply_to_token);

create index if not exists cq_reminder_steps_rfc_message_id_idx
  on public.cq_reminder_steps (rfc_message_id)
  where rfc_message_id is not null;

create index if not exists cq_reminder_steps_provider_thread_id_idx
  on public.cq_reminder_steps (provider_thread_id)
  where provider_thread_id is not null;
