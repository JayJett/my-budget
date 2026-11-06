-- PART 4C (step 2): phone and computer notifications ("web push"), on top of the reminders inbox.
--
--  * push_subscriptions: the devices where someone has turned notifications on. A "subscription" is an
--    address at Apple's or Google's push service for one app on one device, plus two keys the device made
--    so only it can read what's sent. Each person sees and removes only their own devices.
--  * The morning run now also gets back, for each person with brand-new reminders, their devices.
--    The function sends one notification per person per device (several reminders become "3 new
--    reminders"), then reports devices that have gone away, so they're forgotten.
--  * "Send a test" (push_test_targets): at most once a minute, only to your own devices.
--  * A device is linked to one login at a time: if someone else signs in on it and turns notifications on,
--    it moves to them. Signing out forgets it. At most 10 devices per person.

create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%' and length(endpoint) < 1000),
  p256dh text not null check (length(p256dh) between 80 and 100),
  auth text not null check (length(auth) between 16 and 32),
  label text not null default '' check (length(label) <= 60),
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  last_test_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "people see their own devices" on public.push_subscriptions;
create policy "people see their own devices" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists "people remove their own devices" on public.push_subscriptions;
create policy "people remove their own devices" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
revoke all on public.push_subscriptions from anon;
revoke insert, update, truncate on public.push_subscriptions from authenticated;

/** Turn notifications on for this device (or refresh its keys). */
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_label text default '')
returns bigint language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint; -- this device now belongs to whoever is signed in
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, label)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_label, ''), 60)) returning id into new_id;
  delete from public.push_subscriptions where id in (
    select id from public.push_subscriptions where user_id = auth.uid() order by created_at desc, id desc offset 10);
  return new_id;
end $$;

/** Turn notifications off for this device (also used when signing out). */
create or replace function public.forget_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid() $$;

/** "Send a test": your devices, at most once a minute. */
create or replace function public.push_test_targets() returns setof public.push_subscriptions
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.push_subscriptions where user_id = auth.uid() and last_test_at > now() - interval '1 minute') then
    raise exception 'You just sent a test. Wait a minute before sending another.';
  end if;
  return query update public.push_subscriptions set last_test_at = now() where user_id = auth.uid() returning *;
end $$;

/* The morning run's hand-back now also returns what to send (it no longer ends the run: the
   function does that with reminder_run_finish, once the notifications have gone). */
drop function if exists public.reminder_run_save(uuid, jsonb);
create or replace function public.reminder_run_save(p_token uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it jsonb; n int := 0; fresh int; rid bigint; new_ids bigint[] := '{}';
begin
  perform public._reminder_run(p_token);
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Reminders must be a list'; end if;
  if jsonb_array_length(p_items) > 10000 then raise exception 'Too many reminders at once'; end if;
  for it in select value from jsonb_array_elements(p_items) loop
    if not exists (select 1 from public.reminder_prefs rp join public.household_members m using (household_id, user_id)
                    where rp.user_id = (it->>'user_id')::uuid and rp.household_id = (it->>'household_id')::uuid) then continue; end if;
    insert into public.reminder_log (user_id, household_id, key)
    values ((it->>'user_id')::uuid, (it->>'household_id')::uuid, left(it->>'key', 200))
    on conflict do nothing;
    get diagnostics fresh = row_count;
    if fresh > 0 then
      insert into public.reminders (user_id, household_id, kind, key, title, body, tab)
      values ((it->>'user_id')::uuid, (it->>'household_id')::uuid, left(coalesce(it->>'kind', ''), 40), left(it->>'key', 200),
              left(coalesce(it->>'title', ''), 200), left(coalesce(it->>'body', ''), 1000), left(it->>'tab', 20))
      returning id into rid;
      new_ids := new_ids || rid; n := n + 1;
    end if;
  end loop;
  return jsonb_build_object(
    'created', n,
    'pushes', coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'title', r.title, 'body', r.body, 'tab', r.tab) order by r.id)
                          from public.reminders r where r.id = any(new_ids)), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'user_id', s.user_id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                           from public.push_subscriptions s
                          where s.user_id in (select r.user_id from public.reminders r where r.id = any(new_ids))), '[]'::jsonb));
end $$;

/** The end of the morning run: forget devices that have gone away, note which were reached, close the pass. */
create or replace function public.reminder_run_finish(p_token uuid, p_gone bigint[] default '{}', p_sent bigint[] default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare r public.reminder_runs;
begin
  r := public._reminder_run(p_token);
  delete from public.push_subscriptions where id = any(coalesce(p_gone, '{}'));
  update public.push_subscriptions set last_sent_at = now() where id = any(coalesce(p_sent, '{}'));
  update public.reminder_runs set finished_at = now(),
    created = (select count(*) from public.reminders where created_at >= r.started_at) where id = r.id;
end $$;

revoke execute on function public.save_push_subscription(text, text, text, text), public.forget_push_subscription(text),
  public.push_test_targets() from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text), public.forget_push_subscription(text),
  public.push_test_targets() to authenticated;
-- Like reminder_run_data: open to anon (the function), but useless without a valid pass.
revoke execute on function public.reminder_run_save(uuid, jsonb), public.reminder_run_finish(uuid, bigint[], bigint[]) from public, authenticated;
grant execute on function public.reminder_run_save(uuid, jsonb), public.reminder_run_finish(uuid, bigint[], bigint[]) to anon;
