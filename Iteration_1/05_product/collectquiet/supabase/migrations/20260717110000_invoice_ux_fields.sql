-- Phase 7 UX fields
alter table public.cq_invoices
  add column if not exists invoice_link text,
  add column if not exists client_timezone text;

alter table public.cq_profiles
  add column if not exists timezone text not null default 'UTC';
