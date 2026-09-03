-- Register-to-donate must be idempotent:
-- 1. One Event_Attendees row per donor/event.
-- 2. One Hair_Submissions row per donor/event and per event attendee.
-- 3. One Hair_Submission_Details row and one AI_Screenings row per submission.
--
-- This protects the app from double taps and from the trigger/app both ensuring
-- donation rows during RSVP creation.

with ranked_event_attendees as (
  select
    "Event_Attendee_ID",
    first_value("Event_Attendee_ID") over (
      partition by "User_ID", "Event_Request_ID"
      order by
        case when public.normalize_flow_key(coalesce("Registration_Status", '')) = 'registered' then 0 else 1 end,
        "Created_At" asc nulls last,
        "Event_Attendee_ID" asc
    ) as keep_event_attendee_id,
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by
        case when public.normalize_flow_key(coalesce("Registration_Status", '')) = 'registered' then 0 else 1 end,
        "Created_At" asc nulls last,
        "Event_Attendee_ID" asc
    ) as rn
  from public."Event_Attendees"
  where "User_ID" is not null
    and "Event_Request_ID" is not null
),
duplicate_event_attendees as (
  select *
  from ranked_event_attendees
  where rn > 1
)
update public."Hair_Submissions" hs
set "Event_Attendee_ID" = dea.keep_event_attendee_id,
    "Updated_At" = timezone('Asia/Manila', now())
from duplicate_event_attendees dea
where hs."Event_Attendee_ID" = dea."Event_Attendee_ID";
with ranked_event_attendees as (
  select
    "Event_Attendee_ID",
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by
        case when public.normalize_flow_key(coalesce("Registration_Status", '')) = 'registered' then 0 else 1 end,
        "Created_At" asc nulls last,
        "Event_Attendee_ID" asc
    ) as rn
  from public."Event_Attendees"
  where "User_ID" is not null
    and "Event_Request_ID" is not null
)
delete from public."Event_Attendees" ea
using ranked_event_attendees rea
where ea."Event_Attendee_ID" = rea."Event_Attendee_ID"
  and rea.rn > 1;
with ranked_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "User_ID", "Event_Request_ID"
      order by
        case when "Event_Attendee_ID" is not null then 0 else 1 end,
        "Created_At" asc nulls last,
        "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by
        case when "Event_Attendee_ID" is not null then 0 else 1 end,
        "Created_At" asc nulls last,
        "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "User_ID" is not null
    and "Event_Request_ID" is not null
),
duplicate_submissions as (
  select *
  from ranked_submissions
  where rn > 1
)
update public."Hair_Bundle_Tracking_History" hbth
set "Submission_ID" = ds.keep_submission_id
from duplicate_submissions ds
where hbth."Submission_ID" = ds."Submission_ID";
with ranked_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "User_ID", "Event_Request_ID"
      order by case when "Event_Attendee_ID" is not null then 0 else 1 end, "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by case when "Event_Attendee_ID" is not null then 0 else 1 end, "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "User_ID" is not null
    and "Event_Request_ID" is not null
),
duplicate_submissions as (
  select *
  from ranked_submissions
  where rn > 1
)
update public."Donor_Recommendations" dr
set "Submission_ID" = ds.keep_submission_id
from duplicate_submissions ds
where dr."Submission_ID" = ds."Submission_ID";
with ranked_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "User_ID", "Event_Request_ID"
      order by case when "Event_Attendee_ID" is not null then 0 else 1 end, "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by case when "Event_Attendee_ID" is not null then 0 else 1 end, "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "User_ID" is not null
    and "Event_Request_ID" is not null
),
duplicate_submissions as (
  select *
  from ranked_submissions
  where rn > 1
)
update public."Hair_Submission_Logistics" hsl
set "Submission_ID" = ds.keep_submission_id
from duplicate_submissions ds
where hsl."Submission_ID" = ds."Submission_ID"
  and not exists (
    select 1
    from public."Hair_Submission_Logistics" existing
    where existing."Submission_ID" = ds.keep_submission_id
  );
with ranked_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "User_ID", "Event_Request_ID"
      order by case when "Event_Attendee_ID" is not null then 0 else 1 end, "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by case when "Event_Attendee_ID" is not null then 0 else 1 end, "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "User_ID" is not null
    and "Event_Request_ID" is not null
),
duplicate_submissions as (
  select *
  from ranked_submissions
  where rn > 1
)
update public."Donation_Certificates" dc
set "Submission_ID" = ds.keep_submission_id
from duplicate_submissions ds
where dc."Submission_ID" = ds."Submission_ID"
  and not exists (
    select 1
    from public."Donation_Certificates" existing
    where existing."Submission_ID" = ds.keep_submission_id
  );
with ranked_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "User_ID", "Event_Request_ID"
      order by case when "Event_Attendee_ID" is not null then 0 else 1 end, "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by case when "Event_Attendee_ID" is not null then 0 else 1 end, "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "User_ID" is not null
    and "Event_Request_ID" is not null
),
duplicate_submissions as (
  select *
  from ranked_submissions
  where rn > 1
)
update public."AI_Screenings" ai
set "Submission_ID" = ds.keep_submission_id
from duplicate_submissions ds
where ai."Submission_ID" = ds."Submission_ID"
  and not exists (
    select 1
    from public."AI_Screenings" existing
    where existing."Submission_ID" = ds.keep_submission_id
  );
