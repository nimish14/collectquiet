create table if not exists public.cq_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text,
  category text not null default 'other' check (category in ('bug', 'feature', 'other')),
  message text not null check (char_length(trim(message)) > 0),
  page text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists cq_feedback_created_at_idx on public.cq_feedback(created_at desc);
create index if not exists cq_feedback_user_id_idx on public.cq_feedback(user_id);

alter table public.cq_feedback enable row level security;

create policy "cq_feedback_insert_authenticated" on public.cq_feedback
  for insert to authenticated
  with check (auth.uid() = user_id or user_id is null);

create policy "cq_feedback_insert_anon" on public.cq_feedback
  for insert to anon
  with check (user_id is null and email is not null and char_length(trim(email)) > 0);
