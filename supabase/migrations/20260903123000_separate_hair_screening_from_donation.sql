begin;

-- AI screenings belong directly to donors. A donation may later reference the
-- screening that allowed the donor to begin, but the screening does not need a
-- donation submission of its own.
alter table public."AI_Screenings"
add column if not exists "User_ID" integer;

update public."AI_Screenings" ai
set "User_ID" = hs."User_ID"
from public."Hair_Submissions" hs
where hs."Submission_ID" = ai."Submission_ID"
  and ai."User_ID" is null;

do $$
begin
  if exists (select 1 from public."AI_Screenings" where "User_ID" is null) then
    raise exception 'AI_Screenings contains rows that cannot be linked to a user.';
  end if;
end;
$$;

alter table public."AI_Screenings"
alter column "User_ID" set not null,
alter column "Submission_ID" drop not null;

alter table public."AI_Screenings"
drop constraint if exists ai_screenings_user_id_fkey;

alter table public."AI_Screenings"
add constraint ai_screenings_user_id_fkey
foreign key ("User_ID") references public.users(user_id) on delete cascade;

drop index if exists public.uq_ai_screenings_submission;

create unique index uq_ai_screenings_submission
on public."AI_Screenings" ("Submission_ID")
where "Submission_ID" is not null;

create index if not exists idx_ai_screenings_user_created
on public."AI_Screenings" ("User_ID", "Created_At" desc);

drop index if exists public.idx_ai_screenings_scalp_tracking;
create index idx_ai_screenings_scalp_tracking
on public."AI_Screenings" ("User_ID", "Created_At" desc)
where "Bald_Spots_Present" = true
   or public.normalize_flow_key(coalesce("Visible_Scalp_Area", '')) in ('moderate', 'high')
   or public.normalize_flow_key(coalesce("Shedding_Level", '')) in ('moderate', 'severe')
   or "Hair_Density_Score" < 45;

alter table public."Hair_Submissions"
add column if not exists "AI_Screening_ID" integer;

update public."Hair_Submissions" hs
set "AI_Screening_ID" = (
  select ai."AI_Screening_ID"
  from public."AI_Screenings" ai
  where ai."Submission_ID" = hs."Submission_ID"
  order by ai."Created_At" desc nulls last, ai."AI_Screening_ID" desc
  limit 1
)
where hs."AI_Screening_ID" is null
  and exists (
    select 1
    from public."AI_Screenings" ai
    where ai."Submission_ID" = hs."Submission_ID"
  );

alter table public."Hair_Submissions"
drop constraint if exists hair_submissions_ai_screening_fkey;

alter table public."Hair_Submissions"
add constraint hair_submissions_ai_screening_fkey
foreign key ("AI_Screening_ID")
references public."AI_Screenings" ("AI_Screening_ID")
on delete set null;

create index if not exists idx_hair_submissions_ai_screening_id
on public."Hair_Submissions" ("AI_Screening_ID");

create unique index if not exists uq_hair_submissions_active_ai_screening
on public."Hair_Submissions" ("AI_Screening_ID")
where "AI_Screening_ID" is not null
  and "Status" <> 'Cancelled';

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
        order by latest_ai."Created_At" desc nulls last,
                 latest_ai."AI_Screening_ID" desc
        limit 1
      )
  ) then
    raise exception 'The donor''s latest AI screening must be eligible before starting a donation.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_hair_submission_eligible_screening
on public."Hair_Submissions";

create trigger trg_guard_hair_submission_eligible_screening
before insert or update of "AI_Screening_ID", "User_ID"
on public."Hair_Submissions"
for each row
execute function public.guard_hair_submission_eligible_screening();

-- RSVP is intent only. Remove the old trigger that created a submission,
-- detail, and duplicate screening as soon as an attendee registered.
drop trigger if exists trg_ensure_event_donation_records_after_rsvp
on public."Event_Attendees";

drop function if exists public.ensure_event_donation_records_after_rsvp();

