-- Event donation registration policy:
-- 1. A donor RSVP creates/keeps one event attendee record.
-- 2. The event attendee must have a linked Hair_Submissions row.
-- 3. The event submission receives Hair_Submission_Details and AI_Screenings copied
--    from the donor's latest saved hair analysis.
-- 4. Staff RSVP scan marks attendance present and issues the donor certificate.

create or replace function public.current_app_user_id()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select u.user_id
  from public.users u
  where u.auth_user_id = auth.uid()
  limit 1
$$;
create or replace function public.current_app_user_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.auth_user_id = auth.uid()
      and lower(coalesce(u.role, '')) in ('admin', 'staff', 'qa_stylist', 'organization', 'super_admin')
  )
$$;
alter table public."Event_Attendees" enable row level security;
alter table public."Hair_Submissions" enable row level security;
alter table public."Hair_Submission_Details" enable row level security;
alter table public."AI_Screenings" enable row level security;
alter table public."Donation_Certificates" enable row level security;
update public."AI_Screenings"
set "Estimated_Length" = coalesce("Estimated_Length", 0),
    "Detected_Color" = coalesce(nullif(trim("Detected_Color"), ''), 'Unclear'),
    "Detected_Texture" = coalesce(nullif(trim("Detected_Texture"), ''), 'Unclear'),
    "Detected_Density" = coalesce(nullif(trim("Detected_Density"), ''), 'Unclear'),
    "Detected_Condition" = coalesce(nullif(trim("Detected_Condition"), ''), 'Low-confidence image review'),
    "Visible_Damage_Notes" = coalesce(nullif(trim("Visible_Damage_Notes"), ''), 'No visible damage notes reported.'),
    "Confidence_Score" = coalesce("Confidence_Score", 0),
    "Decision" = coalesce(nullif(trim("Decision"), ''), 'Improve hair condition'),
    "Summary" = coalesce(nullif(trim("Summary"), ''), 'Hair analysis completed with limited details. Final screening requires manual review.'),
    "Shine_Level" = coalesce("Shine_Level", 5),
    "Frizz_Level" = coalesce("Frizz_Level", 5),
    "Dryness_Level" = coalesce("Dryness_Level", 5),
    "Oiliness_Level" = coalesce("Oiliness_Level", 5),
    "Damage_Level" = coalesce("Damage_Level", 5),
    "Bald_Spots_Present" = coalesce("Bald_Spots_Present", false),
    "Affected_Regions" = case
      when "Affected_Regions" is null or cardinality("Affected_Regions") = 0 then array['none']::text[]
      else "Affected_Regions"
    end,
    "Hair_Density_Score" = coalesce("Hair_Density_Score", 50),
    "Shedding_Level" = coalesce(nullif(trim("Shedding_Level"), ''), 'not sure'),
    "Visible_Scalp_Area" = coalesce(nullif(trim("Visible_Scalp_Area"), ''), 'unclear'),
    "Scalp_Coverage_Notes" = coalesce(nullif(trim("Scalp_Coverage_Notes"), ''), 'No clear scalp coverage issue was reported.'),
    "Improvement_Tracking_Status" = coalesce(nullif(trim("Improvement_Tracking_Status"), ''), 'Needs improvement tracking'),
    "Improvement_Recommendation" = coalesce(nullif(trim("Improvement_Recommendation"), ''), 'Keep tracking hair length and condition with future CheckHair scans before donating.');
