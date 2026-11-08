-- Phase 8: how a household looks (its colour, icon or photo).
--
-- Additive only: one new column with a safe default, one new function, one new private storage bucket
-- and its rules. No existing table, column, rule or row is changed or removed.
--
-- 1. households.appearance: { colour, icon, photo } (all optional). Everyone in the household can see
--    it (the existing "members read their household" rule). Only owners and editors can change it,
--    and only through set_household_appearance(), which keeps just those three keys with sensible values.
--    It can't be changed directly: people can still only update a household's name, as before.
-- 2. A PRIVATE bucket, "household-photos". Each household's photo lives in a folder named after the
--    household's id ("<household id>/<time>.jpg"). People in the household can see it (through a
--    short-lived signed link); owners and editors can add, replace or remove it; nobody else can do
--    anything with it. 512 KB per file, images only (the app saves ~20–40 KB 320×320 JPEGs and
--    removes the old one when it's replaced).

alter table public.households add column if not exists appearance jsonb not null default '{}'::jsonb;
alter table public.households drop constraint if exists households_appearance_small;
alter table public.households add constraint households_appearance_small
  check (jsonb_typeof(appearance) = 'object' and pg_column_size(appearance) < 1024);

create or replace function public.set_household_appearance(p_household uuid, p_appearance jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  my_role text;
  clean jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  my_role := public.member_role(p_household);
  if my_role is null then raise exception 'Not a member of this household'; end if;
  if my_role not in ('owner', 'editor') then raise exception 'Only owners and editors can change how the household looks'; end if;
  if jsonb_typeof(p_appearance) is distinct from 'object' then raise exception 'Appearance must be an object'; end if;
  clean := jsonb_strip_nulls(jsonb_build_object(
    'colour', case when p_appearance ->> 'colour' ~ '^[a-z]{2,12}$' then p_appearance ->> 'colour' end,
    'icon',   case when p_appearance ->> 'icon' ~ '^[a-z]{2,16}$' then p_appearance ->> 'icon' end,
    -- a photo must be in this household's own folder
    'photo',  case when p_appearance ->> 'photo' ~ ('^' || p_household::text || '/[0-9]{10,16}\.jpg$') then p_appearance ->> 'photo' end));
  update public.households set appearance = clean where id = p_household;
  return clean;
end $$;
revoke execute on function public.set_household_appearance(uuid, jsonb) from public, anon;
grant execute on function public.set_household_appearance(uuid, jsonb) to authenticated;

/** Your role in the household a storage folder is named after, or null (also for folder names that
    aren't a household id at all, so a bad name never errors, it's just refused). */
create or replace function public.household_folder_role(folder text) returns text
language sql stable security definer set search_path = public as $$
  select m.role from public.household_members m where m.household_id::text = folder and m.user_id = auth.uid();
$$;
revoke execute on function public.household_folder_role(text) from public, anon;
grant execute on function public.household_folder_role(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('household-photos', 'household-photos', false, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "household photos: members see them" on storage.objects;
create policy "household photos: members see them" on storage.objects for select to authenticated
  using (bucket_id = 'household-photos' and public.household_folder_role((storage.foldername(name))[1]) is not null);

drop policy if exists "household photos: owners and editors add" on storage.objects;
create policy "household photos: owners and editors add" on storage.objects for insert to authenticated
  with check (bucket_id = 'household-photos' and public.household_folder_role((storage.foldername(name))[1]) in ('owner', 'editor'));

drop policy if exists "household photos: owners and editors replace" on storage.objects;
create policy "household photos: owners and editors replace" on storage.objects for update to authenticated
  using (bucket_id = 'household-photos' and public.household_folder_role((storage.foldername(name))[1]) in ('owner', 'editor'))
  with check (bucket_id = 'household-photos' and public.household_folder_role((storage.foldername(name))[1]) in ('owner', 'editor'));

drop policy if exists "household photos: owners and editors remove" on storage.objects;
create policy "household photos: owners and editors remove" on storage.objects for delete to authenticated
  using (bucket_id = 'household-photos' and public.household_folder_role((storage.foldername(name))[1]) in ('owner', 'editor'));
