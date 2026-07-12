-- Run once in your NEW Supabase project: SQL Editor → New query → paste → Run

create table if not exists public.cq_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  business_name text not null default '',
  sender_name text not null default '',
  sender_email text not null default '',
  sequence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cq_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_name text not null,
  client_email text not null,
  amount numeric(12, 2) not null check (amount > 0),
  invoice_number text not null,
  issued_at date not null,
  due_at date not null,
  status text not null default 'pending' check (status in ('pending', 'due_soon', 'overdue', 'paid')),
  payment_link text,
  notes text,
  reminders_sent integer not null default 0 check (reminders_sent >= 0),
  paid_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, invoice_number)
);

create table if not exists public.cq_reminder_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null references public.cq_invoices(id) on delete cascade,
  step_id text not null,
  subject text not null,
  body text not null,
  preview text not null,
  sent_at timestamptz not null default now(),
  delivery_status text not null default 'logged' check (delivery_status in ('logged', 'mailto', 'sent', 'failed'))
);

create index if not exists cq_invoices_user_id_idx on public.cq_invoices(user_id);
create index if not exists cq_invoices_due_at_idx on public.cq_invoices(due_at);
create index if not exists cq_reminder_logs_invoice_id_idx on public.cq_reminder_logs(invoice_id);
create index if not exists cq_reminder_logs_user_id_idx on public.cq_reminder_logs(user_id);

alter table public.cq_profiles enable row level security;
alter table public.cq_invoices enable row level security;
alter table public.cq_reminder_logs enable row level security;

create policy "cq_profiles_select_own" on public.cq_profiles for select using (auth.uid() = user_id);
create policy "cq_profiles_insert_own" on public.cq_profiles for insert with check (auth.uid() = user_id);
create policy "cq_profiles_update_own" on public.cq_profiles for update using (auth.uid() = user_id);

create policy "cq_invoices_select_own" on public.cq_invoices for select using (auth.uid() = user_id);
create policy "cq_invoices_insert_own" on public.cq_invoices for insert with check (auth.uid() = user_id);
create policy "cq_invoices_update_own" on public.cq_invoices for update using (auth.uid() = user_id);
create policy "cq_invoices_delete_own" on public.cq_invoices for delete using (auth.uid() = user_id);

create policy "cq_reminder_logs_select_own" on public.cq_reminder_logs for select using (auth.uid() = user_id);
create policy "cq_reminder_logs_insert_own" on public.cq_reminder_logs for insert with check (auth.uid() = user_id);

create or replace function public.cq_set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cq_profiles_updated_at on public.cq_profiles;
create trigger cq_profiles_updated_at before update on public.cq_profiles
  for each row execute function public.cq_set_updated_at();

drop trigger if exists cq_invoices_updated_at on public.cq_invoices;
create trigger cq_invoices_updated_at before update on public.cq_invoices
  for each row execute function public.cq_set_updated_at();

create or replace function public.cq_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.cq_profiles (user_id, sender_email)
  values (new.id, coalesce(new.email, ''));
  return new;
end;
$$;

revoke all on function public.cq_handle_new_user() from public, anon, authenticated;

drop trigger if exists cq_on_auth_user_created on auth.users;
create trigger cq_on_auth_user_created
  after insert on auth.users
  for each row execute function public.cq_handle_new_user();
