-- Enforce one AI_Screenings row and one Hair_Submission_Details row per
-- Hair_Submissions.Submission_ID. This also cleans legacy duplicates before
-- rebuilding the unique guards used by app-level upserts.

with ranked_screenings as (
  select
    "AI_Screening_ID",
    row_number() over (
      partition by "Submission_ID"
      order by "Created_At" desc nulls last, "AI_Screening_ID" desc
    ) as rn
  from public."AI_Screenings"
)
delete from public."AI_Screenings" ai
using ranked_screenings rs
where ai."AI_Screening_ID" = rs."AI_Screening_ID"
  and rs.rn > 1;
with ranked_details as (
  select
    "Submission_Detail_ID",
    row_number() over (
      partition by "Submission_ID"
      order by "Created_At" desc nulls last, "Submission_Detail_ID" desc
    ) as rn
  from public."Hair_Submission_Details"
),
kept_details as (
  select
    old_detail."Submission_Detail_ID",
    keep_detail."Submission_Detail_ID" as keep_detail_id
  from ranked_details old_rank
  join public."Hair_Submission_Details" old_detail
    on old_detail."Submission_Detail_ID" = old_rank."Submission_Detail_ID"
  join ranked_details keep_rank
    on keep_rank.rn = 1
  join public."Hair_Submission_Details" keep_detail
    on keep_detail."Submission_Detail_ID" = keep_rank."Submission_Detail_ID"
   and keep_detail."Submission_ID" = old_detail."Submission_ID"
  where old_rank.rn > 1
)
update public."Hair_Submission_Images" hsi
set "Submission_Detail_ID" = kept_details.keep_detail_id
from kept_details
where hsi."Submission_Detail_ID" = kept_details."Submission_Detail_ID";
with ranked_details as (
  select
    "Submission_Detail_ID",
    row_number() over (
      partition by "Submission_ID"
      order by "Created_At" desc nulls last, "Submission_Detail_ID" desc
    ) as rn
  from public."Hair_Submission_Details"
)
delete from public."Hair_Submission_Details" hsd
using ranked_details rd
where hsd."Submission_Detail_ID" = rd."Submission_Detail_ID"
  and rd.rn > 1;
create unique index if not exists uq_ai_screenings_submission
on public."AI_Screenings" ("Submission_ID");
create unique index if not exists uq_hair_submission_details_submission
on public."Hair_Submission_Details" ("Submission_ID");
drop policy if exists "donors_update_own_hair_submission_details" on public."Hair_Submission_Details";
create policy "donors_update_own_hair_submission_details"
on public."Hair_Submission_Details"
for update
using (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Hair_Submissions" hs
    where hs."Submission_ID" = "Hair_Submission_Details"."Submission_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
)
with check (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Hair_Submissions" hs
    where hs."Submission_ID" = "Hair_Submission_Details"."Submission_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
);
drop policy if exists "donors_update_own_ai_screenings" on public."AI_Screenings";
create policy "donors_update_own_ai_screenings"
on public."AI_Screenings"
for update
using (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Hair_Submissions" hs
    where hs."Submission_ID" = "AI_Screenings"."Submission_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
)
with check (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Hair_Submissions" hs
    where hs."Submission_ID" = "AI_Screenings"."Submission_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
);
