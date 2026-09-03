begin;

-- Donation eligibility always uses the donor's newest completed screening.
-- AI_Screenings has no separate completion timestamp/status in the current
-- schema, so a non-empty Decision is the persisted completion signal.
create or replace function public.guard_hair_submission_eligible_screening()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new."AI_Screening_ID" is null then
    raise exception 'An eligible AI screening is required before starting a hair donation.';
  end if;

  if not exists (
    select 1
    from public."AI_Screenings" ai
    where ai."AI_Screening_ID" = new."AI_Screening_ID"
      and ai."User_ID" = new."User_ID"
      and public.normalize_flow_key(coalesce(ai."Decision", '')) in (
        'eligible', 'eligiblefordonation', 'eligibleforhairdonation', 'passed'
      )
      and ai."AI_Screening_ID" = (
        select latest_ai."AI_Screening_ID"
        from public."AI_Screenings" latest_ai
        where latest_ai."User_ID" = new."User_ID"
          and nullif(btrim(coalesce(latest_ai."Decision", '')), '') is not null
        order by latest_ai."Created_At" desc nulls last,
                 latest_ai."AI_Screening_ID" desc
        limit 1
      )
  ) then
    raise exception 'The donor''s latest completed AI screening must be eligible before starting a donation.';
  end if;

  return new;
end;
$$;

-- Treat null, pending, completed, and other non-cancelled donation statuses as
-- consuming their screening. A new screening is required after donated hair
-- has been cut; only a cancelled donation releases its screening.
do $$
declare
  duplicate_screening_ids text;
begin
  select string_agg(duplicate_row."AI_Screening_ID"::text, ', ')
  into duplicate_screening_ids
  from (
    select "AI_Screening_ID"
    from public."Hair_Submissions"
    where "AI_Screening_ID" is not null
      and public.normalize_flow_key(coalesce("Status", '')) not in ('cancelled', 'canceled')
    group by "AI_Screening_ID"
    having count(*) > 1
  ) duplicate_row;

  if duplicate_screening_ids is not null then
    raise exception 'AI screenings are attached to multiple non-cancelled donations: %. Resolve those records before rerunning this migration.', duplicate_screening_ids;
  end if;
end;
$$;

drop index if exists public.uq_hair_submissions_active_ai_screening;
create unique index uq_hair_submissions_active_ai_screening
on public."Hair_Submissions" ("AI_Screening_ID")
where "AI_Screening_ID" is not null
  and public.normalize_flow_key(coalesce("Status", '')) not in ('cancelled', 'canceled');

-- Logistics audit fields. Compatibility scheduling columns are retained for
-- this migration, but are deprecated below after their application reads and
-- writes have been removed.
alter table public."Hair_Submission_Logistics"
add column if not exists "Updated_By" integer,
add column if not exists "Updated_At" timestamp without time zone
  default timezone('Asia/Manila', now());

alter table public."Hair_Submission_Logistics"
drop constraint if exists hair_submission_logistics_updated_by_fkey;

alter table public."Hair_Submission_Logistics"
add constraint hair_submission_logistics_updated_by_fkey
foreign key ("Updated_By")
references public.users (user_id)
on delete set null;

alter table public."Hair_Submission_Logistics"
alter column "Created_At" set default timezone('Asia/Manila', now()),
alter column "Updated_At" set default timezone('Asia/Manila', now());

update public."Hair_Submission_Logistics"
set "Updated_At" = coalesce("Updated_At", "Created_At", timezone('Asia/Manila', now()));

-- Preserve legacy pickup dates by promoting them to the timestamp field. A
-- date-only record represents the start of that local Manila date until the
-- donor/staff supplies a more precise pickup time.
update public."Hair_Submission_Logistics"
set "Pickup_Scheduled_At" =
      ("Pickup_Schedule_Date"::timestamp at time zone 'Asia/Manila')
where "Pickup_Scheduled_At" is null
  and "Pickup_Schedule_Date" is not null
  and public.normalize_flow_key(coalesce("Logistics_Type", '')) in (
    'pickup', 'courier', 'shipping', 'independentshipping'
  );