alter table public."AI_Screenings"
  alter column "Estimated_Length" set default 0,
  alter column "Detected_Color" set default 'Unclear',
  alter column "Detected_Texture" set default 'Unclear',
  alter column "Detected_Density" set default 'Unclear',
  alter column "Detected_Condition" set default 'Low-confidence image review',
  alter column "Visible_Damage_Notes" set default 'No visible damage notes reported.',
  alter column "Confidence_Score" set default 0,
  alter column "Decision" set default 'Improve hair condition',
  alter column "Summary" set default 'Hair analysis completed with limited details. Final screening requires manual review.',
  alter column "Shine_Level" set default 5,
  alter column "Frizz_Level" set default 5,
  alter column "Dryness_Level" set default 5,
  alter column "Oiliness_Level" set default 5,
  alter column "Damage_Level" set default 5,
  alter column "Bald_Spots_Present" set default false,
  alter column "Affected_Regions" set default array['none']::text[],
  alter column "Hair_Density_Score" set default 50,
  alter column "Shedding_Level" set default 'not sure',
  alter column "Visible_Scalp_Area" set default 'unclear',
  alter column "Scalp_Coverage_Notes" set default 'No clear scalp coverage issue was reported.',
  alter column "Improvement_Tracking_Status" set default 'Needs improvement tracking',
  alter column "Improvement_Recommendation" set default 'Keep tracking hair length and condition with future CheckHair scans before donating.',
  alter column "Estimated_Length" set not null,
  alter column "Detected_Color" set not null,
  alter column "Detected_Texture" set not null,
  alter column "Detected_Density" set not null,
  alter column "Detected_Condition" set not null,
  alter column "Visible_Damage_Notes" set not null,
  alter column "Confidence_Score" set not null,
  alter column "Decision" set not null,
  alter column "Summary" set not null,
  alter column "Shine_Level" set not null,
  alter column "Frizz_Level" set not null,
  alter column "Dryness_Level" set not null,
  alter column "Oiliness_Level" set not null,
  alter column "Damage_Level" set not null,
  alter column "Bald_Spots_Present" set not null,
  alter column "Affected_Regions" set not null,
  alter column "Hair_Density_Score" set not null,
  alter column "Shedding_Level" set not null,
  alter column "Visible_Scalp_Area" set not null,
  alter column "Scalp_Coverage_Notes" set not null,
  alter column "Improvement_Tracking_Status" set not null,
  alter column "Improvement_Recommendation" set not null;
with ranked_event_attendees as (
  select
    "Event_Attendee_ID",
    first_value("Event_Attendee_ID") over (
      partition by "User_ID", "Event_Request_ID"
      order by
        case when normalize_flow_key(coalesce("Registration_Status", '')) = 'registered' then 0 else 1 end,
        "Created_At" asc nulls last,
        "Event_Attendee_ID" asc
    ) as keep_event_attendee_id,
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by
        case when normalize_flow_key(coalesce("Registration_Status", '')) = 'registered' then 0 else 1 end,
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
        case when normalize_flow_key(coalesce("Registration_Status", '')) = 'registered' then 0 else 1 end,
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
with ranked_hair_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "User_ID", "Event_Request_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Request_ID" is not null
),
duplicate_hair_submissions as (
  select *
  from ranked_hair_submissions
  where rn > 1
)
update public."Hair_Bundle_Tracking_History" hbth
set "Submission_ID" = dhs.keep_submission_id
from duplicate_hair_submissions dhs
where hbth."Submission_ID" = dhs."Submission_ID";
with ranked_hair_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "User_ID", "Event_Request_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Request_ID" is not null
),
duplicate_hair_submissions as (
  select *
  from ranked_hair_submissions
  where rn > 1
)
update public."Hair_Submission_Logistics" hsl
set "Submission_ID" = dhs.keep_submission_id
from duplicate_hair_submissions dhs
where hsl."Submission_ID" = dhs."Submission_ID"
  and not exists (
    select 1
    from public."Hair_Submission_Logistics" existing
    where existing."Submission_ID" = dhs.keep_submission_id
  );
with ranked_hair_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "User_ID", "Event_Request_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Request_ID" is not null
),
duplicate_hair_submissions as (
  select *
  from ranked_hair_submissions
  where rn > 1
)
update public."Donation_Certificates" dc
set "Submission_ID" = dhs.keep_submission_id
from duplicate_hair_submissions dhs
where dc."Submission_ID" = dhs."Submission_ID"
  and not exists (
    select 1
    from public."Donation_Certificates" existing
    where existing."Submission_ID" = dhs.keep_submission_id
  );
