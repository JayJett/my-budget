-- PART 4C (step 1): gentle reminders, shown in the app's inbox (the bell).
--
--  * reminder_prefs: each person's switches, per household. Everything is off until they turn it on.
--  * reminders: each person's inbox.
--  * reminder_log: which reminder (by its key) each person has already had, so nothing is sent twice.
--    Kept for 400 days, longer than the inbox, so a "goal reached" never comes back after a clean-up.
--  * Every morning at about 8:30 NZ time, the database starts a "run": it makes a one-time pass
--    (a random token, valid for 15 minutes) and calls the send-reminders function with it
--    (supabase/functions/send-reminders). The function uses the pass to fetch the budgets of people
--    who've turned reminders on, works out the reminders with the app's own maths (js/model/reminders.js),
--    and hands them back with the same pass. No secret keys are involved, and the pass is useless
--    once the run is over.
--  * Clean-up: inbox items older than 60 days go, and at most 200 are kept per person.

/* ---------- each person's switches ---------- */
create table if not exists public.reminder_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  review boolean not null default false,
  review_day int not null default 1 check (review_day between 1 and 28),
  sink_due boolean not null default false,
  due_weeks int not null default 6 check (due_weeks in (2, 4, 6, 8)),
  sink_behind boolean not null default false,
  goal_done boolean not null default false,
  goal_risk boolean not null default false,
  allocation boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, household_id)
);
alter table public.reminder_prefs enable row level security;
drop policy if exists "people manage their own reminder settings" on public.reminder_prefs;
create policy "people manage their own reminder settings" on public.reminder_prefs for all to authenticated
  using (user_id = auth.uid() and public.is_member(household_id))
  with check (user_id = auth.uid() and public.is_member(household_id));
revoke all on public.reminder_prefs from anon;
revoke truncate on public.reminder_prefs from authenticated;

/* ---------- each person's inbox ---------- */
create table if not exists public.reminders (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  kind text not null,
  key text not null,
  title text not null,
  body text not null default '',
  tab text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists reminders_user_idx on public.reminders (user_id, household_id, created_at desc);
alter table public.reminders enable row level security;
drop policy if exists "people read their own reminders" on public.reminders;
create policy "people read their own reminders" on public.reminders for select to authenticated
  using (user_id = auth.uid() and public.is_member(household_id));
drop policy if exists "people mark their own reminders read" on public.reminders;
create policy "people mark their own reminders read" on public.reminders for update to authenticated
  using (user_id = auth.uid() and public.is_member(household_id)) with check (user_id = auth.uid());
drop policy if exists "people clear their own reminders" on public.reminders;
create policy "people clear their own reminders" on public.reminders for delete to authenticated
  using (user_id = auth.uid());
-- Only the daily run adds reminders; people can only mark them read (or clear them).
revoke all on public.reminders from anon;
revoke insert, update, truncate on public.reminders from authenticated;
grant update (read_at) on public.reminders to authenticated;

/* ---------- what's already been sent, and the daily runs (nobody reads these directly) ---------- */
create table if not exists public.reminder_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, household_id, key)
);
create table if not exists public.reminder_runs (
  id bigint generated always as identity primary key,
  token uuid not null unique default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created int
);
alter table public.reminder_log enable row level security;
alter table public.reminder_runs enable row level security;
revoke all on public.reminder_log, public.reminder_runs from anon, authenticated;

/* ---------- the daily run ---------- */
/** A run's pass is valid for 15 minutes, until the run finishes. */
create or replace function public._reminder_run(p_token uuid) returns public.reminder_runs
language plpgsql stable security definer set search_path = public as $$
declare r public.reminder_runs;
begin
  select * into r from public.reminder_runs where token = p_token;
  if not found or r.finished_at is not null or r.started_at < now() - interval '15 minutes' then
    raise exception 'This reminder run has expired';
  end if;
  return r;
end $$;

/** Started by the scheduler. Only does anything at 8am NZ time (unless forced), at most once a day. */
create or replace function public.start_reminder_run(p_force boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare tok uuid;
begin
  if not p_force then
    if extract(hour from now() at time zone 'Pacific/Auckland') <> 8 then return null; end if;
    if exists (select 1 from public.reminder_runs where started_at > now() - interval '20 hours') then return null; end if;
  end if;
  if not exists (select 1 from public.reminder_prefs where review or sink_due or sink_behind or goal_done or goal_risk or allocation) then
    return null; -- nobody has any reminders on: nothing to do
  end if;
  insert into public.reminder_runs default values returning token into tok;
  -- Call the function (where Supabase's pg_net is available; the throwaway test database doesn't have it).
  if to_regproc('net.http_post') is not null then
    execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 60000)'
      using 'https://fygldnqpvmezcmhywjtn.supabase.co/functions/v1/send-reminders',
            jsonb_build_object('token', tok), '{"Content-Type": "application/json"}'::jsonb;
  end if;
  return tok;