-- Normalize every logistics type emitted by released application versions.
update public."Hair_Submission_Logistics"
set "Logistics_Type" = case
  when public.normalize_flow_key(coalesce("Logistics_Type", '')) in (
    'courier', 'shipping', 'independentshipping'
  ) then 'Courier'
  when public.normalize_flow_key(coalesce("Logistics_Type", '')) in (
    'pickup', 'pickuprequest'
  ) then 'Pickup'
  when public.normalize_flow_key(coalesce("Logistics_Type", '')) in (
    'salondropoff', 'onsitedelivery', 'walkin', 'dropoff'
  ) then 'Salon Dropoff'
  when nullif(btrim(coalesce("Logistics_Type", '')), '') is null
       and exists (
         select 1
         from public."Salon_Donation_Appointments" appointment
         where appointment."Hair_Submission_ID" = "Hair_Submission_Logistics"."Submission_ID"
       ) then 'Salon Dropoff'
  when nullif(btrim(coalesce("Logistics_Type", '')), '') is null
       and ("Pickup_Scheduled_At" is not null or "Pickup_Approved_At" is not null)
    then 'Pickup'
  when nullif(btrim(coalesce("Logistics_Type", '')), '') is null
    then 'Courier'
  else "Logistics_Type"
end;

update public."Hair_Submission_Logistics"
set "Shipment_Status" = case
      when "Shipment_Status" in ('Received', 'Cancelled') then "Shipment_Status"
      else null
    end,
    "Courier_Name" = null,
    "Tracking_Number" = null,
    "Pickup_Scheduled_At" = null,
    "Pickup_Approved_At" = null
where "Logistics_Type" = 'Salon Dropoff';

-- Abort safely instead of guessing when production contains an unknown type.
do $$
declare
  unsupported_types text;
begin
  select string_agg(distinct quote_literal("Logistics_Type"), ', ')
  into unsupported_types
  from public."Hair_Submission_Logistics"
  where "Logistics_Type" not in ('Courier', 'Pickup', 'Salon Dropoff');

  if unsupported_types is not null then
    raise exception 'Unsupported Hair_Submission_Logistics.Logistics_Type values: %. Normalize these values before rerunning this migration.', unsupported_types;
  end if;
end;
$$;

alter table public."Hair_Submission_Logistics"
alter column "Logistics_Type" set not null;

alter table public."Hair_Submission_Logistics"
drop constraint if exists hair_submission_logistics_type_check;

alter table public."Hair_Submission_Logistics"
add constraint hair_submission_logistics_type_check
check ("Logistics_Type" in ('Courier', 'Pickup', 'Salon Dropoff'));

-- Salon booking is now represented only by Salon_Donation_Appointments.
drop trigger if exists trg_assign_walkin_dropoff_queue_number
on public."Hair_Submission_Logistics";
drop function if exists public.assign_walkin_dropoff_queue_number();

comment on column public."Hair_Submission_Logistics"."Pickup_Schedule_Date"
is 'DEPRECATED compatibility field. Use Pickup_Scheduled_At for Courier/Pickup; use Salon_Donation_Appointments for salon visits.';
comment on column public."Hair_Submission_Logistics"."Queue_Number"
is 'DEPRECATED. Salon appointment capacity and arrival state are managed by Salon_Donation_Appointments.';
comment on column public."Hair_Submission_Logistics"."Dropoff_Window"
is 'DEPRECATED. Appointment_Start_At and Appointment_End_At are the salon schedule source of truth.';
comment on column public."Hair_Submission_Logistics"."Dropoff_Status"
is 'DEPRECATED. Salon_Donation_Appointments.Status is the appointment lifecycle source of truth.';