with ranked_hair_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "User_ID", "Event_Request_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Request_ID" is not null
),
duplicate_hair_submissions as (
  select *
  from ranked_hair_submissions
  where rn > 1
)
update public."Hair_Submission_Details" hsd
set "Submission_ID" = dhs.keep_submission_id,
    "Updated_At" = timezone('Asia/Manila', now())
from duplicate_hair_submissions dhs
where hsd."Submission_ID" = dhs."Submission_ID"
  and not exists (
    select 1
    from public."Hair_Submission_Details" existing
    where existing."Submission_ID" = dhs.keep_submission_id
  );
with ranked_hair_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "User_ID", "Event_Request_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Request_ID" is not null
),
duplicate_hair_submissions as (
  select *
  from ranked_hair_submissions
  where rn > 1
)
update public."AI_Screenings" ai
set "Submission_ID" = dhs.keep_submission_id
from duplicate_hair_submissions dhs
where ai."Submission_ID" = dhs."Submission_ID"
  and not exists (
    select 1
    from public."AI_Screenings" existing
    where existing."Submission_ID" = dhs.keep_submission_id
  );
with ranked_hair_submissions as (
  select
    "Submission_ID",
    first_value("Submission_ID") over (
      partition by "User_ID", "Event_Request_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as keep_submission_id,
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Request_ID" is not null
),
duplicate_hair_submissions as (
  select *
  from ranked_hair_submissions
  where rn > 1
)
delete from public."AI_Screenings" ai
using duplicate_hair_submissions dhs
where ai."Submission_ID" = dhs."Submission_ID";
with ranked_hair_submissions as (
  select
    "Submission_ID",
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Request_ID" is not null
),
duplicate_hair_submissions as (
  select *
  from ranked_hair_submissions
  where rn > 1
)
delete from public."Hair_Submission_Logistics" hsl
using duplicate_hair_submissions dhs
where hsl."Submission_ID" = dhs."Submission_ID";
with ranked_hair_submissions as (
  select
    "Submission_ID",
    row_number() over (
      partition by "User_ID", "Event_Request_ID"
      order by "Created_At" asc nulls last, "Submission_ID" asc
    ) as rn
  from public."Hair_Submissions"
  where "Event_Request_ID" is not null
)
delete from public."Hair_Submissions" hs
using ranked_hair_submissions rhs
where hs."Submission_ID" = rhs."Submission_ID"
  and rhs.rn > 1;
with ranked_details as (
  select
    hsd."Submission_Detail_ID",
    row_number() over (
      partition by hsd."Submission_ID"
      order by hsd."Created_At" asc nulls last, hsd."Submission_Detail_ID" asc
    ) as rn
  from public."Hair_Submission_Details" hsd
  join public."Hair_Submissions" hs on hs."Submission_ID" = hsd."Submission_ID"
  where hs."Event_Request_ID" is not null
)
delete from public."Hair_Submission_Details" hsd
using ranked_details rd
where hsd."Submission_Detail_ID" = rd."Submission_Detail_ID"
  and rd.rn > 1;
with ranked_all_details as (
  select
    "Submission_Detail_ID",
    row_number() over (
      partition by "Submission_ID"
      order by "Created_At" asc nulls last, "Submission_Detail_ID" asc
    ) as rn
  from public."Hair_Submission_Details"
)
delete from public."Hair_Submission_Details" hsd
using ranked_all_details rad
where hsd."Submission_Detail_ID" = rad."Submission_Detail_ID"
  and rad.rn > 1;
with ranked_screenings as (
  select
    "AI_Screening_ID",
    row_number() over (
      partition by "Submission_ID"
      order by "Created_At" asc nulls last, "AI_Screening_ID" asc
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
create unique index if not exists uq_hair_submission_details_submission
on public."Hair_Submission_Details" ("Submission_ID");
create unique index if not exists uq_ai_screenings_submission
on public."AI_Screenings" ("Submission_ID");
drop policy if exists "donors_read_own_event_attendees" on public."Event_Attendees";
create policy "donors_read_own_event_attendees"
on public."Event_Attendees"
for select
using ("User_ID" = public.current_app_user_id() or public.current_app_user_is_staff());
drop policy if exists "donors_insert_own_event_attendees" on public."Event_Attendees";
create policy "donors_insert_own_event_attendees"
on public."Event_Attendees"
for insert
with check ("User_ID" = public.current_app_user_id());
drop policy if exists "staff_update_event_attendees_scan" on public."Event_Attendees";
create policy "staff_update_event_attendees_scan"
on public."Event_Attendees"
for update
using (public.current_app_user_is_staff())
with check (public.current_app_user_is_staff());
drop policy if exists "donors_read_own_hair_submissions" on public."Hair_Submissions";
create policy "donors_read_own_hair_submissions"
on public."Hair_Submissions"
for select
using ("User_ID" = public.current_app_user_id() or public.current_app_user_is_staff());
drop policy if exists "donors_insert_own_hair_submissions" on public."Hair_Submissions";
create policy "donors_insert_own_hair_submissions"
on public."Hair_Submissions"
for insert
with check ("User_ID" = public.current_app_user_id());
drop policy if exists "donors_update_own_hair_submissions" on public."Hair_Submissions";
create policy "donors_update_own_hair_submissions"
on public."Hair_Submissions"
for update
using ("User_ID" = public.current_app_user_id() or public.current_app_user_is_staff())
with check ("User_ID" = public.current_app_user_id() or public.current_app_user_is_staff());
drop policy if exists "donors_read_own_hair_submission_details" on public."Hair_Submission_Details";
create policy "donors_read_own_hair_submission_details"
on public."Hair_Submission_Details"
for select
using (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Hair_Submissions" hs
    where hs."Submission_ID" = "Hair_Submission_Details"."Submission_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
);
drop policy if exists "donors_insert_own_hair_submission_details" on public."Hair_Submission_Details";
create policy "donors_insert_own_hair_submission_details"
on public."Hair_Submission_Details"
for insert
with check (
  exists (
    select 1
    from public."Hair_Submissions" hs
    where hs."Submission_ID" = "Hair_Submission_Details"."Submission_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
);
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
drop policy if exists "donors_read_own_ai_screenings" on public."AI_Screenings";
create policy "donors_read_own_ai_screenings"
on public."AI_Screenings"
for select
using (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Hair_Submissions" hs
    where hs."Submission_ID" = "AI_Screenings"."Submission_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
);
drop policy if exists "donors_insert_own_ai_screenings" on public."AI_Screenings";
create policy "donors_insert_own_ai_screenings"
on public."AI_Screenings"
for insert
with check (
  exists (
    select 1
    from public."Hair_Submissions" hs
    where hs."Submission_ID" = "AI_Screenings"."Submission_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
);
drop policy if exists "donors_read_own_donation_certificates" on public."Donation_Certificates";
create policy "donors_read_own_donation_certificates"
on public."Donation_Certificates"
for select
using ("User_ID" = public.current_app_user_id() or public.current_app_user_is_staff());
drop policy if exists "staff_insert_donation_certificates" on public."Donation_Certificates";
create policy "staff_insert_donation_certificates"
on public."Donation_Certificates"
for insert
with check ("User_ID" = public.current_app_user_id() or public.current_app_user_is_staff());
create or replace function public.ensure_event_donation_records_after_rsvp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_submission_id integer;
  target_detail_id integer;
  source_detail record;
  source_screening record;
  source_detail_found boolean := false;
  source_screening_found boolean := false;
begin
  if new."User_ID" is null or new."Event_Request_ID" is null then
    return new;
  end if;

  select hs."Submission_ID"
    into target_submission_id
  from public."Hair_Submissions" hs
  where hs."User_ID" = new."User_ID"
    and hs."Event_Request_ID" = new."Event_Request_ID"
    and public.normalize_flow_key(coalesce(hs."Status", '')) <> 'cancelled'
  order by hs."Created_At" desc nulls last, hs."Submission_ID" desc
  limit 1;

  if target_submission_id is null then
    insert into public."Hair_Submissions" (
      "User_ID",
      "Event_Request_ID",
      "Event_Attendee_ID",
      "From_Event",
      "Status"
    )
    values (
      new."User_ID",
      new."Event_Request_ID",
      new."Event_Attendee_ID",
      true,
      'Pending'
    )
    on conflict ("User_ID", "Event_Request_ID")
    do update set
      "Event_Attendee_ID" = excluded."Event_Attendee_ID",
      "From_Event" = true,
      "Updated_At" = timezone('Asia/Manila', now())
    returning "Submission_ID" into target_submission_id;
  else
    update public."Hair_Submissions"
    set "Event_Attendee_ID" = new."Event_Attendee_ID",
        "From_Event" = true,
        "Updated_At" = timezone('Asia/Manila', now())
    where "Submission_ID" = target_submission_id
      and ("Event_Attendee_ID" is distinct from new."Event_Attendee_ID" or "From_Event" is distinct from true);
  end if;

  select ai.*
    into source_screening
  from public."AI_Screenings" ai
  join public."Hair_Submissions" hs on hs."Submission_ID" = ai."Submission_ID"
  where hs."User_ID" = new."User_ID"
    and hs."Submission_ID" <> target_submission_id
    and (hs."Event_Request_ID" is null or hs."Event_Request_ID" <> new."Event_Request_ID")
  order by ai."Created_At" desc nulls last, ai."AI_Screening_ID" desc
  limit 1;
  source_screening_found := found;

  if source_screening_found then
    select *
      into source_detail
    from public."Hair_Submission_Details" hsd
    where hsd."Submission_ID" = source_screening."Submission_ID"
    order by hsd."Created_At" desc nulls last, hsd."Submission_Detail_ID" desc
    limit 1;
    source_detail_found := found;
  end if;

  select "Submission_Detail_ID"
    into target_detail_id
  from public."Hair_Submission_Details"
  where "Submission_ID" = target_submission_id
  order by "Created_At" desc nulls last, "Submission_Detail_ID" desc
  limit 1;

  if source_detail_found then
    if target_detail_id is null then
      insert into public."Hair_Submission_Details" (
        "Submission_ID",
        "Declared_Length",
        "Declared_Color",
        "Declared_Texture",
        "Declared_Density",
        "Declared_Condition",
        "Is_Chemically_Treated",
        "Is_Colored",
        "Is_Bleached",
        "Is_Rebonded",
        "Detail_Notes",
        "Status"
      )
      values (
        target_submission_id,
        source_detail."Declared_Length",
        source_detail."Declared_Color",
        source_detail."Declared_Texture",
        source_detail."Declared_Density",
        source_detail."Declared_Condition",
        coalesce(source_detail."Is_Chemically_Treated", false),
        coalesce(source_detail."Is_Colored", false),
        coalesce(source_detail."Is_Bleached", false),
        coalesce(source_detail."Is_Rebonded", false),
        concat_ws(' ', source_detail."Detail_Notes", 'Copied from latest saved CheckHair analysis for event registration.'),
        'Pending'
      )
      on conflict ("Submission_ID")
      do update set
        "Declared_Length" = excluded."Declared_Length",
        "Declared_Color" = excluded."Declared_Color",
        "Declared_Texture" = excluded."Declared_Texture",
        "Declared_Density" = excluded."Declared_Density",
        "Declared_Condition" = excluded."Declared_Condition",
        "Is_Chemically_Treated" = excluded."Is_Chemically_Treated",
        "Is_Colored" = excluded."Is_Colored",
        "Is_Bleached" = excluded."Is_Bleached",
        "Is_Rebonded" = excluded."Is_Rebonded",
        "Detail_Notes" = excluded."Detail_Notes",
        "Status" = excluded."Status",
        "Updated_At" = timezone('Asia/Manila', now());
    else
      update public."Hair_Submission_Details"
      set "Declared_Length" = source_detail."Declared_Length",
          "Declared_Color" = source_detail."Declared_Color",
          "Declared_Texture" = source_detail."Declared_Texture",
          "Declared_Density" = source_detail."Declared_Density",
          "Declared_Condition" = source_detail."Declared_Condition",
          "Is_Chemically_Treated" = coalesce(source_detail."Is_Chemically_Treated", false),
          "Is_Colored" = coalesce(source_detail."Is_Colored", false),
          "Is_Bleached" = coalesce(source_detail."Is_Bleached", false),
          "Is_Rebonded" = coalesce(source_detail."Is_Rebonded", false),
          "Detail_Notes" = concat_ws(' ', source_detail."Detail_Notes", 'Copied from latest saved CheckHair analysis for event registration.'),
          "Updated_At" = timezone('Asia/Manila', now())
      where "Submission_Detail_ID" = target_detail_id;
    end if;
  elsif target_detail_id is null then
    insert into public."Hair_Submission_Details" ("Submission_ID", "Status")
    values (target_submission_id, 'Pending')
    on conflict ("Submission_ID")
    do update set
      "Status" = excluded."Status",
      "Updated_At" = timezone('Asia/Manila', now());
  end if;

  if source_screening_found
     and not exists (
       select 1
       from public."AI_Screenings" ai
       where ai."Submission_ID" = target_submission_id
     ) then
    insert into public."AI_Screenings" (
      "Submission_ID",
      "Estimated_Length",
      "Detected_Color",
      "Detected_Texture",
      "Detected_Density",
      "Detected_Condition",
      "Visible_Damage_Notes",
      "Confidence_Score",
      "Shine_Level",
      "Frizz_Level",
      "Dryness_Level",
      "Oiliness_Level",
      "Damage_Level",
      "Bald_Spots_Present",
      "Affected_Regions",
      "Hair_Density_Score",
      "Shedding_Level",
      "Visible_Scalp_Area",
      "Scalp_Coverage_Notes",
      "Improvement_Tracking_Status",
      "Improvement_Recommendation",
      "Decision",
      "Summary"
    )
    values (
      target_submission_id,
      coalesce(source_screening."Estimated_Length", 0),
      coalesce(nullif(trim(source_screening."Detected_Color"), ''), 'Unclear'),
      coalesce(nullif(trim(source_screening."Detected_Texture"), ''), 'Unclear'),
      coalesce(nullif(trim(source_screening."Detected_Density"), ''), 'Unclear'),
      coalesce(nullif(trim(source_screening."Detected_Condition"), ''), 'Low-confidence image review'),
      coalesce(nullif(trim(source_screening."Visible_Damage_Notes"), ''), 'No visible damage notes reported.'),
      coalesce(source_screening."Confidence_Score", 0),
      coalesce(source_screening."Shine_Level", 5),
      coalesce(source_screening."Frizz_Level", 5),
      coalesce(source_screening."Dryness_Level", 5),
      coalesce(source_screening."Oiliness_Level", 5),
      coalesce(source_screening."Damage_Level", 5),
      coalesce(source_screening."Bald_Spots_Present", false),
      case
        when source_screening."Affected_Regions" is null or cardinality(source_screening."Affected_Regions") = 0 then array['none']::text[]
        else source_screening."Affected_Regions"
      end,
      coalesce(source_screening."Hair_Density_Score", 50),
      coalesce(nullif(trim(source_screening."Shedding_Level"), ''), 'not sure'),
      coalesce(nullif(trim(source_screening."Visible_Scalp_Area"), ''), 'unclear'),
      coalesce(nullif(trim(source_screening."Scalp_Coverage_Notes"), ''), 'No clear scalp coverage issue was reported.'),
      coalesce(nullif(trim(source_screening."Improvement_Tracking_Status"), ''), 'Needs improvement tracking'),
      coalesce(nullif(trim(source_screening."Improvement_Recommendation"), ''), 'Keep tracking hair length and condition with future CheckHair scans before donating.'),
      coalesce(nullif(trim(source_screening."Decision"), ''), 'Improve hair condition'),
      concat_ws(' ', coalesce(nullif(trim(source_screening."Summary"), ''), 'Hair analysis completed with limited details. Final screening requires manual review.'), 'Copied into event donation registration.')
    )
    on conflict ("Submission_ID")
    do update set
      "Estimated_Length" = excluded."Estimated_Length",
      "Detected_Color" = excluded."Detected_Color",
      "Detected_Texture" = excluded."Detected_Texture",
      "Detected_Density" = excluded."Detected_Density",
      "Detected_Condition" = excluded."Detected_Condition",
      "Visible_Damage_Notes" = excluded."Visible_Damage_Notes",
      "Confidence_Score" = excluded."Confidence_Score",
      "Shine_Level" = excluded."Shine_Level",
      "Frizz_Level" = excluded."Frizz_Level",
      "Dryness_Level" = excluded."Dryness_Level",
      "Oiliness_Level" = excluded."Oiliness_Level",
      "Damage_Level" = excluded."Damage_Level",
      "Bald_Spots_Present" = excluded."Bald_Spots_Present",
      "Affected_Regions" = excluded."Affected_Regions",
      "Hair_Density_Score" = excluded."Hair_Density_Score",
      "Shedding_Level" = excluded."Shedding_Level",
      "Visible_Scalp_Area" = excluded."Visible_Scalp_Area",
      "Scalp_Coverage_Notes" = excluded."Scalp_Coverage_Notes",
      "Improvement_Tracking_Status" = excluded."Improvement_Tracking_Status",
      "Improvement_Recommendation" = excluded."Improvement_Recommendation",
      "Decision" = excluded."Decision",
      "Summary" = excluded."Summary";
  end if;

  return new;
end;
$$;
drop trigger if exists trg_ensure_event_donation_records_after_rsvp on public."Event_Attendees";
create trigger trg_ensure_event_donation_records_after_rsvp
after insert or update of "Registration_Status", "User_ID", "Event_Request_ID"
on public."Event_Attendees"
for each row
execute function public.ensure_event_donation_records_after_rsvp();
create or replace function public.issue_event_certificate_after_rsvp_scan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_submission_id integer;
  issuer_id integer;
begin
  if new."User_ID" is null
     or new."RSVP_Scanned_At" is null
     or public.normalize_flow_key(coalesce(new."Attendance_Status", '')) <> 'present' then
    return new;
  end if;

  select hs."Submission_ID"
    into target_submission_id
  from public."Hair_Submissions" hs
  where hs."User_ID" = new."User_ID"
    and hs."Event_Request_ID" = new."Event_Request_ID"
    and public.normalize_flow_key(coalesce(hs."Status", '')) <> 'cancelled'
  order by hs."Created_At" desc nulls last, hs."Submission_ID" desc
  limit 1;

  if target_submission_id is null then
    return new;
  end if;

  if exists (
    select 1
    from public."Donation_Certificates" dc
    where dc."Submission_ID" = target_submission_id
  ) then
    return new;
  end if;

  issuer_id := coalesce(new."RSVP_Scanned_By", public.current_app_user_id());

  insert into public."Donation_Certificates" (
    "User_ID",
    "Certificate_Number",
    "Certificate_Type",
    "Issued_By",
    "Issued_At",
    "Remarks",
    "Submission_ID"
  )
  values (
    new."User_ID",
    concat('DON-CERT-EVT-', target_submission_id, '-', to_char(timezone('Asia/Manila', now()), 'YYYYMMDDHH24MISS')),
    'Certificate of Donation',
    issuer_id,
    coalesce(new."RSVP_Scanned_At", timezone('Asia/Manila', now())),
    'Issued automatically after staff RSVP scan marked the donor present.',
    target_submission_id
  );

  return new;
end;
$$;
drop trigger if exists trg_issue_event_certificate_after_rsvp_scan on public."Event_Attendees";
create trigger trg_issue_event_certificate_after_rsvp_scan
after insert or update of "RSVP_Scanned_At", "Attendance_Status"
on public."Event_Attendees"
for each row
execute function public.issue_event_certificate_after_rsvp_scan();
