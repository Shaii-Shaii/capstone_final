begin;

-- Hair_Submissions is the donation record. Logistics is an optional one-to-one
-- extension used only by independent donations.
alter table public."Hair_Submission_Logistics"
add column if not exists "Courier_Name" text,
add column if not exists "Tracking_Number" text,
add column if not exists "Pickup_Schedule_Date" date,
add column if not exists "Pickup_Scheduled_At" timestamp with time zone,
add column if not exists "Pickup_Approved_At" timestamp with time zone,
add column if not exists "Queue_Number" integer,
add column if not exists "Dropoff_Window" text,
add column if not exists "Dropoff_Status" text default 'Scheduled',
add column if not exists "Updated_At" timestamp without time zone
  default timezone('Asia/Manila', now());

-- Normalize legacy donation-mode flags before enforcing the relationship.
update public."Hair_Submissions"
set "From_Event" = true,
    "Waybill_Code" = null
where "Event_Request_ID" is not null
   or "Event_Attendee_ID" is not null;

update public."Hair_Submissions"
set "From_Event" = false
where "Event_Request_ID" is null
  and "Event_Attendee_ID" is null;

-- These rows conflict with the model: event donations have no logistics child.
delete from public."Hair_Submission_Logistics" logistics
using public."Hair_Submissions" submission
where submission."Submission_ID" = logistics."Submission_ID"
  and submission."From_Event" = true;

-- Remove invalid legacy children that do not have a parent.
delete from public."Hair_Submission_Logistics" logistics
where logistics."Submission_ID" is null
   or not exists (
     select 1
     from public."Hair_Submissions" submission
     where submission."Submission_ID" = logistics."Submission_ID"
   );

-- Preserve the newest logistics snapshot when legacy code inserted more than
-- one row for the same independent donation.
with ranked_logistics as (
  select
    "Submission_Logistics_ID",
    row_number() over (
      partition by "Submission_ID"
      order by coalesce("Updated_At", "Created_At") desc nulls last,
               "Submission_Logistics_ID" desc
    ) as row_number_for_submission
  from public."Hair_Submission_Logistics"
)
delete from public."Hair_Submission_Logistics" logistics
using ranked_logistics ranked
where logistics."Submission_Logistics_ID" = ranked."Submission_Logistics_ID"
  and ranked.row_number_for_submission > 1;

alter table public."Hair_Submission_Logistics"
alter column "Submission_ID" set not null;

alter table public."Hair_Submission_Logistics"
drop constraint if exists hair_submission_logistics_submission_id_fkey;

alter table public."Hair_Submission_Logistics"
add constraint hair_submission_logistics_submission_id_fkey
foreign key ("Submission_ID")
references public."Hair_Submissions" ("Submission_ID")
on delete cascade;

drop index if exists public.idx_hair_submission_logistics_submission_id;
create unique index if not exists uq_hair_submission_logistics_submission_id
on public."Hair_Submission_Logistics" ("Submission_ID");

create or replace function public.guard_hair_submission_donation_mode()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new."From_Event" then
    if new."Event_Attendee_ID" is null then
      raise exception 'An event donation requires a checked-in event attendee.';
    end if;

    if not exists (
      select 1
      from public."Event_Attendees" attendee
      where attendee."Event_Attendee_ID" = new."Event_Attendee_ID"
        and attendee."User_ID" = new."User_ID"
        and (
          new."Event_Request_ID" is null
          or attendee."Event_Request_ID" = new."Event_Request_ID"
        )
        and attendee."RSVP_Scanned_At" is not null
        and public.normalize_flow_key(coalesce(attendee."Registration_Status", '')) = 'registered'
        and public.normalize_flow_key(coalesce(attendee."Attendance_Status", '')) = 'present'
        and public.normalize_flow_key(coalesce(attendee."Attendee_Type", 'Donor')) = 'donor'
    ) then
      raise exception 'Event donation requires the donor''s valid RSVP and completed event check-in.';
    end if;

    new."Event_Request_ID" := (
      select attendee."Event_Request_ID"
      from public."Event_Attendees" attendee
      where attendee."Event_Attendee_ID" = new."Event_Attendee_ID"
    );

    new."Waybill_Code" := null;

    if tg_op = 'UPDATE'
       and exists (
         select 1
         from public."Hair_Submission_Logistics" logistics
         where logistics."Submission_ID" = new."Submission_ID"
       ) then
      raise exception 'An event donation cannot have a hair-submission logistics record.';
    end if;
  elsif new."Event_Request_ID" is not null or new."Event_Attendee_ID" is not null then
    raise exception 'An independent donation cannot reference an event request or attendee.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_hair_submission_donation_mode
