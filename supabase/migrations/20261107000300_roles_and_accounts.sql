-- PHASE 2: roles (owner / editor / viewer), managing members, several households per login,
-- leaving a household and deleting your account.
--
-- Rules:
--  * owner  : everything, including renaming the household and managing members and roles.
--  * editor : can change the budget and invite people (as editor or viewer).
--  * viewer : can look, but the database refuses any change they try to save.
--  * When the only owner leaves (or deletes their account) and others remain, ownership passes to
--    the longest-standing remaining member. A household is deleted only when its last person leaves.

-- 0. Safety fixes found while planning ----------------------------------------
-- Deleting a person's login used to delete every household they had created, even with other
-- members still in it. Now the household stays; it just forgets who created it.
alter table public.households drop constraint if exists households_created_by_fkey;
alter table public.households add constraint households_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
-- Pending invites someone sent stay valid if they delete their account.
alter table public.household_invites drop constraint if exists household_invites_invited_by_fkey;
alter table public.household_invites add constraint household_invites_invited_by_fkey
  foreign key (invited_by) references auth.users(id) on delete set null;

-- People could edit every column of their own membership row, including their role.
-- Now they can only change their display name; everything else goes through the functions below.
revoke update on public.household_members from authenticated, anon;
grant update (display_name) on public.household_members to authenticated;
-- Only the household's name can be changed directly (and only by an owner, see the policy below).
revoke update on public.households from authenticated, anon;
grant update (name) on public.households to authenticated;

-- 1. Roles ---------------------------------------------------------------------
alter table public.household_members drop constraint if exists household_members_role_check;
update public.household_members set role = 'editor' where role = 'member';
alter table public.household_members alter column role set default 'editor';
alter table public.household_members add constraint household_members_role_check
  check (role in ('owner', 'editor', 'viewer'));

alter table public.household_invites add column if not exists role text not null default 'editor';
alter table public.household_invites drop constraint if exists household_invites_role_check;
alter table public.household_invites add constraint household_invites_role_check check (role in ('editor', 'viewer'));

/** Your role in a household, or null if you're not in it. */
create or replace function public.member_role(hid uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.role from public.household_members m where m.household_id = hid and m.user_id = auth.uid();
$$;
revoke execute on function public.member_role(uuid) from public, anon;
grant execute on function public.member_role(uuid) to authenticated;

-- Only owners rename the household.
drop policy if exists "members rename their household" on public.households;
drop policy if exists "owners rename their household" on public.households;
create policy "owners rename their household" on public.households for update to authenticated
  using (public.member_role(id) = 'owner') with check (public.member_role(id) = 'owner');

-- Owners and editors can cancel invites; viewers can't.
drop policy if exists "members cancel invites" on public.household_invites;
drop policy if exists "editors cancel invites" on public.household_invites;
create policy "editors cancel invites" on public.household_invites for delete to authenticated
  using (public.member_role(household_id) in ('owner', 'editor'));

-- 2. Saving: viewers can't -------------------------------------------------------
-- Same function as Phase 1, plus the viewer check.
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
  my_role text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  my_role := public.member_role(p_household);
  if my_role is null then raise exception 'Not a member of this household'; end if;
  if my_role = 'viewer' then raise exception 'You have view-only access to this budget'; end if;
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

-- 3. Invites carry a role ---------------------------------------------------------
drop function if exists public.invite_member(uuid, text);
create or replace function public.invite_member(p_household uuid, p_email text, p_role text default 'editor') returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.member_role(p_household), 'viewer') not in ('owner', 'editor') then
    raise exception 'Only owners and editors can invite people';
  end if;
  if coalesce(p_role, '') not in ('editor', 'viewer') then raise exception 'Invite someone as an editor or a viewer'; end if;
  if coalesce(trim(p_email),'') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address does not look right'; end if;
  insert into public.household_invites (household_id, email, invited_by, role)
  values (p_household, lower(trim(p_email)), auth.uid(), p_role)
  on conflict (household_id, email) do update set accepted_at = null, created_at = now(), role = excluded.role, invited_by = excluded.invited_by;
end $$;
revoke execute on function public.invite_member(uuid, text, text) from public, anon;
grant execute on function public.invite_member(uuid, text, text) to authenticated;

