-- PHASE 1: save per change, with backups.
-- Safe to run while the old app is still live: it only ADDS things.
--
--  1. budget_backups: a copy of a budget is kept before anything replaces it wholesale
--     (the version 4 upgrade, or importing a file). Every budget is copied right now too.
--  2. budgets.seq: a counter that goes up by one on every save, so the app can tell
--     which of two updates is newer.
--  3. apply_budget_ops(): saves a short list of changes instead of the whole budget.
--     The same logic lives in js/sync/ops.js (applyOps), and tests/sql/ checks they match.

-- 1. Backups --------------------------------------------------------------
create table if not exists public.budget_backups (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  state jsonb not null,
  reason text not null default '',
  taken_by uuid references auth.users(id) on delete set null,
  taken_at timestamptz not null default now()
);
create index if not exists budget_backups_household_idx on public.budget_backups (household_id, taken_at desc);
alter table public.budget_backups enable row level security;
drop policy if exists "members read their backups" on public.budget_backups;
create policy "members read their backups" on public.budget_backups
  for select to authenticated using (public.is_member(household_id));
revoke all on public.budget_backups from anon;
revoke insert, update, delete, truncate on public.budget_backups from authenticated;

insert into public.budget_backups (household_id, state, reason)
select household_id, state, 'Before the version 4 upgrade' from public.budgets;

-- 2. Save counter ----------------------------------------------------------
alter table public.budgets add column if not exists seq bigint not null default 0;

create or replace function public.bump_budget_seq() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.seq := coalesce(old.seq, 0) + 1;
  return new;
end $$;
revoke execute on function public.bump_budget_seq() from public, anon, authenticated;

drop trigger if exists budgets_bump_seq on public.budgets;
create trigger budgets_bump_seq before update on public.budgets
  for each row execute function public.bump_budget_seq();

-- 3. Save a list of changes -----------------------------------------------
-- p_ops is a JSON array of:
--   {"op":"set", "path":["accounts","js","name"], "value":"Bills"}   (creates missing parents)
--   {"op":"del", "path":["spend","x1a2b3c"]}                         (missing paths are ignored)
--   {"op":"replace", "value":{...}, "reason":"..."}                  (backs up first)
create or replace function public.apply_budget_ops(p_household uuid, p_ops jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s jsonb;
  o jsonb;
  p text[];
  i int;
  new_seq bigint;
  at timestamptz := now();
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_member(p_household) then raise exception 'Not a member of this household'; end if;
  if jsonb_typeof(p_ops) is distinct from 'array' then raise exception 'Changes must be a list'; end if;
  if jsonb_array_length(p_ops) > 5000 then raise exception 'Too many changes at once'; end if;

  select b.state into s from public.budgets b where b.household_id = p_household for update;
  if not found then raise exception 'This household has no budget yet'; end if;
  if jsonb_typeof(s) is distinct from 'object' then s := '{}'::jsonb; end if;

  for o in select value from jsonb_array_elements(p_ops) loop
    if o->>'op' = 'replace' then
      insert into public.budget_backups (household_id, state, reason, taken_by)
      values (p_household, s, coalesce(nullif(o->>'reason', ''), 'Replaced'), auth.uid());
      s := coalesce(o->'value', '{}'::jsonb);
      if jsonb_typeof(s) is distinct from 'object' then raise exception 'A budget must be an object'; end if;
      continue;
    end if;

    if jsonb_typeof(o->'path') is distinct from 'array' or jsonb_array_length(o->'path') = 0 then
      raise exception 'Each change needs a path';
    end if;
    select array_agg(x.v order by x.n) into p from jsonb_array_elements_text(o->'path') with ordinality as x(v, n);

    if o->>'op' = 'set' then
      -- make sure every parent along the path is an object
      for i in 1 .. array_length(p, 1) - 1 loop
        if jsonb_typeof(s #> p[1:i]) is distinct from 'object' then
          s := jsonb_set(s, p[1:i], '{}'::jsonb, true);
        end if;
      end loop;
      s := jsonb_set(s, p, coalesce(o->'value', 'null'::jsonb), true);
    elsif o->>'op' = 'del' then
      s := s #- p;
    else
      raise exception 'Unknown change type: %', o->>'op';
    end if;
  end loop;

  if octet_length(s::text) > 2000000 then raise exception 'This budget is too big to save'; end if;

  update public.budgets
     set state = s, rev = 'ops', updated_by = auth.uid(), updated_at = at
   where household_id = p_household
  returning seq into new_seq;

  return jsonb_build_object('state', s, 'seq', new_seq, 'updated_at', at, 'updated_by', auth.uid());
end $$;

revoke execute on function public.apply_budget_ops(uuid, jsonb) from public, anon;
grant execute on function public.apply_budget_ops(uuid, jsonb) to authenticated;

-- Small security tidy-ups flagged by Supabase's checker:
-- ping() is used by the keep-alive GitHub Action, so it stays callable without signing in;
-- it just gets a fixed search_path. is_member() no longer needs to be callable when signed out.
alter function public.ping() set search_path = '';
revoke execute on function public.is_member(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
