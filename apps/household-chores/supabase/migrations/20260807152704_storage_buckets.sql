-- Household Chores: private storage bucket for photo proof
--
-- Path convention: {household_id}/{chore_instance_id}/{timestamp}.jpg
-- The first path segment is what policies check against household
-- membership. The bucket is private; the app must always read photos via
-- signed URLs (createSignedUrl), never a public URL.

insert into storage.buckets (id, name, public)
values ('chore-photos', 'chore-photos', false)
on conflict (id) do nothing;

create policy "chore photos select household"
  on storage.objects for select
  using (
    bucket_id = 'chore-photos'
    and public.is_household_member((storage.foldername(name))[1]::uuid)
  );

create policy "chore photos insert household"
  on storage.objects for insert
  with check (
    bucket_id = 'chore-photos'
    and public.is_household_member((storage.foldername(name))[1]::uuid)
  );

create policy "chore photos delete household"
  on storage.objects for delete
  using (
    bucket_id = 'chore-photos'
    and public.is_household_member((storage.foldername(name))[1]::uuid)
  );