comment on column public."Salon_Donation_Appointments"."Hair_Details"
is 'Compatibility snapshot only. Hair_Submission_Details is the source of truth for donated hair details.';
comment on column public."Salon_Donation_Appointments"."Screening_Answers"
is 'Compatibility snapshot only. AI_Screenings is the source of truth for AI screening history.';

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

  new."Logistics_Type" := case
    when public.normalize_flow_key(coalesce(new."Logistics_Type", '')) in (
      'courier', 'shipping', 'independentshipping'
    ) then 'Courier'
    when public.normalize_flow_key(coalesce(new."Logistics_Type", '')) in (
      'pickup', 'pickuprequest'
    ) then 'Pickup'
    when public.normalize_flow_key(coalesce(new."Logistics_Type", '')) in (
      'salondropoff', 'onsitedelivery', 'walkin', 'dropoff'
    ) then 'Salon Dropoff'
    else new."Logistics_Type"
  end;

  if new."Logistics_Type" is null
     or new."Logistics_Type" not in ('Courier', 'Pickup', 'Salon Dropoff') then
    raise exception 'Logistics_Type must be Courier, Pickup, or Salon Dropoff.';
  end if;

  if tg_op = 'UPDATE'
     and old."Logistics_Type" = 'Salon Dropoff'
     and new."Logistics_Type" <> 'Salon Dropoff'
     and exists (
       select 1
       from public."Salon_Donation_Appointments" appointment
       where appointment."Hair_Submission_ID" = new."Submission_ID"
         and appointment."Status" in ('Confirmed', 'Rescheduled', 'Checked In')
     ) then
    raise exception 'Cancel or complete the active salon appointment before changing the logistics type.';
  end if;

  if new."Logistics_Type" = 'Salon Dropoff' then
    new."Pickup_Scheduled_At" := null;
    new."Pickup_Approved_At" := null;
    if new."Shipment_Status" not in ('Received', 'Cancelled') then
      new."Shipment_Status" := null;
    end if;
  end if;

  if new."Logistics_Type" <> 'Courier' then
    new."Courier_Name" := null;
    new."Tracking_Number" := null;
  end if;

  new."Updated_At" := timezone('Asia/Manila', now());
  if new."Updated_By" is null then
    new."Updated_By" := public.current_app_user_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_independent_hair_submission_logistics
on public."Hair_Submission_Logistics";

create trigger trg_guard_independent_hair_submission_logistics
before insert or update
on public."Hair_Submission_Logistics"
for each row
execute function public.guard_independent_hair_submission_logistics();

-- Each donation keeps one appointment row and reschedules that same row.
do $$
begin
  if exists (
    select 1
    from public."Salon_Operating_Hours"
    group by "Day_Group"
    having count(*) > 1
  ) then
    raise exception 'Duplicate Salon_Operating_Hours rows exist for a Day_Group. Consolidate them before rerunning this migration.';
  end if;

  if exists (
    select 1
    from public."Salon_Schedule_Overrides"
    group by "Override_Date"
    having count(*) > 1
  ) then
    raise exception 'Duplicate Salon_Schedule_Overrides rows exist for an Override_Date. Consolidate them before rerunning this migration.';
  end if;

  if exists (
    select 1
    from public."Salon_Donation_Appointments"
    where "Hair_Submission_ID" is not null
    group by "Hair_Submission_ID"
    having count(*) > 1
  ) then
    raise exception 'Duplicate salon appointments exist for a Hair_Submission_ID. Consolidate them before rerunning this migration.';
  end if;
end;
$$;

create unique index if not exists uq_salon_operating_hours_day_group
on public."Salon_Operating_Hours" ("Day_Group");

create unique index if not exists uq_salon_schedule_overrides_date
on public."Salon_Schedule_Overrides" ("Override_Date");

create unique index if not exists uq_salon_donation_appointments_submission
on public."Salon_Donation_Appointments" ("Hair_Submission_ID")
where "Hair_Submission_ID" is not null;

create index if not exists idx_salon_donation_appointments_active_slot
on public."Salon_Donation_Appointments" ("Appointment_Start_At", "Status")
where "Status" in ('Confirmed', 'Rescheduled', 'Checked In');

alter table public."Salon_Donation_Appointments"
drop constraint if exists salon_donation_appointments_submission_required_check;

-- NOT VALID preserves any legacy unlinked rows while rejecting new ones.
alter table public."Salon_Donation_Appointments"
add constraint salon_donation_appointments_submission_required_check
check ("Hair_Submission_ID" is not null) not valid;

create or replace function public.guard_salon_donation_appointment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  regular_hours public."Salon_Operating_Hours"%rowtype;
  schedule_override public."Salon_Schedule_Overrides"%rowtype;
  has_override boolean := false;
  opening_time time;
  closing_time time;
  break_start time;
  break_end time;
  duration_minutes integer;
  capacity_per_slot integer;
  minimum_notice_days integer;
  maximum_booking_days integer;
  appointment_date date;
  appointment_start_time time;
  appointment_end_time time;
  booked_count integer;
