-- Phase 4: outbound email metadata columns

alter table public.cq_reminder_steps
  add column if not exists rfc_message_id text,
  add column if not exists manual_approved_at timestamptz;

alter table public.cq_invoices
  add column if not exists opted_out boolean not null default false;

create index if not exists cq_reminder_steps_provider_message_id_idx
  on public.cq_reminder_steps (provider_message_id)
  where provider_message_id is not null;
