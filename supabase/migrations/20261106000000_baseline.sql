-- BASELINE: the database as it was on 6 Nov 2026, before Phase 1.
-- This file is a RECORD of what already exists in the live project (my-budget, fygldnqpvmezcmhywjtn).
-- It was never run as a migration there, and must not be re-run against it.
-- It is used by tests/sql/ to build a throwaway copy of the database for testing.

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Our budget',
  created_by uuid default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '',
  email text not null default '',
  role text not null default 'member' check (role = any (array['owner', 'member'])),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null,
  invited_by uuid default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (household_id, email)
);

create table public.budgets (
  household_id uuid primary key references public.households(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  rev text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function public.is_member(hid uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.household_members m where m.household_id = hid and m.user_id = auth.uid());
$$;

create or replace function public.ping() returns timestamptz language sql stable as $$ select now(); $$;

create or replace function public.create_household(p_name text default 'Our budget') returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare hid uuid; nm text; em text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select coalesce(nullif(u.raw_user_meta_data ->> 'name',''), split_part(u.email,'@',1)), u.email
    into nm, em from auth.users u where u.id = auth.uid();
  insert into public.households (name, created_by) values (coalesce(nullif(trim(p_name),''),'Our budget'), auth.uid()) returning id into hid;
  insert into public.household_members (household_id, user_id, display_name, email, role) values (hid, auth.uid(), nm, em, 'owner');
  insert into public.budgets (household_id, updated_by) values (hid, auth.uid());
  return hid;
end $$;

create or replace function public.invite_member(p_household uuid, p_email text) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_member(p_household) then raise exception 'Not a member of this household'; end if;
  if coalesce(trim(p_email),'') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address does not look right'; end if;
  insert into public.household_invites (household_id, email, invited_by)
  values (p_household, lower(trim(p_email)), auth.uid())
  on conflict (household_id, email) do update set accepted_at = null, created_at = now();
end $$;

create or replace function public.accept_invites() returns integer
language plpgsql security definer set search_path to 'public' as $$
declare em text; nm text; joined integer := 0; r record;
begin
  if auth.uid() is null then return 0; end if;
  select lower(u.email), coalesce(nullif(u.raw_user_meta_data ->> 'name',''), split_part(u.email,'@',1))
    into em, nm from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
  if em is null then return 0; end if;
  for r in select * from public.household_invites where lower(email) = em and accepted_at is null loop
    insert into public.household_members (household_id, user_id, display_name, email, role)
    values (r.household_id, auth.uid(), nm, em, 'member') on conflict do nothing;
    update public.household_invites set accepted_at = now() where id = r.id;
    joined := joined + 1;
  end loop;
  return joined;
end $$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.budgets enable row level security;

create policy "members read their household" on public.households for select to authenticated using (is_member(id));
create policy "members rename their household" on public.households for update to authenticated using (is_member(id)) with check (is_member(id));
create policy "members see each other" on public.household_members for select to authenticated using (is_member(household_id));
create policy "members update own name" on public.household_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "members see invites" on public.household_invites for select to authenticated using (is_member(household_id) or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy "members cancel invites" on public.household_invites for delete to authenticated using (is_member(household_id));
create policy "members read the budget" on public.budgets for select to authenticated using (is_member(household_id));
create policy "members save the budget" on public.budgets for update to authenticated using (is_member(household_id)) with check (is_member(household_id));

revoke execute on function public.accept_invites(), public.create_household(text), public.invite_member(uuid, text) from public, anon;
grant execute on function public.accept_invites(), public.create_household(text), public.invite_member(uuid, text) to authenticated;
-- (Live sync: public.budgets is in the supabase_realtime publication.)
