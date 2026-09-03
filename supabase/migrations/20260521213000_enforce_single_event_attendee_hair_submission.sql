-- Keep one hair submission and one detail for each event attendee.
-- Existing duplicates are merged into the earliest submission before the
-- Event_Attendee_ID uniqueness guard is added.

with ranked_event_attendee_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Attendee_ID" is not null
),
duplicate_event_attendee_submissions as (
  select *
  from ranked_event_attendee_submissions
  where rn > 1
)
update public."Hair_Bundle_Tracking_History" hbth
set "Submission_ID" = deas.keep_submission_id
from duplicate_event_attendee_submissions deas
where hbth."Submission_ID" = deas."Submission_ID";
with ranked_event_attendee_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Attendee_ID" is not null
),
duplicate_event_attendee_submissions as (
  select *
  from ranked_event_attendee_submissions
  where rn > 1
)
update public."Donation_Certificates" dc
set "Submission_ID" = deas.keep_submission_id
from duplicate_event_attendee_submissions deas
where dc."Submission_ID" = deas."Submission_ID"
  and not exists (
    select 1
    from public."Donation_Certificates" existing
    where existing."Submission_ID" = deas.keep_submission_id
  );
with ranked_event_attendee_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Attendee_ID" is not null
),
duplicate_event_attendee_submissions as (
  select *
  from ranked_event_attendee_submissions
  where rn > 1
)
update public."Hair_Submission_Logistics" hsl
set "Submission_ID" = deas.keep_submission_id
from duplicate_event_attendee_submissions deas
where hsl."Submission_ID" = deas."Submission_ID"
  and not exists (
    select 1
    from public."Hair_Submission_Logistics" existing
    where existing."Submission_ID" = deas.keep_submission_id
  );
with ranked_event_attendee_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Attendee_ID" is not null
),
duplicate_event_attendee_submissions as (
  select *
  from ranked_event_attendee_submissions
  where rn > 1
)
update public."AI_Screenings" ai
set "Submission_ID" = deas.keep_submission_id
from duplicate_event_attendee_submissions deas
where ai."Submission_ID" = deas."Submission_ID"
  and not exists (
    select 1
    from public."AI_Screenings" existing
    where existing."Submission_ID" = deas.keep_submission_id
  );
with ranked_event_attendee_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Attendee_ID" is not null
),
duplicate_event_attendee_submissions as (
  select *
  from ranked_event_attendee_submissions
  where rn > 1
)
update public."Donor_Recommendations" dr
set "Submission_ID" = deas.keep_submission_id
from duplicate_event_attendee_submissions deas
where dr."Submission_ID" = deas."Submission_ID";
with ranked_event_attendee_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Attendee_ID" is not null
),
duplicate_event_attendee_submissions as (
  select *
  from ranked_event_attendee_submissions
  where rn > 1
),
kept_details as (
  select distinct on (hsd."Submission_ID")
    hsd."Submission_ID",
    hsd."Submission_Detail_ID"
  from public."Hair_Submission_Details" hsd
  join duplicate_event_attendee_submissions deas
    on deas.keep_submission_id = hsd."Submission_ID"
  order by hsd."Submission_ID", hsd."Created_At" asc nulls last, hsd."Submission_Detail_ID" asc
),
duplicate_details as (
  select
    hsd."Submission_Detail_ID",
    kd."Submission_Detail_ID" as keep_detail_id
  from public."Hair_Submission_Details" hsd
  join duplicate_event_attendee_submissions deas
    on deas."Submission_ID" = hsd."Submission_ID"
  join kept_details kd
    on kd."Submission_ID" = deas.keep_submission_id
)
update public."Hair_Submission_Images" hsi
set "Submission_Detail_ID" = duplicate_details.keep_detail_id
from duplicate_details
where hsi."Submission_Detail_ID" = duplicate_details."Submission_Detail_ID";
with ranked_event_attendee_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Attendee_ID" is not null
),
duplicate_event_attendee_submissions as (
  select *
  from ranked_event_attendee_submissions
  where rn > 1
),
movable_details as (
  select distinct on (deas.keep_submission_id)
    hsd."Submission_Detail_ID",
    deas.keep_submission_id
  from public."Hair_Submission_Details" hsd
  join duplicate_event_attendee_submissions deas
    on deas."Submission_ID" = hsd."Submission_ID"
  where not exists (
    select 1
    from public."Hair_Submission_Details" existing
    where existing."Submission_ID" = deas.keep_submission_id
  )
  order by deas.keep_submission_id, hsd."Created_At" asc nulls last, hsd."Submission_Detail_ID" asc
)
update public."Hair_Submission_Details" hsd
set "Submission_ID" = movable_details.keep_submission_id,
    "Updated_At" = timezone('Asia/Manila', now())
from movable_details
where hsd."Submission_Detail_ID" = movable_details."Submission_Detail_ID";
with ranked_event_attendee_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Attendee_ID" is not null
),
duplicate_event_attendee_submissions as (
  select *
  from ranked_event_attendee_submissions
  where rn > 1
)
delete from public."AI_Screenings" ai
using duplicate_event_attendee_submissions deas
where ai."Submission_ID" = deas."Submission_ID";
with ranked_event_attendee_submissions as (
  select
    "Submission_ID",
    row_number() over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Attendee_ID" is not null
)
delete from public."Hair_Submission_Details" hsd
using ranked_event_attendee_submissions reas
where hsd."Submission_ID" = reas."Submission_ID"
  and reas.rn > 1;
with ranked_event_attendee_submissions as (
  select
    "Submission_ID",
    row_number() over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Attendee_ID" is not null
)
delete from public."Hair_Submission_Logistics" hsl
using ranked_event_attendee_submissions reas
where hsl."Submission_ID" = reas."Submission_ID"
  and reas.rn > 1;
with ranked_event_attendee_submissions as (
  select
    "Submission_ID",
    row_number() over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Attendee_ID" is not null
)
delete from public."Donation_Certificates" dc
using ranked_event_attendee_submissions reas
where dc."Submission_ID" = reas."Submission_ID"
  and reas.rn > 1;
with ranked_event_attendee_submissions as (
  select
    "Submission_ID",
    row_number() over (
      partition by "Event_Attendee_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Attendee_ID" is not null
)
delete from public."Hair_Submissions" hs
using ranked_event_attendee_submissions reas
where hs."Submission_ID" = reas."Submission_ID"
  and reas.rn > 1;
with ranked_details as (
  select
    "Submission_Detail_ID",
    row_number() over (
      partition by "Submission_ID"
      order by "Created_At" asc nulls last, "Submission_Detail_ID" asc
    ) as rn
  from public."Hair_Submission_Details"
)
delete from public."Hair_Submission_Details" hsd
using ranked_details rd
where hsd."Submission_Detail_ID" = rd."Submission_Detail_ID"
  and rd.rn > 1;
create unique index if not exists uq_hair_submissions_event_attendee
on public."Hair_Submissions" ("Event_Attendee_ID")
where "Event_Attendee_ID" is not null;
create unique index if not exists uq_hair_submission_details_submission
on public."Hair_Submission_Details" ("Submission_ID");