create or replace function public.accept_invites() returns integer
language plpgsql security definer set search_path = public as $$
declare em text; nm text; joined integer := 0; r record;
begin
  if auth.uid() is null then return 0; end if;
  select lower(u.email), coalesce(nullif(u.raw_user_meta_data ->> 'name',''), split_part(u.email,'@',1))
    into em, nm from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
  if em is null then return 0; end if;
  for r in select * from public.household_invites where lower(email) = em and accepted_at is null loop
    insert into public.household_members (household_id, user_id, display_name, email, role)
    values (r.household_id, auth.uid(), nm, em, coalesce(r.role, 'editor')) on conflict do nothing;
    update public.household_invites set accepted_at = now() where id = r.id;
    joined := joined + 1;
  end loop;
  return joined;
end $$;
revoke execute on function public.accept_invites() from public, anon;
grant execute on function public.accept_invites() to authenticated;

-- 4. Managing members (owners only) ---------------------------------------------------
create or replace function public.set_member_role(p_household uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if public.member_role(p_household) is distinct from 'owner' then raise exception 'Only an owner can change roles'; end if;
  if coalesce(p_role, '') not in ('owner', 'editor', 'viewer') then raise exception 'Unknown role'; end if;
  select role into cur from public.household_members where household_id = p_household and user_id = p_user for update;
  if cur is null then raise exception 'That person isn''t in this household'; end if;
  if cur = 'owner' and p_role <> 'owner'
     and (select count(*) from public.household_members where household_id = p_household and role = 'owner') = 1 then
    raise exception 'A household needs at least one owner. Make someone else an owner first.';
  end if;
  update public.household_members set role = p_role where household_id = p_household and user_id = p_user;
end $$;

create or replace function public.remove_member(p_household uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.member_role(p_household) is distinct from 'owner' then raise exception 'Only an owner can remove people'; end if;
  if p_user = auth.uid() then raise exception 'To remove yourself, choose Leave household'; end if;
  delete from public.household_members where household_id = p_household and user_id = p_user;
  if not found then raise exception 'That person isn''t in this household'; end if;
end $$;

-- Internal: take someone out of a household, handing over ownership or deleting an empty household.
create or replace function public._leave(p_household uuid, p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare was text; heir uuid;
begin
  select role into was from public.household_members where household_id = p_household and user_id = p_user for update;
  if was is null then return 'not a member'; end if;
  delete from public.household_members where household_id = p_household and user_id = p_user;
  if not exists (select 1 from public.household_members where household_id = p_household) then
    delete from public.households where id = p_household;   -- also removes its budget, backups and invites
    return 'household deleted';
  end if;
  if was = 'owner' and not exists (select 1 from public.household_members where household_id = p_household and role = 'owner') then
    select user_id into heir from public.household_members where household_id = p_household order by joined_at, user_id limit 1;
    update public.household_members set role = 'owner' where household_id = p_household and user_id = heir;
    return 'ownership passed on';
  end if;
  return 'left';
end $$;
revoke execute on function public._leave(uuid, uuid) from public, anon, authenticated;

create or replace function public.leave_household(p_household uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.member_role(p_household) is null then raise exception 'Not a member of this household'; end if;
  return public._leave(p_household, auth.uid());
end $$;

-- 5. Deleting your account -------------------------------------------------------------
-- Leaves every household (handing over ownership, or deleting households you were the last
-- person in), then deletes your login. Budgets you shared with others stay with them.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid(); h uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  for h in select household_id from public.household_members where user_id = me loop
    perform public._leave(h, me);
  end loop;
  delete from public.household_invites where lower(email) = lower((select email from auth.users where id = me)) and accepted_at is null;
  delete from auth.users where id = me;
end $$;

-- 6. Keeping your name and email in step on every household --------------------------
create or replace function public.sync_my_profile() returns void
language plpgsql security definer set search_path = public as $$
declare nm text; em text;
begin
  if auth.uid() is null then return; end if;
  select coalesce(nullif(u.raw_user_meta_data ->> 'name',''), split_part(u.email,'@',1)), u.email
    into nm, em from auth.users u where u.id = auth.uid();
  update public.household_members set display_name = nm, email = coalesce(em, email) where user_id = auth.uid();
end $$;

revoke execute on function public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid),
  public.leave_household(uuid), public.delete_my_account(), public.sync_my_profile() from public, anon;
grant execute on function public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid),
  public.leave_household(uuid), public.delete_my_account(), public.sync_my_profile() to authenticated;
