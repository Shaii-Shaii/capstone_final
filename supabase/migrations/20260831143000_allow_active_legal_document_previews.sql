-- Allow the mobile app to resolve and sign files belonging to active legal
-- documents without exposing unrelated objects in the private bucket.

grant select on table storage.objects to anon, authenticated;

drop policy if exists "read_active_legal_document_files" on storage.objects;
create policy "read_active_legal_document_files"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id in ('legal-documents', 'legal_documents')
  and exists (
    select 1
    from public.legal_documents document
    where document.is_active = true
      and (
        document.file_path = storage.objects.id::text
        or trim(leading '/' from document.file_path) = storage.objects.name
        or trim(leading '/' from document.file_path) = storage.objects.bucket_id || '/' || storage.objects.name
      )
  )
);
