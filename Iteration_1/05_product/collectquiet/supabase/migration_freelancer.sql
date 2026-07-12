alter table public.cq_invoices add column if not exists client_phone text;
alter table public.cq_profiles add column if not exists currency text not null default 'INR';
alter table public.cq_profiles add column if not exists locale text not null default 'en-IN';
