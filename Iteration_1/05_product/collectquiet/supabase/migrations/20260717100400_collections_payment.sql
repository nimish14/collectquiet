-- Phase 6: payment stopping + payment event dedupe (provider-neutral)

create table if not exists public.cq_payment_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  invoice_id uuid references public.cq_invoices(id) on delete set null,
  automation_id uuid references public.cq_collection_automations(id) on delete set null,
  provider text not null,
  provider_event_id text not null,
  provider_transaction_id text,
  amount numeric,
  currency text,
  outcome text not null
    check (outcome in (
      'full_payment', 'partial_payment', 'amount_mismatch', 'currency_mismatch',
      'rejected', 'duplicate'
    )),
  raw_metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  processed_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists cq_payment_events_invoice_idx
  on public.cq_payment_events (invoice_id, occurred_at desc);

alter table public.cq_payment_events enable row level security;

drop policy if exists "cq_payment_events_select_own" on public.cq_payment_events;
create policy "cq_payment_events_select_own" on public.cq_payment_events
  for select using (auth.uid() = user_id);

alter table public.cq_payment_promises
  add column if not exists due_notified_at timestamptz;