with ranked_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "User_ID", "Event_Request_ID"
      order by case when "Event_Attendee_ID" is not null then 0 else 1 end, "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by case when "Event_Attendee_ID" is not null then 0 else 1 end, "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "User_ID" is not null
    and "Event_Request_ID" is not null
),
duplicate_submissions as (
  select *
  from ranked_submissions
  where rn > 1
),
kept_details as (
  select distinct on (hsd."Submission_ID")
    hsd."Submission_ID",
    hsd."Submission_Detail_ID"
  from public."Hair_Submission_Details" hsd
  join duplicate_submissions ds
    on ds.keep_submission_id = hsd."Submission_ID"
  order by hsd."Submission_ID", hsd."Created_At" desc nulls last, hsd."Submission_Detail_ID" desc
),
duplicate_details as (
  select
    hsd."Submission_Detail_ID",
    kd."Submission_Detail_ID" as keep_detail_id
  from public."Hair_Submission_Details" hsd
  join duplicate_submissions ds
    on ds."Submission_ID" = hsd."Submission_ID"
  join kept_details kd
    on kd."Submission_ID" = ds.keep_submission_id
)
update public."Hair_Submission_Images" hsi
set "Submission_Detail_ID" = duplicate_details.keep_detail_id
from duplicate_details
where hsi."Submission_Detail_ID" = duplicate_details."Submission_Detail_ID";
with ranked_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "User_ID", "Event_Request_ID"
      order by case when "Event_Attendee_ID" is not null then 0 else 1 end, "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by case when "Event_Attendee_ID" is not null then 0 else 1 end, "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "User_ID" is not null
    and "Event_Request_ID" is not null
),
duplicate_submissions as (
  select *
  from ranked_submissions
  where rn > 1
),
movable_details as (
  select distinct on (ds.keep_submission_id)
    hsd."Submission_Detail_ID",
    ds.keep_submission_id
  from public."Hair_Submission_Details" hsd
  join duplicate_submissions ds
    on ds."Submission_ID" = hsd."Submission_ID"
  where not exists (
    select 1
    from public."Hair_Submission_Details" existing
    where existing."Submission_ID" = ds.keep_submission_id
  )
  order by ds.keep_submission_id, hsd."Created_At" desc nulls last, hsd."Submission_Detail_ID" desc
)
update public."Hair_Submission_Details" hsd
set "Submission_ID" = movable_details.keep_submission_id,
    "Updated_At" = timezone('Asia/Manila', now())
from movable_details
where hsd."Submission_Detail_ID" = movable_details."Submission_Detail_ID";
with ranked_submissions as (
  select
    "Submission_ID",
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by case when "Event_Attendee_ID" is not null then 0 else 1 end, "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "User_ID" is not null
    and "Event_Request_ID" is not null
)
delete from public."AI_Screenings" ai
using ranked_submissions rs
where ai."Submission_ID" = rs."Submission_ID"
  and rs.rn > 1;
with ranked_submissions as (
  select
    "Submission_ID",
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by case when "Event_Attendee_ID" is not null then 0 else 1 end, "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "User_ID" is not null
    and "Event_Request_ID" is not null
)
delete from public."Hair_Submission_Details" hsd
using ranked_submissions rs
where hsd."Submission_ID" = rs."Submission_ID"
  and rs.rn > 1;
with ranked_submissions as (
  select
    "Submission_ID",
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by case when "Event_Attendee_ID" is not null then 0 else 1 end, "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "User_ID" is not null
    and "Event_Request_ID" is not null
)
delete from public."Hair_Submission_Logistics" hsl
using ranked_submissions rs
where hsl."Submission_ID" = rs."Submission_ID"
  and rs.rn > 1;
with ranked_submissions as (
  select
    "Submission_ID",
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by case when "Event_Attendee_ID" is not null then 0 else 1 end, "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "User_ID" is not null
    and "Event_Request_ID" is not null
)
delete from public."Donation_Certificates" dc
using ranked_submissions rs
where dc."Submission_ID" = rs."Submission_ID"
  and rs.rn > 1;
with ranked_submissions as (
  select
    "Submission_ID",
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by case when "Event_Attendee_ID" is not null then 0 else 1 end, "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "User_ID" is not null
    and "Event_Request_ID" is not null
)
delete from public."Hair_Submissions" hs
using ranked_submissions rs
where hs."Submission_ID" = rs."Submission_ID"
  and rs.rn > 1;
with ranked_details as (
  select
    "Submission_Detail_ID",
    first_value("Submission_Detail_ID") over (
      partition by "Submission_ID"
      order by "Created_At" desc nulls last, "Submission_Detail_ID" desc
    ) as keep_detail_id,
    row_number() over (
      partition by "Submission_ID"
      order by "Created_At" desc nulls last, "Submission_Detail_ID" desc
    ) as rn
  from public."Hair_Submission_Details"
),
duplicate_details as (
  select *
  from ranked_details
  where rn > 1
)
update public."Hair_Submission_Images" hsi
set "Submission_Detail_ID" = dd.keep_detail_id
from duplicate_details dd
where hsi."Submission_Detail_ID" = dd."Submission_Detail_ID";
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
create unique index if not exists uq_event_attendees_user_event_request
on public."Event_Attendees" ("User_ID", "Event_Request_ID");
create unique index if not exists uq_hair_submissions_user_event_request_full
on public."Hair_Submissions" ("User_ID", "Event_Request_ID");
create unique index if not exists uq_hair_submissions_event_attendee
on public."Hair_Submissions" ("Event_Attendee_ID")
where "Event_Attendee_ID" is not null;
create unique index if not exists uq_hair_submission_details_submission
on public."Hair_Submission_Details" ("Submission_ID");
create unique index if not exists uq_ai_screenings_submission
on public."AI_Screenings" ("Submission_ID");
