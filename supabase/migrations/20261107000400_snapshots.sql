-- PART 4A: snapshots for the Progress tab.
--
--  * budget_snapshots: a copy of the parts of a budget that matter for history (people, net-worth
--    accounts with balances, goals), taken once a month and whenever an editor presses "Save a
--    snapshot now". Totals are worked out by the app, with the same maths it uses for today.
--  * A daily job (pg_cron, Supabase's built-in scheduler) takes each household's monthly snapshot
--    if it doesn't have one yet for the current month (NZ time). Daily rather than once on the 1st,
--    so a missed day (e.g. the project was paused) is caught up the next day.
--  * The app also asks for the month's snapshot when someone opens it (ensure_monthly_snapshot),
--    as a second safety net.
--  * Size limits: monthly snapshots are kept (about 2 KB each, 12 a year); only the newest 24
--    "Save now" snapshots per household are kept.

create table if not exists public.budget_snapshots (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  month date not null,                                         -- first day of the NZ month it belongs to
  kind text not null check (kind in ('monthly', 'manual')),
  taken_at timestamptz not null default now(),
  taken_by uuid references auth.users(id) on delete set null,  -- null for the automatic monthly ones
  data jsonb not null
);
create unique index if not exists budget_snapshots_one_monthly on public.budget_snapshots (household_id, month) where kind = 'monthly';
create index if not exists budget_snapshots_household_idx on public.budget_snapshots (household_id, taken_at desc);

alter table public.budget_snapshots enable row level security;
drop policy if exists "members read their snapshots" on public.budget_snapshots;
create policy "members read their snapshots" on public.budget_snapshots
  for select to authenticated using (public.is_member(household_id));
-- Nobody writes, edits or deletes snapshots directly: only the functions below add them.
revoke all on public.budget_snapshots from anon;
revoke insert, update, delete, truncate on public.budget_snapshots from authenticated;

/** The NZ month (its first day) that a moment falls in. */
create or replace function public._nz_month(t timestamptz) returns date
language sql immutable set search_path = '' as $$ select date_trunc('month', t at time zone 'Pacific/Auckland')::date $$;

/** The history-worthy parts of a saved budget, or null if it's empty or not version 4 yet. */
create or replace function public._snapshot_data(s jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when s is null or jsonb_typeof(s->'people') is distinct from 'object' then null else
    jsonb_build_object(
      'version', s->'version',
      'people', coalesce((select jsonb_object_agg(k, jsonb_build_object('id', p->'id', 'name', p->'name', 'colour', p->'colour', 'pos', p->'pos'))
                          from jsonb_each(s->'people') as e(k, p)), '{}'::jsonb),
      'nw', coalesce(s->'nw', '{}'::jsonb),
      'goals', coalesce(s->'goals', '{}'::jsonb))
  end
$$;

/** Take this month's snapshot for one household, if it doesn't have one yet. True if one was taken. */
create or replace function public._take_monthly(p_household uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare d jsonb; n int;
begin
  select public._snapshot_data(state) into d from public.budgets where household_id = p_household;
  if d is null then return false; end if;
  insert into public.budget_snapshots (household_id, month, kind, data)
  values (p_household, public._nz_month(now()), 'monthly', d)
  on conflict (household_id, month) where kind = 'monthly' do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

/** Run daily by the scheduler: every household gets this month's snapshot. Returns how many were taken. */
create or replace function public.take_monthly_snapshots() returns integer
language plpgsql security definer set search_path = public as $$
declare h uuid; taken int := 0;
begin
  for h in select household_id from public.budgets loop
    if public._take_monthly(h) then taken := taken + 1; end if;
  end loop;
  return taken;
end $$;

/** The app calls this when a household is opened: a safety net in case the scheduler missed a month. */
create or replace function public.ensure_monthly_snapshot(p_household uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if public.member_role(p_household) is null then raise exception 'Not a member of this household'; end if;
  return public._take_monthly(p_household);
end $$;

/** "Save a snapshot now" (owners and editors). Keeps only the newest 24 of these per household. */
create or replace function public.save_snapshot_now(p_household uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb; r public.budget_snapshots;
begin
  if coalesce(public.member_role(p_household), 'viewer') not in ('owner', 'editor') then
    raise exception 'Only owners and editors can save a snapshot';
  end if;
  select public._snapshot_data(state) into d from public.budgets where household_id = p_household;
  if d is null then raise exception 'There’s nothing to save yet: set up the budget first'; end if;
  insert into public.budget_snapshots (household_id, month, kind, taken_by, data)
  values (p_household, public._nz_month(now()), 'manual', auth.uid(), d) returning * into r;
  delete from public.budget_snapshots where id in (
    select id from public.budget_snapshots where household_id = p_household and kind = 'manual'
    order by taken_at desc, id desc offset 24);
  return jsonb_build_object('id', r.id, 'month', r.month, 'kind', r.kind, 'taken_at', r.taken_at, 'taken_by', r.taken_by, 'data', r.data);
end $$;

revoke execute on function public._nz_month(timestamptz), public._snapshot_data(jsonb), public._take_monthly(uuid),
  public.take_monthly_snapshots() from public, anon, authenticated;
revoke execute on function public.ensure_monthly_snapshot(uuid), public.save_snapshot_now(uuid) from public, anon;
grant execute on function public.ensure_monthly_snapshot(uuid), public.save_snapshot_now(uuid) to authenticated;

-- The daily job: 12:05 UTC is just after midnight in NZ (00:05 in winter, 01:05 in summer).
-- (Skipped where pg_cron isn't available, e.g. the throwaway test database.)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if exists (select 1 from cron.job where jobname = 'monthly-budget-snapshots') then
      perform cron.unschedule('monthly-budget-snapshots');
    end if;
    perform cron.schedule('monthly-budget-snapshots', '5 12 * * *', 'select public.take_monthly_snapshots()');
  end if;
end $$;

-- A starting point straight away, so the Progress tab has something to show.
select public.take_monthly_snapshots();
