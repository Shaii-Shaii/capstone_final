begin;

-- Keep screening photos with the AI screening that produced the result.
-- The JSON contains private Storage object paths and view metadata; image
-- binaries remain in Storage so AI_Screenings stays efficient to query.
alter table public."AI_Screenings"
add column if not exists "Screening_Images" jsonb not null default '[]'::jsonb;

alter table public."AI_Screenings"
drop constraint if exists ai_screenings_screening_images_array_check;

alter table public."AI_Screenings"
add constraint ai_screenings_screening_images_array_check
check (jsonb_typeof("Screening_Images") = 'array');

comment on column public."AI_Screenings"."Screening_Images"
is 'Ordered private Storage references and capture metadata for the photos used by this AI screening.';

insert into storage.buckets (id, name, public)
values ('hair-submissions', 'hair-submissions', false)
on conflict (id) do update set public = false;

drop policy if exists "donors_upload_own_hair_screening_images" on storage.objects;
create policy "donors_upload_own_hair_screening_images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'hair-submissions'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "donors_read_own_hair_screening_images" on storage.objects;
create policy "donors_read_own_hair_screening_images"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'hair-submissions'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.current_app_user_is_staff()
  )
);

drop policy if exists "donors_remove_own_hair_screening_images" on storage.objects;
create policy "donors_remove_own_hair_screening_images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'hair-submissions'
  and (storage.foldername(name))[1] = auth.uid()::text
);

commit;
