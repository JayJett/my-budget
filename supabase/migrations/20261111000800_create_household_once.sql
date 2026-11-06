-- Phase 7A: "Create household" can't make two households by accident.
--
-- Before: two quick requests (a double tap, a retry after a lost reply, or two browser tabs) each made a
-- new household. The app now guards against that itself; this adds the same guard in the database.
--
-- After: requests from the same person are taken one at a time (a lock that lasts only for this
-- transaction), and if that person already made a household with the same name in the last 2 minutes
-- and is still its member, that household's id is returned instead of making another.
-- Everything else is exactly as before: one transaction makes the household, the owner membership and
-- the empty budget. A different name, or a later attempt, still makes a new household as usual.
-- Additive and safe to run again; no data is changed.
create or replace function public.create_household(p_name text default 'Our budget') returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare hid uuid; nm text; em text; want text := coalesce(nullif(trim(p_name),''),'Our budget');
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  -- one at a time per person (released automatically at the end of this transaction)
  perform pg_advisory_xact_lock(hashtextextended('create_household:' || auth.uid()::text, 0));
  select h.id into hid from public.households h
    join public.household_members m on m.household_id = h.id and m.user_id = auth.uid()
   where h.created_by = auth.uid() and h.name = want and h.created_at > now() - interval '2 minutes'
   order by h.created_at desc limit 1;
  if hid is not null then return hid; end if; -- the same request again: hand back the one just made
  select coalesce(nullif(u.raw_user_meta_data ->> 'name',''), split_part(u.email,'@',1)), u.email
    into nm, em from auth.users u where u.id = auth.uid();
  insert into public.households (name, created_by) values (want, auth.uid()) returning id into hid;
  insert into public.household_members (household_id, user_id, display_name, email, role) values (hid, auth.uid(), nm, em, 'owner');
  insert into public.budgets (household_id, updated_by) values (hid, auth.uid());
  return hid;
end $$;
