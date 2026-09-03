-- Patient wig request mobile policies.
-- Supports the patient request flow that reads patient details, previews wigs,
-- uploads a reference photo, and creates a pending Wig_Requests row.

alter table public."Patients" enable row level security;
alter table public."Wig_Requests" enable row level security;
alter table public."Wig_Allocations" enable row level security;
alter table public."Wigs" enable row level security;
alter table public."Wig_AI_Filters" enable row level security;
alter table public."Wig_Specifications" enable row level security;
alter table public."Hospitals" enable row level security;
alter table public."Release_Schedules" enable row level security;
grant select, insert, update on public."Patients" to authenticated;
grant usage, select on sequence public."Patients_Patient_ID_seq" to authenticated;
grant select, insert on public."Wig_Requests" to authenticated;
grant update ("Status", "Status_Reason", "Updated_At") on public."Wig_Requests" to authenticated;
grant usage, select on sequence public."Wig_Requests_Req_ID_seq" to authenticated;
grant select on public."Wig_Allocations" to authenticated;
grant select on public."Wigs" to authenticated;
grant select on public."Wig_AI_Filters" to authenticated;
grant select on public."Wig_Specifications" to authenticated;
grant select on public."Hospitals" to authenticated;
grant select on public."Release_Schedules" to authenticated;
drop policy if exists "patients_read_own_patient_record" on public."Patients";
create policy "patients_read_own_patient_record"
on public."Patients"
for select
using (
  public.current_app_user_is_staff()
  or "User_ID" = public.current_app_user_id()
);
drop policy if exists "patients_insert_own_patient_record" on public."Patients";
create policy "patients_insert_own_patient_record"
on public."Patients"
for insert
with check ("User_ID" = public.current_app_user_id());
drop policy if exists "patients_update_own_patient_record" on public."Patients";
create policy "patients_update_own_patient_record"
on public."Patients"
for update
using (
  public.current_app_user_is_staff()
  or "User_ID" = public.current_app_user_id()
)
with check (
  public.current_app_user_is_staff()
  or "User_ID" = public.current_app_user_id()
);
drop policy if exists "patients_read_own_wig_requests" on public."Wig_Requests";
create policy "patients_read_own_wig_requests"
on public."Wig_Requests"
for select
using (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Patients" p
    where p."Patient_ID" = "Wig_Requests"."Patient_ID"
      and p."User_ID" = public.current_app_user_id()
  )
);
drop policy if exists "patients_insert_own_wig_requests" on public."Wig_Requests";
create policy "patients_insert_own_wig_requests"
on public."Wig_Requests"
for insert
with check (
  lower(coalesce("Status", 'pending')) = 'pending'
  and ("Requested_By" is null or "Requested_By" = public.current_app_user_id())
  and "Approved_By" is null
  and "Approved_At" is null
  and "Allocated_Wig_ID" is null
  and exists (
    select 1
    from public."Patients" p
    where p."Patient_ID" = "Wig_Requests"."Patient_ID"
      and p."User_ID" = public.current_app_user_id()
      and (
        "Wig_Requests"."Hospital_ID" is null
        or "Wig_Requests"."Hospital_ID" = p."Hospital_ID"
      )
  )
);
drop policy if exists "patients_cancel_own_pending_wig_requests" on public."Wig_Requests";
create policy "patients_cancel_own_pending_wig_requests"
on public."Wig_Requests"
for update
using (
  lower(trim(coalesce("Status", 'pending'))) not in (
    'accepted - wig allocated',
    'accepted - no wig available',
    'approved',
    'in production',
    'to be release',
    'releasing',
    'released',
    'rejected',
    'cancelled',
    'canceled',
    'closed'
  )
  and exists (
    select 1
    from public."Patients" p
    where p."Patient_ID" = "Wig_Requests"."Patient_ID"
      and p."User_ID" = public.current_app_user_id()
  )
)
with check (
  lower(trim(coalesce("Status", ''))) = 'cancelled'
  and exists (
    select 1
    from public."Patients" p
    where p."Patient_ID" = "Wig_Requests"."Patient_ID"
      and p."User_ID" = public.current_app_user_id()
  )
);
drop policy if exists "patients_read_own_wig_allocations" on public."Wig_Allocations";
create policy "patients_read_own_wig_allocations"
on public."Wig_Allocations"
for select
using (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Patients" p
    where p."Patient_ID" = "Wig_Allocations"."Patient_ID"
      and p."User_ID" = public.current_app_user_id()
  )
);
drop policy if exists "patients_read_available_wigs" on public."Wigs";
create policy "patients_read_available_wigs"
on public."Wigs"
for select
using (
  public.current_app_user_is_staff()
  or coalesce("Stock_Count", 0) > 0
  or lower(coalesce("Wig_Status", '')) in ('available', 'active', 'completed')
);
drop policy if exists "patients_read_active_wig_ai_filters" on public."Wig_AI_Filters";
create policy "patients_read_active_wig_ai_filters"
on public."Wig_AI_Filters"
for select
using (
  public.current_app_user_is_staff()
  or "Is_Active" = true
);
drop policy if exists "patients_read_wig_specifications" on public."Wig_Specifications";
create policy "patients_read_wig_specifications"
on public."Wig_Specifications"
for select
using (true);
drop policy if exists "patients_read_linked_hospitals" on public."Hospitals";
create policy "patients_read_linked_hospitals"
on public."Hospitals"
for select
using (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Patients" p
    where p."Hospital_ID" = "Hospitals"."Hospital_ID"
      and p."User_ID" = public.current_app_user_id()
  )
  or exists (
    select 1
    from public."Wig_Requests" wr
    join public."Patients" p on p."Patient_ID" = wr."Patient_ID"
    where wr."Hospital_ID" = "Hospitals"."Hospital_ID"
      and p."User_ID" = public.current_app_user_id()
  )
);
drop policy if exists "patients_read_own_release_schedules" on public."Release_Schedules";
create policy "patients_read_own_release_schedules"
on public."Release_Schedules"
for select
using (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Wig_Requests" wr
    join public."Patients" p on p."Patient_ID" = wr."Patient_ID"
    where wr."Req_ID" = "Release_Schedules"."Req_ID"
      and p."User_ID" = public.current_app_user_id()
  )
);
drop policy if exists "patients_upload_own_wig_reference_images" on storage.objects;
create policy "patients_upload_own_wig_reference_images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'wig_request_previews'
  and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists "patients_read_own_wig_reference_images" on storage.objects;
create policy "patients_read_own_wig_reference_images"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'wig_request_previews'
  and (
    public.current_app_user_is_staff()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);