begin
  if not exists (
    select 1
    from public."Hair_Submissions" submission
    join public."Hair_Submission_Logistics" logistics
      on logistics."Submission_ID" = submission."Submission_ID"
    where submission."Submission_ID" = new."Hair_Submission_ID"
      and submission."User_ID" = new."User_ID"
      and submission."From_Event" = false
      and logistics."Logistics_Type" = 'Salon Dropoff'
  ) then
    raise exception 'Salon appointments require the donor''s existing independent Salon Dropoff donation.';
  end if;

  if new."Appointment_End_At" <= new."Appointment_Start_At" then
    raise exception 'Appointment end time must be later than its start time.';
  end if;

  -- Validate availability only for a new booking or an actual reschedule.
  if tg_op = 'INSERT'
     or old."Appointment_Start_At" is distinct from new."Appointment_Start_At"
     or old."Appointment_End_At" is distinct from new."Appointment_End_At" then
    appointment_date := new."Appointment_Start_At"::date;
    appointment_start_time := new."Appointment_Start_At"::time;
    appointment_end_time := new."Appointment_End_At"::time;

    select hours.*
    into regular_hours
    from public."Salon_Operating_Hours" hours
    where hours."Day_Group" = case
      when extract(isodow from appointment_date) in (6, 7) then 'Weekend'
      else 'Weekday'
    end
    limit 1;

    if not found then
      raise exception 'Salon operating hours are not configured for the selected date.';
    end if;

    select override_row.*
    into schedule_override
    from public."Salon_Schedule_Overrides" override_row
    where override_row."Override_Date" = appointment_date
    order by override_row."Updated_At" desc, override_row."Schedule_Override_ID" desc
    limit 1;
    has_override := found;

    if has_override and schedule_override."Is_Closed" then
      raise exception 'The salon is closed on the selected date.';
    end if;
    if not has_override and not regular_hours."Is_Open" then
      raise exception 'The salon is closed on the selected date.';
    end if;

    opening_time := case when has_override
      then coalesce(schedule_override."Opening_Time", regular_hours."Opening_Time")
      else regular_hours."Opening_Time" end;
    closing_time := case when has_override
      then coalesce(schedule_override."Closing_Time", regular_hours."Closing_Time")
      else regular_hours."Closing_Time" end;
    break_start := case when has_override
      then coalesce(schedule_override."Break_Start_Time", regular_hours."Break_Start_Time")
      else regular_hours."Break_Start_Time" end;
    break_end := case when has_override
      then coalesce(schedule_override."Break_End_Time", regular_hours."Break_End_Time")
      else regular_hours."Break_End_Time" end;
    duration_minutes := regular_hours."Appointment_Duration_Minutes";
    capacity_per_slot := case when has_override
      then coalesce(schedule_override."Capacity_Per_Slot", regular_hours."Capacity_Per_Slot")
      else regular_hours."Capacity_Per_Slot" end;
    minimum_notice_days := coalesce(regular_hours."Minimum_Booking_Notice_Days", 0);
    maximum_booking_days := regular_hours."Maximum_Booking_Days";

    if opening_time is null
       or closing_time is null
       or opening_time >= closing_time
       or duration_minutes is null
       or duration_minutes <= 0
       or capacity_per_slot is null
       or capacity_per_slot <= 0 then
      raise exception 'Salon availability is incomplete for the selected date.';
    end if;

    if appointment_date < timezone('Asia/Manila', now())::date + minimum_notice_days
       or (maximum_booking_days is not null
           and appointment_date > timezone('Asia/Manila', now())::date + maximum_booking_days) then
      raise exception 'The selected date is outside the allowed booking window.';
    end if;

    if appointment_start_time < opening_time
       or appointment_end_time > closing_time
       or new."Appointment_End_At" <> new."Appointment_Start_At" + make_interval(mins => duration_minutes)
       or mod(
         floor(extract(epoch from (appointment_start_time - opening_time)) / 60)::integer,
         duration_minutes + coalesce(regular_hours."Buffer_Minutes", 0)
       ) <> 0 then
      raise exception 'The selected appointment does not match an available salon slot.';
    end if;

    if break_start is not null and break_end is not null
       and appointment_start_time < break_end
       and appointment_end_time > break_start then
      raise exception 'The selected appointment overlaps the salon break.';
    end if;

    -- Serialize bookings for this exact slot so concurrent requests cannot
    -- both consume its last remaining place.
    perform pg_advisory_xact_lock(
      hashtextextended('salon-donation-slot:' || new."Appointment_Start_At"::text, 0)
    );

    select count(*)
    into booked_count
    from public."Salon_Donation_Appointments" appointment
    where appointment."Appointment_Start_At" = new."Appointment_Start_At"
      and appointment."Status" in ('Confirmed', 'Rescheduled', 'Checked In')
      and appointment."Appointment_ID" is distinct from new."Appointment_ID";

    if booked_count >= capacity_per_slot then
      raise exception 'The selected salon appointment slot is already full.';
    end if;
  end if;

  if public.normalize_flow_key(new."Status") = 'checkedin'
     and new."Checked_In_At" is null then
    new."Checked_In_At" := timezone('Asia/Manila', now());
  elsif public.normalize_flow_key(new."Status") = 'completed'
     and new."Completed_At" is null then
    new."Completed_At" := timezone('Asia/Manila', now());
  elsif public.normalize_flow_key(new."Status") = 'cancelled'
     and new."Cancelled_At" is null then
    new."Cancelled_At" := timezone('Asia/Manila', now());
  end if;

  new."Updated_At" := timezone('Asia/Manila', now());
  return new;
