-- Allow ineligible donors and observers to RSVP as voluntary event attendees.
-- Voluntary attendees are counted for attendance but do not create hair donation records.

alter table public."Event_Attendees"
add column if not exists "Attendee_Type" text not null default 'Donor';
alter table public."Event_Attendees"
drop constraint if exists "Event_Attendees_Attendee_Type_check";
alter table public."Event_Attendees"
add constraint "Event_Attendees_Attendee_Type_check"
check ("Attendee_Type" in ('Donor', 'Voluntary'));
update public."Event_Attendees"
set "Attendee_Type" = 'Donor'
where "Attendee_Type" is null
   or "Attendee_Type" not in ('Donor', 'Voluntary');
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

  if public.normalize_flow_key(coalesce(new."Attendee_Type", 'Donor')) = 'voluntary' then
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

  if source_screening_found then
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
      source_screening."Estimated_Length",
      source_screening."Detected_Color",
      source_screening."Detected_Texture",
      source_screening."Detected_Density",
      source_screening."Detected_Condition",
      source_screening."Visible_Damage_Notes",
      source_screening."Confidence_Score",
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
after insert or update of "Registration_Status", "User_ID", "Event_Request_ID", "Attendee_Type"
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
     or public.normalize_flow_key(coalesce(new."Attendance_Status", '')) <> 'present'
     or public.normalize_flow_key(coalesce(new."Attendee_Type", 'Donor')) = 'voluntary' then
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