on public."Hair_Submissions";

create trigger trg_guard_hair_submission_donation_mode
before insert or update of "From_Event", "Event_Request_ID", "Event_Attendee_ID", "Waybill_Code"
on public."Hair_Submissions"
for each row
execute function public.guard_hair_submission_donation_mode();

create or replace function public.guard_independent_hair_submission_logistics()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public."Hair_Submissions" submission
    where submission."Submission_ID" = new."Submission_ID"
      and submission."From_Event" = false
  ) then
    raise exception 'Hair logistics requires an existing independent Hair_Submissions record.';
  end if;

  new."Updated_At" := timezone('Asia/Manila', now());
  return new;
end;
$$;

drop trigger if exists trg_guard_independent_hair_submission_logistics
on public."Hair_Submission_Logistics";

create trigger trg_guard_independent_hair_submission_logistics
before insert or update of "Submission_ID", "Logistics_Type", "Shipment_Status",
  "Courier_Name", "Tracking_Number", "Pickup_Schedule_Date", "Pickup_Scheduled_At",
  "Pickup_Approved_At", "Queue_Number", "Dropoff_Window", "Dropoff_Status",
  "Received_By", "Received_At", "Notes"
on public."Hair_Submission_Logistics"
for each row
execute function public.guard_independent_hair_submission_logistics();

-- The mobile client updates the one existing logistics row as delivery moves.
-- Both RLS and the trigger restrict those writes to independent donations.
drop policy if exists "donors_insert_own_hair_submission_logistics"
on public."Hair_Submission_Logistics";

create policy "donors_insert_own_hair_submission_logistics"
on public."Hair_Submission_Logistics"
for insert
to authenticated
with check (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Hair_Submissions" submission
    where submission."Submission_ID" = "Hair_Submission_Logistics"."Submission_ID"
      and submission."User_ID" = public.current_app_user_id()
      and submission."From_Event" = false
  )
);

drop policy if exists "donors_update_own_hair_submission_logistics"
on public."Hair_Submission_Logistics";

create policy "donors_update_own_hair_submission_logistics"
on public."Hair_Submission_Logistics"
for update
to authenticated
using (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Hair_Submissions" submission
    where submission."Submission_ID" = "Hair_Submission_Logistics"."Submission_ID"
      and submission."User_ID" = public.current_app_user_id()
      and submission."From_Event" = false
  )
)
with check (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Hair_Submissions" submission
    where submission."Submission_ID" = "Hair_Submission_Logistics"."Submission_ID"
      and submission."User_ID" = public.current_app_user_id()
      and submission."From_Event" = false
  )
);

-- Hair_Submissions.Status is the current overall state. Preserve every actual
-- transition in the existing history table for donor-facing timelines.
create or replace function public.record_hair_submission_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old."Status" is distinct from new."Status" then
    insert into public."Hair_Bundle_Tracking_History" (
      "Submission_ID",
      "Status",
      "Title",
      "Description",
      "Updated_At"
    ) values (
      new."Submission_ID",
      new."Status",
      'Donation status: ' || new."Status",
      'Overall donation status changed from ' || coalesce(old."Status", 'Not set') ||
        ' to ' || coalesce(new."Status", 'Not set') || '.',
      timezone('Asia/Manila', now())
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_record_hair_submission_status_transition
on public."Hair_Submissions";

create trigger trg_record_hair_submission_status_transition
after update of "Status"
on public."Hair_Submissions"
for each row
execute function public.record_hair_submission_status_transition();

comment on table public."Hair_Submission_Logistics"
is 'One-to-one logistics extension of an independent Hair_Submissions donation; never used for event donations.';

comment on column public."Hair_Submissions"."Status"
is 'Current overall donation lifecycle state. Historical transitions are stored in Hair_Bundle_Tracking_History.';

commit;