end;
$$;

drop trigger if exists trg_guard_salon_donation_appointment
on public."Salon_Donation_Appointments";

create trigger trg_guard_salon_donation_appointment
before insert or update
on public."Salon_Donation_Appointments"
for each row
execute function public.guard_salon_donation_appointment();

-- Preserve appointment status and schedule changes exactly once.
create or replace function public.record_salon_appointment_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public."Salon_Appointment_Status_History" (
      "Appointment_ID", "From_Status", "To_Status", "Change_Type",
      "New_Start_At", "Changed_By", "Changed_At"
    ) values (
      new."Appointment_ID", null, new."Status", 'Created',
      new."Appointment_Start_At", public.current_app_user_id(),
      timezone('Asia/Manila', now())
    );
  elsif old."Status" is distinct from new."Status"
     or old."Appointment_Start_At" is distinct from new."Appointment_Start_At"
     or old."Appointment_End_At" is distinct from new."Appointment_End_At" then
    insert into public."Salon_Appointment_Status_History" (
      "Appointment_ID", "From_Status", "To_Status", "Change_Type",
      "Old_Start_At", "New_Start_At", "Changed_By", "Changed_At"
    ) values (
      new."Appointment_ID", old."Status", new."Status",
      case
        when old."Appointment_Start_At" is distinct from new."Appointment_Start_At"
          or old."Appointment_End_At" is distinct from new."Appointment_End_At"
        then 'Rescheduled'
        else 'Status Change'
      end,
      old."Appointment_Start_At", new."Appointment_Start_At",
      public.current_app_user_id(), timezone('Asia/Manila', now())
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_salon_appointment_history
on public."Salon_Donation_Appointments";

create trigger trg_salon_appointment_history
after insert or update of "Status", "Appointment_Start_At", "Appointment_End_At"
on public."Salon_Donation_Appointments"
for each row
execute function public.record_salon_appointment_history();

create or replace function public.receive_salon_dropoff_after_completion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_user_id integer;
begin
  if public.normalize_flow_key(new."Status") = 'completed'
     and (tg_op = 'INSERT' or old."Status" is distinct from new."Status") then
    actor_user_id := public.current_app_user_id();

    update public."Hair_Submission_Logistics"
    set "Shipment_Status" = 'Received',
        "Received_By" = coalesce(actor_user_id, "Received_By"),
        "Received_At" = coalesce("Received_At", new."Completed_At", timezone('Asia/Manila', now())),
        "Updated_By" = coalesce(actor_user_id, "Updated_By"),
        "Updated_At" = timezone('Asia/Manila', now())
    where "Submission_ID" = new."Hair_Submission_ID"
      and "Logistics_Type" = 'Salon Dropoff';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_receive_salon_dropoff_after_completion
on public."Salon_Donation_Appointments";

create trigger trg_receive_salon_dropoff_after_completion
after insert or update of "Status"
on public."Salon_Donation_Appointments"
for each row
execute function public.receive_salon_dropoff_after_completion();

comment on table public."Salon_Donation_Appointments"
is 'Source of truth for salon drop-off appointment dates, times, and appointment lifecycle.';

commit;
