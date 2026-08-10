-- Patient records use the application's integer User_ID, while Supabase Auth
-- identifies the caller with a UUID. Match both identifiers directly in the
-- policy so an authenticated user can only create and maintain their own row.

drop policy if exists "patients_read_own_patient_record" on public."Patients";
create policy "patients_read_own_patient_record"
on public."Patients"
for select
to authenticated
using (
  public.current_app_user_is_staff()
  or (
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.users u
      where u.user_id = "Patients"."User_ID"
        and u.auth_user_id = (select auth.uid())
    )
  )
);

drop policy if exists "patients_insert_own_patient_record" on public."Patients";
create policy "patients_insert_own_patient_record"
on public."Patients"
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.users u
    where u.user_id = "Patients"."User_ID"
      and u.auth_user_id = (select auth.uid())
  )
);

drop policy if exists "patients_update_own_patient_record" on public."Patients";
create policy "patients_update_own_patient_record"
on public."Patients"
for update
to authenticated
using (
  public.current_app_user_is_staff()
  or (
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.users u
      where u.user_id = "Patients"."User_ID"
        and u.auth_user_id = (select auth.uid())
    )
  )
)
with check (
  public.current_app_user_is_staff()
  or (
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.users u
      where u.user_id = "Patients"."User_ID"
        and u.auth_user_id = (select auth.uid())
    )
  )
);
