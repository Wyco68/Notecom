-- Slide pictures in lessons and cheatsheets.
--
-- A lesson used to say "this slide is only a picture" where the slide was a
-- diagram or a photo, because generation reads the slides as text. The
-- pictures are now saved with the lesson: one private bucket, one object per
-- picture at `<folder_id>/<sha256>.<ext>`, named by its content so the same
-- picture used twice is stored once.
--
-- Access is the folder's, like every document: the first path segment is the
-- folder, and the same notes_can_read_folder / notes_can_write_folder that
-- guard notes_documents decide here. No update policy: an object's name is its
-- content, so it never changes in place.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'notes-media',
  'notes-media',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do nothing;

create policy notes_media_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'notes-media'
    and split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
    and public.notes_can_read_folder(split_part(name, '/', 1)::uuid)
  );

create policy notes_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'notes-media'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f]{64}\.(png|jpg|gif|webp)$'
    and public.notes_can_write_folder(split_part(name, '/', 1)::uuid)
  );

create policy notes_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'notes-media'
    and split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
    and public.notes_can_write_folder(split_part(name, '/', 1)::uuid)
  );
