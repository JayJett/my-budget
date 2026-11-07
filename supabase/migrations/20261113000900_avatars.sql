-- Phase 7D.2: profile pictures.
-- A PRIVATE storage bucket, "avatars". Each person's pictures live in a folder named after their user id
-- (e.g. "8d1c…/1731456000000.jpg"). Only that person can read, add, replace or remove files in their own
-- folder; nobody else (and nobody signed out) can do anything with them. The app shows a picture through
-- a short-lived signed link. Which file is current is kept on the person's login (user_metadata.avatar).
-- Additive only: no existing table, policy or data is changed.
-- Limits: 512 KB per file (the app saves ~20–40 KB 320×320 JPEGs), images only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars: read your own" on storage.objects;
create policy "avatars: read your own" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatars: add to your own folder" on storage.objects;
create policy "avatars: add to your own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatars: replace your own" on storage.objects;
create policy "avatars: replace your own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatars: remove your own" on storage.objects;
create policy "avatars: remove your own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
