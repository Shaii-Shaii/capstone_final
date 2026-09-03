-- Mobile hair submission permission fixes for existing tables only.
-- No table shape is changed here; this grants access and adds RLS policies
-- for the app paths that save CheckHair results.

grant select on public.wig_requirements to anon, authenticated;
drop policy if exists "public_read_wig_requirements" on public.wig_requirements;
create policy "public_read_wig_requirements"
on public.wig_requirements
for select
using (true);
grant insert on public.audit_logs to anon, authenticated;
grant usage, select on sequence public.audit_logs_log_id_seq to anon, authenticated;
drop policy if exists "app_insert_audit_logs" on public.audit_logs;
create policy "app_insert_audit_logs"
on public.audit_logs
for insert
with check (
  "user_id" is null
  or "user_id" = public.current_app_user_id()
  or public.current_app_user_is_staff()
);
grant select on public.legal_documents to anon, authenticated;
drop policy if exists "public_read_active_legal_documents" on public.legal_documents;
create policy "public_read_active_legal_documents"
on public.legal_documents
for select
using (is_active = true);
grant select, insert on public.user_legal_agreements to authenticated;
grant usage, select on sequence public.user_legal_agreements_agreement_id_seq to authenticated;
drop policy if exists "users_read_own_legal_agreements" on public.user_legal_agreements;
create policy "users_read_own_legal_agreements"
on public.user_legal_agreements
for select
using ("user_id" = public.current_app_user_id());
drop policy if exists "users_insert_own_legal_agreements" on public.user_legal_agreements;
create policy "users_insert_own_legal_agreements"
on public.user_legal_agreements
for insert
with check ("user_id" = public.current_app_user_id());
grant select, insert, update, delete on public."Hair_Submission_Images" to authenticated;
grant usage, select on sequence public."Hair_Submission_Images_Image_ID_seq" to authenticated;
drop policy if exists "donors_read_own_hair_submission_images" on public."Hair_Submission_Images";
create policy "donors_read_own_hair_submission_images"
on public."Hair_Submission_Images"
for select
using (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Hair_Submission_Details" hsd
    join public."Hair_Submissions" hs
      on hs."Submission_ID" = hsd."Submission_ID"
    where hsd."Submission_Detail_ID" = "Hair_Submission_Images"."Submission_Detail_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
);
drop policy if exists "donors_insert_own_hair_submission_images" on public."Hair_Submission_Images";
create policy "donors_insert_own_hair_submission_images"
on public."Hair_Submission_Images"
for insert
with check (
  exists (
    select 1
    from public."Hair_Submission_Details" hsd
    join public."Hair_Submissions" hs
      on hs."Submission_ID" = hsd."Submission_ID"
    where hsd."Submission_Detail_ID" = "Hair_Submission_Images"."Submission_Detail_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
);
drop policy if exists "donors_delete_own_hair_submission_images" on public."Hair_Submission_Images";
create policy "donors_delete_own_hair_submission_images"
on public."Hair_Submission_Images"
for delete
using (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Hair_Submission_Details" hsd
    join public."Hair_Submissions" hs
      on hs."Submission_ID" = hsd."Submission_ID"
    where hsd."Submission_Detail_ID" = "Hair_Submission_Images"."Submission_Detail_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
);
grant select, insert, update, delete on public."Hair_Submission_Logistics" to authenticated;
grant usage, select on sequence public."Hair_Submission_Logistics_Submission_Logistics_ID_seq" to authenticated;
drop policy if exists "donors_read_own_hair_submission_logistics" on public."Hair_Submission_Logistics";
create policy "donors_read_own_hair_submission_logistics"
on public."Hair_Submission_Logistics"
for select
using (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Hair_Submissions" hs
    where hs."Submission_ID" = "Hair_Submission_Logistics"."Submission_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
);
drop policy if exists "donors_insert_own_hair_submission_logistics" on public."Hair_Submission_Logistics";
create policy "donors_insert_own_hair_submission_logistics"
on public."Hair_Submission_Logistics"
for insert
with check (
  exists (
    select 1
    from public."Hair_Submissions" hs
    where hs."Submission_ID" = "Hair_Submission_Logistics"."Submission_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
);
drop policy if exists "donors_delete_own_hair_submission_logistics" on public."Hair_Submission_Logistics";
create policy "donors_delete_own_hair_submission_logistics"
on public."Hair_Submission_Logistics"
for delete
using (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Hair_Submissions" hs
    where hs."Submission_ID" = "Hair_Submission_Logistics"."Submission_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
);
grant select, insert, update, delete on public."Donor_Recommendations" to authenticated;
grant usage, select on sequence public."Donor_Recommendations_Recommendation_ID_seq" to authenticated;
drop policy if exists "donors_read_own_donor_recommendations" on public."Donor_Recommendations";
create policy "donors_read_own_donor_recommendations"
on public."Donor_Recommendations"
for select
using (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Hair_Submissions" hs
    where hs."Submission_ID" = "Donor_Recommendations"."Submission_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
);
drop policy if exists "donors_insert_own_donor_recommendations" on public."Donor_Recommendations";
create policy "donors_insert_own_donor_recommendations"
on public."Donor_Recommendations"
for insert
with check (
  exists (
    select 1
    from public."Hair_Submissions" hs
    where hs."Submission_ID" = "Donor_Recommendations"."Submission_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
);
drop policy if exists "donors_delete_own_donor_recommendations" on public."Donor_Recommendations";
create policy "donors_delete_own_donor_recommendations"
on public."Donor_Recommendations"
for delete
using (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Hair_Submissions" hs
    where hs."Submission_ID" = "Donor_Recommendations"."Submission_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
);
