-- Phase 10: Payday Playbook. Additive only: one new column on household_members, one new column on
-- reminder_prefs, one new table, and functions. Nothing existing is changed or removed.
--
--  1. "Which person in this budget is me?" (household_members.person_id)
--     People in a budget (the ones with pay) and people who sign in are different things. Until now the
--     app could only guess by name. Now each member can say which budget person they are. Only they can
--     set it (through link_budget_person, never by writing the column), only to a person that's in the
--     budget, and never to a person someone else in the household has already said is them.
--  2. Payday checklists (payday_checks)
--     Ticking "done" on a payday's instructions is personal: it belongs to the member who ticked it, for
--     their own budget person, for one payday. Nobody else can see or change it (not even owners), and
--     it never touches the budget, balances, goals or history. A copy of the instructions is kept with
--     it, so a later change to the budget never rewrites a checklist already started.
--  3. An opt-in payday reminder (reminder_prefs.payday), sent by the existing daily run.

/* ---------- 1. which budget person a member is ---------- */
alter table public.household_members add column if not exists person_id text;
alter table public.household_members drop constraint if exists household_members_person_id_len;
alter table public.household_members add constraint household_members_person_id_len check (person_id is null or length(person_id) between 1 and 64);
create unique index if not exists household_members_one_person on public.household_members (household_id, person_id) where person_id is not null;

/** Say which person in this household's budget is you (or p_person null to undo it). Only ever your own
    membership. The person must be in the budget, and not already someone else's. Returns the person id. */
create or replace function public.link_budget_person(p_household uuid, p_person text) returns text
language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.household_members m where m.household_id = p_household and m.user_id = auth.uid()) then
    raise exception 'Not a member of this household';
  end if;
  if p_person is null then
    update public.household_members set person_id = null where household_id = p_household and user_id = auth.uid();
    return null;
  end if;
  if length(p_person) not between 1 and 64 then raise exception 'That person isn''t in this budget'; end if;
  select b.state into s from public.budgets b where b.household_id = p_household;
  if s is null or jsonb_typeof(s -> 'people') is distinct from 'object' or not ((s -> 'people') ? p_person) then
    raise exception 'That person isn''t in this budget';
  end if;
  if exists (select 1 from public.household_members m where m.household_id = p_household and m.person_id = p_person and m.user_id <> auth.uid()) then
    raise exception 'Someone else in this household has already said that''s them';
  end if;
  update public.household_members set person_id = p_person where household_id = p_household and user_id = auth.uid();
  return p_person;
end $$;
revoke execute on function public.link_budget_person(uuid, text) from public, anon;
grant execute on function public.link_budget_person(uuid, text) to authenticated;

/* ---------- 2. payday checklists ---------- */
create table if not exists public.payday_checks (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  person_id text not null check (length(person_id) between 1 and 64),
  payday date not null,
  plan jsonb not null check (jsonb_typeof(plan) = 'object' and octet_length(plan::text) <= 16000),
  done jsonb not null default '{}'::jsonb check (jsonb_typeof(done) = 'object' and octet_length(done::text) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, user_id, person_id, payday)
);
alter table public.payday_checks enable row level security;
drop policy if exists "people read their own payday checklists" on public.payday_checks;
create policy "people read their own payday checklists" on public.payday_checks for select to authenticated
  using (user_id = auth.uid() and public.is_member(household_id));
-- Changes only go through the functions below (they check who you are and which person is yours).
revoke all on public.payday_checks from anon;
revoke insert, update, delete, truncate on public.payday_checks from authenticated;
grant select on public.payday_checks to authenticated;

/** You, in this household, as this budget person (the link from part 1). */
create or replace function public._my_person(p_household uuid, p_person text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.household_members m where m.household_id = p_household and m.user_id = auth.uid()) then
    raise exception 'Not a member of this household';
  end if;
  if not exists (select 1 from public.household_members m where m.household_id = p_household and m.user_id = auth.uid() and m.person_id = p_person) then
    raise exception 'This checklist is for someone else';
  end if;
end $$;
revoke execute on function public._my_person(uuid, text) from public, anon, authenticated;