create or replace function public.start_event_hair_donation_after_check_in()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  eligible_screening_id integer;
  latest_screening_decision text;
  existing_submission_id integer;
begin
  if new."User_ID" is null
     or new."Event_Request_ID" is null
     or new."RSVP_Scanned_At" is null
     or public.normalize_flow_key(coalesce(new."Registration_Status", '')) <> 'registered'
     or public.normalize_flow_key(coalesce(new."Attendance_Status", '')) <> 'present'
     or public.normalize_flow_key(coalesce(new."Attendee_Type", 'Donor')) <> 'donor' then
    return new;
  end if;

  select ai."AI_Screening_ID", ai."Decision"
  into eligible_screening_id, latest_screening_decision
  from public."AI_Screenings" ai
  where ai."User_ID" = new."User_ID"
  order by ai."Created_At" desc nulls last, ai."AI_Screening_ID" desc
  limit 1;

  if eligible_screening_id is null
     or public.normalize_flow_key(coalesce(latest_screening_decision, '')) not in (
       'eligible', 'eligiblefordonation', 'eligibleforhairdonation', 'passed'
     ) then
    raise exception 'This donor''s latest AI hair screening must be eligible before event donation check-in.';
  end if;

  select hs."Submission_ID"
  into existing_submission_id
  from public."Hair_Submissions" hs
  where hs."Event_Attendee_ID" = new."Event_Attendee_ID"
  order by hs."Created_At" desc nulls last, hs."Submission_ID" desc
  limit 1;

  if existing_submission_id is null then
    insert into public."Hair_Submissions" (
      "User_ID",
      "AI_Screening_ID",
      "Event_Request_ID",
      "Event_Attendee_ID",
      "From_Event",
      "Status"
    ) values (
      new."User_ID",
      eligible_screening_id,
      new."Event_Request_ID",
      new."Event_Attendee_ID",
      true,
      'Pending'
    );
  else
    update public."Hair_Submissions"
    set "AI_Screening_ID" = eligible_screening_id,
        "User_ID" = new."User_ID",
        "Event_Request_ID" = new."Event_Request_ID",
        "From_Event" = true,
        "Status" = case
          when public.normalize_flow_key(coalesce("Status", '')) = 'cancelled' then 'Pending'
          else "Status"
        end,
        "Updated_At" = now()
    where "Submission_ID" = existing_submission_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_start_event_hair_donation_after_check_in
on public."Event_Attendees";
drop trigger if exists trg_00_start_event_hair_donation_after_check_in
on public."Event_Attendees";

-- The prefix makes this run before other AFTER check-in triggers that may
-- issue certificates or tracking events for the newly created submission.
create trigger trg_00_start_event_hair_donation_after_check_in
after insert or update of "RSVP_Scanned_At", "Attendance_Status"
on public."Event_Attendees"
for each row
execute function public.start_event_hair_donation_after_check_in();

-- Starting logistics creates a Pending/Draft transaction. It must not be
-- treated as already cut merely because it is not linked to an event.
drop trigger if exists trg_normalize_non_event_submission_as_cut
on public."Hair_Submissions";

-- Inventory admission is now driven by an Approved detail below. The legacy
-- parent-status trigger could run while the detail was still Pending.
drop trigger if exists trg_sync_cut_hair_inventory_lifecycle
on public."Hair_Submissions";

-- The review baseline now reads the original linked AI screening. It never
-- copies screening values into Hair_Submission_Details.
create or replace function public.capture_hair_ai_review_baseline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_submission record;
  linked_screening record;