end $$;

/** For the function, with the run's pass: today's date in NZ, and for each household with someone
    who has reminders on, its budget and those people's switches. */
create or replace function public.reminder_run_data(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public._reminder_run(p_token);
  return jsonb_build_object(
    'today', (now() at time zone 'Pacific/Auckland')::date,
    'households', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.household_id, 'state', b.state, 'people', p.people))
        from public.budgets b
        join (select rp.household_id, jsonb_agg(jsonb_build_object('user_id', rp.user_id, 'prefs', to_jsonb(rp) - 'user_id' - 'household_id' - 'updated_at')) as people
                from public.reminder_prefs rp
                join public.household_members m on m.household_id = rp.household_id and m.user_id = rp.user_id
               where rp.review or rp.sink_due or rp.sink_behind or rp.goal_done or rp.goal_risk or rp.allocation
               group by rp.household_id) p on p.household_id = b.household_id), '[]'::jsonb));
end $$;

/** For the function, with the run's pass: the reminders it worked out. Anything already sent
    (same key) is skipped. Returns how many new reminders went into inboxes. */
create or replace function public.reminder_run_save(p_token uuid, p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r public.reminder_runs; it jsonb; n int := 0; fresh int;
begin
  r := public._reminder_run(p_token);
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Reminders must be a list'; end if;
  if jsonb_array_length(p_items) > 10000 then raise exception 'Too many reminders at once'; end if;
  for it in select value from jsonb_array_elements(p_items) loop
    -- only for people who are still in the household and have reminders set up there
    if not exists (select 1 from public.reminder_prefs rp join public.household_members m using (household_id, user_id)
                    where rp.user_id = (it->>'user_id')::uuid and rp.household_id = (it->>'household_id')::uuid) then continue; end if;
    insert into public.reminder_log (user_id, household_id, key)
    values ((it->>'user_id')::uuid, (it->>'household_id')::uuid, left(it->>'key', 200))
    on conflict do nothing;
    get diagnostics fresh = row_count;
    if fresh > 0 then
      insert into public.reminders (user_id, household_id, kind, key, title, body, tab)
      values ((it->>'user_id')::uuid, (it->>'household_id')::uuid, left(coalesce(it->>'kind', ''), 40), left(it->>'key', 200),
              left(coalesce(it->>'title', ''), 200), left(coalesce(it->>'body', ''), 1000), left(it->>'tab', 20));
      n := n + 1;
    end if;
  end loop;
  update public.reminder_runs set finished_at = now(), created = n where id = r.id;
  return n;
end $$;

/** Nightly: inbox items older than 60 days, more than 200 per person, old runs and log entries, and
    settings left behind by people who've left a household. */
create or replace function public.prune_reminders() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a int; b int;
begin
  delete from public.reminders where created_at < now() - interval '60 days';
  get diagnostics a = row_count;
  delete from public.reminders where id in (
    select id from (select id, row_number() over (partition by user_id order by created_at desc, id desc) as rn from public.reminders) x where x.rn > 200);
  get diagnostics b = row_count;
  delete from public.reminder_log where sent_at < now() - interval '400 days';
  delete from public.reminder_runs where started_at < now() - interval '30 days';
  delete from public.reminder_prefs rp where not exists (select 1 from public.household_members m where m.household_id = rp.household_id and m.user_id = rp.user_id);
  delete from public.reminders r where not exists (select 1 from public.household_members m where m.household_id = r.household_id and m.user_id = r.user_id);
  return jsonb_build_object('older_than_60_days', a, 'over_200', b);
end $$;

revoke execute on function public._reminder_run(uuid), public.start_reminder_run(boolean), public.prune_reminders() from public, anon, authenticated;
-- The function calls these two without signing in, so they're open to anon, but they do nothing without a valid pass.
revoke execute on function public.reminder_run_data(uuid), public.reminder_run_save(uuid, jsonb) from public, authenticated;
grant execute on function public.reminder_run_data(uuid), public.reminder_run_save(uuid, jsonb) to anon;

-- Schedule: 19:30 and 20:30 UTC are 8:30am NZ in summer and winter; the run itself checks it's 8am in NZ.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    if exists (select 1 from pg_available_extensions where name = 'pg_net') then
      create extension if not exists pg_net with schema extensions; -- Supabase keeps add-ons out of "public"
    end if;
    create extension if not exists pg_cron;
    if exists (select 1 from cron.job where jobname = 'daily-reminders') then perform cron.unschedule('daily-reminders'); end if;
    perform cron.schedule('daily-reminders', '30 19,20 * * *', 'select public.start_reminder_run()');
    if exists (select 1 from cron.job where jobname = 'reminder-cleanup') then perform cron.unschedule('reminder-cleanup'); end if;
    perform cron.schedule('reminder-cleanup', '35 12 * * *', 'select public.prune_reminders()');
  end if;
end $$;
