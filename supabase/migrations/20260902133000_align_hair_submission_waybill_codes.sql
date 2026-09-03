begin;

-- Match Event_Attendees.Waybill_Code: "WB" followed by six uppercase
-- alphanumeric characters (for example, WBGU2ACX).
alter table public."Hair_Submissions"
add column if not exists "Waybill_Code" varchar(8);

create or replace function public.generate_unique_hair_submission_waybill_code()
returns varchar
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  candidate varchar(8);
  character_index integer;
  attempt integer;
begin
  for attempt in 1..100 loop
    candidate := 'WB';

    for character_index in 1..6 loop
      candidate := candidate || substr(
        alphabet,
        floor(random() * length(alphabet))::integer + 1,
        1
      );
    end loop;

    if not exists (
      select 1
      from public."Hair_Submissions" hs
      where upper(hs."Waybill_Code") = candidate
    )
    and not exists (
      select 1
      from public."Event_Attendees" ea
      where upper(ea."Waybill_Code") = candidate
    ) then
      return candidate;
    end if;
  end loop;

  raise exception 'Unable to generate a unique hair-submission waybill code.';
end;
$$;

create or replace function public.assign_hair_submission_waybill_code()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(new."From_Event", false) = false then
    if new."Waybill_Code" is null
      or btrim(new."Waybill_Code") !~ '^WB[A-Z0-9]{6}$' then
      new."Waybill_Code" := public.generate_unique_hair_submission_waybill_code();
    else
      new."Waybill_Code" := upper(btrim(new."Waybill_Code"));
    end if;
  else
    -- Event submissions continue using Event_Attendees.Waybill_Code.
    new."Waybill_Code" := null;
  end if;

  return new;
end;
$$;

-- Remove the previous WB-HS-{Submission_ID} trigger/function if that SQL was
-- already applied through the Supabase SQL Editor.
drop trigger if exists trg_generate_hair_submission_waybill
on public."Hair_Submissions";

drop function if exists public.generate_hair_submission_waybill();

-- Event-linked submissions use the event-attendee waybill, not a second code.
update public."Hair_Submissions"
set "Waybill_Code" = null
where coalesce("From_Event", false) = true
  and "Waybill_Code" is not null;

-- Replace missing and legacy WB-HS-* values one row at a time so every
-- independent submission receives a collision-checked code.
do $$
declare
  submission_record record;
begin
  for submission_record in
    select "Submission_ID"
    from public."Hair_Submissions"
    where coalesce("From_Event", false) = false
      and (
        "Waybill_Code" is null
        or btrim("Waybill_Code") !~ '^WB[A-Z0-9]{6}$'
      )
    order by "Submission_ID"
    for update
  loop
    update public."Hair_Submissions"
    set "Waybill_Code" = public.generate_unique_hair_submission_waybill_code()
    where "Submission_ID" = submission_record."Submission_ID";
  end loop;
end;
$$;

-- Some databases received the later donation-mode guard through a manual SQL
-- Editor run before this migration was added to history. Both known triggers
-- reference Waybill_Code and must be removed while PostgreSQL changes its
-- type. They are restored below in the same transaction.
drop trigger if exists trg_guard_hair_submission_donation_mode
on public."Hair_Submissions";

drop trigger if exists trg_assign_hair_submission_waybill_code
on public."Hair_Submissions";

alter table public."Hair_Submissions"
alter column "Waybill_Code" type varchar(8)
using nullif(upper(btrim("Waybill_Code")), '');

create unique index if not exists uq_hair_submissions_waybill_code
on public."Hair_Submissions" ("Waybill_Code")
where "Waybill_Code" is not null;

alter table public."Hair_Submissions"
drop constraint if exists hair_submissions_waybill_required_check;

alter table public."Hair_Submissions"
add constraint hair_submissions_waybill_required_check
check (
  (
    coalesce("From_Event", false) = false
    and "Waybill_Code" ~ '^WB[A-Z0-9]{6}$'
  )
  or
  (
    coalesce("From_Event", false) = true
    and "Waybill_Code" is null
  )
);

drop trigger if exists trg_assign_hair_submission_waybill_code
on public."Hair_Submissions";

create trigger trg_assign_hair_submission_waybill_code
before insert or update of "From_Event", "Waybill_Code"
on public."Hair_Submissions"
for each row
execute function public.assign_hair_submission_waybill_code();

-- Preserve an already-installed donation-mode guard if the function came
-- from a prior manual run. Migration 20260903143000 will replace this trigger
-- and function with the canonical version later in the ordered push.
do $$
begin
  if to_regprocedure('public.guard_hair_submission_donation_mode()') is not null then
    execute $trigger$
      create trigger trg_guard_hair_submission_donation_mode
      before insert or update of "From_Event", "Event_Request_ID", "Event_Attendee_ID", "Waybill_Code"
      on public."Hair_Submissions"
      for each row
      execute function public.guard_hair_submission_donation_mode()
    $trigger$;
  end if;
end;
$$;

comment on column public."Hair_Submissions"."Waybill_Code"
is 'Independent-submission waybill formatted as WB plus six uppercase alphanumeric characters.';

revoke all on function public.generate_unique_hair_submission_waybill_code() from public;
revoke all on function public.assign_hair_submission_waybill_code() from public;

commit;