begin
  if exists (
    select 1
    from public."Hair_AI_Review_Comparisons" c
    where c."Submission_Detail_ID" = old."Submission_Detail_ID"
  ) then
    return new;
  end if;

  select hs."Event_Request_ID", hs."AI_Screening_ID"
  into linked_submission
  from public."Hair_Submissions" hs
  where hs."Submission_ID" = old."Submission_ID";

  if linked_submission."AI_Screening_ID" is null then
    return new;
  end if;

  select ai.*
  into linked_screening
  from public."AI_Screenings" ai
  where ai."AI_Screening_ID" = linked_submission."AI_Screening_ID";

  if not found then
    return new;
  end if;

  insert into public."Hair_AI_Review_Comparisons" (
    "Submission_Detail_ID",
    "Submission_ID",
    "Event_Request_ID",
    "AI_Values",
    "Is_AI_Source"
  ) values (
    old."Submission_Detail_ID",
    old."Submission_ID",
    linked_submission."Event_Request_ID",
    coalesce(linked_screening."Analysis_Result", '{}'::jsonb)
      || pg_catalog.jsonb_build_object(
        'estimated_length', linked_screening."Estimated_Length",
        'detected_color', linked_screening."Detected_Color",
        'detected_texture', linked_screening."Detected_Texture",
        'detected_density', linked_screening."Detected_Density",
        'detected_condition', linked_screening."Detected_Condition",
        'decision', linked_screening."Decision"
      ),
    true
  )
  on conflict ("Submission_Detail_ID") do nothing;

  return new;
end;
$$;

-- Ensure the inventory synchronizer is never invoked for a pending detail.
-- Deletions still invoke it so existing inventory can be cleaned up.
do $$
declare
  trigger_row record;
begin
  if to_regprocedure('public.sync_cut_hair_inventory_from_detail()') is null then
    return;
  end if;

  for trigger_row in
    select trigger_info.tgname
    from pg_catalog.pg_trigger trigger_info
    join pg_catalog.pg_proc function_info on function_info.oid = trigger_info.tgfoid
    join pg_catalog.pg_class table_info on table_info.oid = trigger_info.tgrelid
    join pg_catalog.pg_namespace schema_info on schema_info.oid = table_info.relnamespace
    where not trigger_info.tgisinternal
      and schema_info.nspname = 'public'
      and table_info.relname = 'Hair_Submission_Details'
      and function_info.proname = 'sync_cut_hair_inventory_from_detail'
  loop
    execute format(
      'drop trigger if exists %I on public."Hair_Submission_Details"',
      trigger_row.tgname
    );
  end loop;

  execute $trigger$
    create trigger trg_sync_verified_cut_hair_inventory_from_detail
    after insert or update of
      "Status", "Declared_Length", "Declared_Color", "Declared_Texture",
      "Declared_Density", "Declared_Condition", "Is_Chemically_Treated",
      "Is_Colored", "Is_Bleached", "Is_Rebonded"
    on public."Hair_Submission_Details"
    for each row
    when (public.normalize_flow_key(coalesce(new."Status", '')) = 'approved')
    execute function public.sync_cut_hair_inventory_from_detail()
  $trigger$;

  execute $trigger$
    create trigger trg_remove_cut_hair_inventory_after_detail_delete
    after delete on public."Hair_Submission_Details"
    for each row
    execute function public.sync_cut_hair_inventory_from_detail()
  $trigger$;
end;
$$;

drop policy if exists "donors_read_own_ai_screenings" on public."AI_Screenings";
create policy "donors_read_own_ai_screenings"
on public."AI_Screenings"
for select
using ("User_ID" = public.current_app_user_id() or public.current_app_user_is_staff());

drop policy if exists "donors_insert_own_ai_screenings" on public."AI_Screenings";
create policy "donors_insert_own_ai_screenings"
on public."AI_Screenings"
for insert
with check ("User_ID" = public.current_app_user_id());

drop policy if exists "donors_update_own_ai_screenings" on public."AI_Screenings";
drop policy if exists "staff_update_ai_screenings" on public."AI_Screenings";
create policy "staff_update_ai_screenings"
on public."AI_Screenings"
for update
using (public.current_app_user_is_staff())
with check (public.current_app_user_is_staff());

revoke all on function public.guard_hair_submission_eligible_screening() from public;
revoke all on function public.start_event_hair_donation_after_check_in() from public;
revoke all on function public.capture_hair_ai_review_baseline() from public;

commit;