/** Your checklist for one payday, or null when you haven't started it. */
create or replace function public.payday_check_get(p_household uuid, p_person text, p_payday date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.payday_checks;
begin
  perform public._my_person(p_household, p_person);
  select * into r from public.payday_checks c where c.household_id = p_household and c.user_id = auth.uid() and c.person_id = p_person and c.payday = p_payday;
  if not found then return null; end if;
  return jsonb_build_object('payday', r.payday, 'plan', r.plan, 'done', r.done, 'updated_at', r.updated_at);
end $$;

/** Tick (p_on true) or untick one instruction. The first tick keeps a copy of the instructions (p_plan);
    after that the copy only changes through payday_check_replan. Ticking the same thing twice is fine. */
create or replace function public.payday_check_mark(p_household uuid, p_person text, p_payday date, p_plan jsonb, p_key text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.payday_checks;
begin
  perform public._my_person(p_household, p_person);
  if p_key is null or length(p_key) not between 1 and 120 then raise exception 'Unknown instruction'; end if;
  if p_payday < current_date - 400 or p_payday > current_date + 400 then raise exception 'That payday is too far away'; end if;
  insert into public.payday_checks (household_id, user_id, person_id, payday, plan)
  values (p_household, auth.uid(), p_person, p_payday, coalesce(p_plan, '{}'::jsonb))
  on conflict do nothing;
  update public.payday_checks c
     set done = case when p_on then c.done || jsonb_build_object(p_key, true) else c.done - p_key end, updated_at = now()
   where c.household_id = p_household and c.user_id = auth.uid() and c.person_id = p_person and c.payday = p_payday
  returning * into r;
  -- keep it small: a year and a bit of your own old checklists is plenty
  delete from public.payday_checks c where c.user_id = auth.uid() and c.payday < current_date - 400;
  return jsonb_build_object('payday', r.payday, 'plan', r.plan, 'done', r.done, 'updated_at', r.updated_at);
end $$;

/** Switch a started checklist to the budget's current instructions (you chose to). Ticks for
    instructions that are still there are kept; the rest go. */
create or replace function public.payday_check_replan(p_household uuid, p_person text, p_payday date, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.payday_checks; keys text[];
begin
  perform public._my_person(p_household, p_person);
  if jsonb_typeof(p_plan) is distinct from 'object' then raise exception 'A plan must be an object'; end if;
  select coalesce(array_agg(g ->> 'key'), '{}') into keys from jsonb_array_elements(coalesce(p_plan -> 'groups', '[]'::jsonb)) g;
  update public.payday_checks c
     set plan = p_plan,
         done = coalesce((select jsonb_object_agg(k, v) from jsonb_each(c.done) d(k, v) where k = any(keys)), '{}'::jsonb),
         updated_at = now()
   where c.household_id = p_household and c.user_id = auth.uid() and c.person_id = p_person and c.payday = p_payday
  returning * into r;
  if not found then return null; end if;
  return jsonb_build_object('payday', r.payday, 'plan', r.plan, 'done', r.done, 'updated_at', r.updated_at);
end $$;
revoke execute on function public.payday_check_get(uuid, text, date), public.payday_check_mark(uuid, text, date, jsonb, text, boolean),
  public.payday_check_replan(uuid, text, date, jsonb) from public, anon;
grant execute on function public.payday_check_get(uuid, text, date), public.payday_check_mark(uuid, text, date, jsonb, text, boolean),
  public.payday_check_replan(uuid, text, date, jsonb) to authenticated;

/* ---------- 3. the payday reminder (opt-in) ---------- */
alter table public.reminder_prefs add column if not exists payday boolean not null default false;

/** Unchanged, except a payday reminder alone is also a reason to run. */
create or replace function public.start_reminder_run(p_force boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare tok uuid;
begin
  if not p_force then
    if extract(hour from now() at time zone 'Pacific/Auckland') <> 8 then return null; end if;
    if exists (select 1 from public.reminder_runs where started_at > now() - interval '20 hours') then return null; end if;
  end if;
  if not exists (select 1 from public.reminder_prefs where review or sink_due or sink_behind or goal_done or goal_risk or allocation or payday) then
    return null; -- nobody has any reminders on: nothing to do
  end if;
  insert into public.reminder_runs default values returning token into tok;
  if to_regproc('net.http_post') is not null then
    execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 60000)'
      using 'https://fygldnqpvmezcmhywjtn.supabase.co/functions/v1/send-reminders',
            jsonb_build_object('token', tok), '{"Content-Type": "application/json"}'::jsonb;
  end if;
  return tok;
end $$;

/** Unchanged, except: payday counts as a switch, and each person comes with the budget person they
    said they are (person_id), so a payday reminder goes only to the person it's for. */
create or replace function public.reminder_run_data(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public._reminder_run(p_token);
  return jsonb_build_object(
    'today', (now() at time zone 'Pacific/Auckland')::date,
    'households', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.household_id, 'state', b.state, 'people', p.people))
        from public.budgets b
        join (select rp.household_id, jsonb_agg(jsonb_build_object('user_id', rp.user_id, 'person_id', m.person_id, 'prefs', to_jsonb(rp) - 'user_id' - 'household_id' - 'updated_at')) as people
                from public.reminder_prefs rp
                join public.household_members m on m.household_id = rp.household_id and m.user_id = rp.user_id
               where rp.review or rp.sink_due or rp.sink_behind or rp.goal_done or rp.goal_risk or rp.allocation or rp.payday
               group by rp.household_id) p on p.household_id = b.household_id), '[]'::jsonb));
end $$;
revoke execute on function public.start_reminder_run(boolean) from public, anon, authenticated;
revoke execute on function public.reminder_run_data(uuid) from public, authenticated;
grant execute on function public.reminder_run_data(uuid) to anon;
