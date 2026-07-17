-- Phase 3: atomic claim for collections worker

alter table public.cq_reminder_steps
  add column if not exists last_dry_run_at timestamptz;

alter table public.cq_inbound_messages
  add column if not exists attention_cleared_at timestamptz;

-- Recover and claim due reminder steps atomically (SKIP LOCKED).
-- security definer: callable with service role; enforces filters in SQL.
create or replace function public.cq_claim_due_reminder_steps(
  p_limit integer default 25,
  p_claim_ttl_seconds integer default 300,
  p_now timestamptz default now()
)
returns setof public.cq_reminder_steps
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_ttl interval := make_interval(secs => greatest(30, coalesce(p_claim_ttl_seconds, 300)));
begin
  -- Recover expired processing claims
  update public.cq_reminder_steps s
  set
    status = case
      when s.attempt_count > 0 then 'retry_scheduled'
      else 'pending'
    end,
    claimed_at = null,
    claim_expires_at = null,
    last_error_code = coalesce(s.last_error_code, 'claim_expired'),
    last_error_message = coalesce(s.last_error_message, 'Processing claim expired; requeued'),
    updated_at = p_now
  where s.status = 'processing'
    and s.claim_expires_at is not null
    and s.claim_expires_at < p_now;

  return query
  with due as (
    select s.id
    from public.cq_reminder_steps s
    inner join public.cq_collection_automations a on a.id = s.automation_id
    inner join public.cq_invoices i on i.id = s.invoice_id
    where s.status in ('pending', 'retry_scheduled')
      and s.scheduled_at <= p_now
      and a.status = 'active'
      and i.collection_status in ('open', 'collecting')
      and i.collection_status not in ('paid', 'disputed', 'written_off', 'completed')
      and coalesce(i.status, '') <> 'paid'
      and i.paid_at is null
      and not exists (
        select 1
        from public.cq_inbound_messages m
        where m.matched_invoice_id = i.id
          and m.requires_review = true
          and m.attention_cleared_at is null
      )
    order by s.scheduled_at asc
    for update of s skip locked
    limit v_limit
  ),
  claimed as (
    update public.cq_reminder_steps s
    set
      status = 'processing',
      claimed_at = p_now,
      claim_expires_at = p_now + v_ttl,
      updated_at = p_now
    from due
    where s.id = due.id
    returning s.*
  )
  select * from claimed;
end;
$$;

revoke all on function public.cq_claim_due_reminder_steps(integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.cq_claim_due_reminder_steps(integer, integer, timestamptz) to service_role;

comment on function public.cq_claim_due_reminder_steps is
  'Atomically claim due collection reminder steps for the worker (SKIP LOCKED). Service role only.';
