-- Prevent duplicate event registration-linked hair submissions.
-- Safe cleanup first (only removes duplicate rows that are still pending and have no child records),
-- then enforce stronger guardrails.

-- 1) Backfill missing Event_Request_ID from Event_Attendees when Event_Attendee_ID is present.
update public."Hair_Submissions" hs
set "Event_Request_ID" = ea."Event_Request_ID"
from public."Event_Attendees" ea
where hs."Event_Attendee_ID" = ea."Event_Attendee_ID"
  and hs."Event_Attendee_ID" is not null
  and hs."Event_Request_ID" is null;
-- 2) Remove safe duplicates by User_ID + Event_Request_ID
--    (keep newest row, remove only pending rows without child records).
with ranked as (
  select
    hs."Submission_ID",
    hs."User_ID",
    hs."Event_Request_ID",
    row_number() over (
      partition by hs."User_ID", hs."Event_Request_ID"
      order by hs."Updated_At" desc nulls last, hs."Created_At" desc nulls last, hs."Submission_ID" desc
    ) as rn
  from public."Hair_Submissions" hs
  where hs."Event_Request_ID" is not null
),
safe_dupes as (
  select r."Submission_ID"
  from ranked r
  join public."Hair_Submissions" hs on hs."Submission_ID" = r."Submission_ID"
  where r.rn > 1
    and normalize_flow_key(coalesce(hs."Status", '')) = 'pending'
    and not exists (
      select 1 from public."Hair_Submission_Details" hsd where hsd."Submission_ID" = hs."Submission_ID"
    )
    and not exists (
      select 1 from public."Hair_Submission_Logistics" hsl where hsl."Submission_ID" = hs."Submission_ID"
    )
    and not exists (
      select 1 from public."AI_Screenings" ai where ai."Submission_ID" = hs."Submission_ID"
    )
    and not exists (
      select 1 from public."Donor_Recommendations" dr where dr."Submission_ID" = hs."Submission_ID"
    )
)
delete from public."Hair_Submissions" hs
using safe_dupes d
where hs."Submission_ID" = d."Submission_ID";
-- 3) Remove safe duplicates by Event_Attendee_ID
with ranked as (
  select
    hs."Submission_ID",
    hs."Event_Attendee_ID",
    row_number() over (
      partition by hs."Event_Attendee_ID"
      order by hs."Updated_At" desc nulls last, hs."Created_At" desc nulls last, hs."Submission_ID" desc
    ) as rn
  from public."Hair_Submissions" hs
  where hs."Event_Attendee_ID" is not null
),
safe_dupes as (
  select r."Submission_ID"
  from ranked r
  join public."Hair_Submissions" hs on hs."Submission_ID" = r."Submission_ID"
  where r.rn > 1
    and normalize_flow_key(coalesce(hs."Status", '')) = 'pending'
    and not exists (
      select 1 from public."Hair_Submission_Details" hsd where hsd."Submission_ID" = hs."Submission_ID"
    )
    and not exists (
      select 1 from public."Hair_Submission_Logistics" hsl where hsl."Submission_ID" = hs."Submission_ID"
    )
    and not exists (
      select 1 from public."AI_Screenings" ai where ai."Submission_ID" = hs."Submission_ID"
    )
    and not exists (
      select 1 from public."Donor_Recommendations" dr where dr."Submission_ID" = hs."Submission_ID"
    )
)
delete from public."Hair_Submissions" hs
using safe_dupes d
where hs."Submission_ID" = d."Submission_ID";
-- 4) Enforce singleton constraints.
create unique index if not exists uq_event_attendees_user_event_request
on public."Event_Attendees" ("User_ID", "Event_Request_ID");
create unique index if not exists uq_hair_submissions_user_event_request
on public."Hair_Submissions" ("User_ID", "Event_Request_ID")
where "Event_Request_ID" is not null;
create unique index if not exists uq_hair_submissions_event_attendee
on public."Hair_Submissions" ("Event_Attendee_ID")
where "Event_Attendee_ID" is not null;
-- 5) Prevent event-linked rows without event keys.
alter table public."Hair_Submissions"
drop constraint if exists hair_submissions_event_link_required_check;
alter table public."Hair_Submissions"
add constraint hair_submissions_event_link_required_check
check (
  coalesce("From_Event", false) = false
  or "Event_Request_ID" is not null
  or "Event_Attendee_ID" is not null
);
