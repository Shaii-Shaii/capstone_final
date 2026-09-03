alter table public."Hair_Submission_Logistics"
  add column if not exists "Courier_Name" text,
  add column if not exists "Tracking_Number" text,
  add column if not exists "Pickup_Schedule_Date" date,
  add column if not exists "Pickup_Scheduled_At" timestamptz,
  add column if not exists "Pickup_Approved_At" timestamptz,
  add column if not exists "Queue_Number" integer,
  add column if not exists "Dropoff_Window" text,
  add column if not exists "Dropoff_Status" text default 'Scheduled';
create or replace function public.assign_walkin_dropoff_queue_number()
returns trigger
language plpgsql
as $$
begin
  if new."Logistics_Type" = 'onsite_delivery'
    and new."Pickup_Schedule_Date" is not null
    and coalesce(new."Queue_Number", 0) <= 0
  then
    select coalesce(max(hsl."Queue_Number"), 0) + 1
      into new."Queue_Number"
    from public."Hair_Submission_Logistics" hsl
    where hsl."Pickup_Schedule_Date" = new."Pickup_Schedule_Date"
      and hsl."Logistics_Type" = 'onsite_delivery'
      and hsl."Submission_Logistics_ID" is distinct from new."Submission_Logistics_ID";
  end if;

  if new."Logistics_Type" = 'onsite_delivery'
    and new."Dropoff_Status" is null
  then
    new."Dropoff_Status" := 'Scheduled';
  end if;

  return new;
end;
$$;
drop trigger if exists trg_assign_walkin_dropoff_queue_number on public."Hair_Submission_Logistics";
create trigger trg_assign_walkin_dropoff_queue_number
before insert or update of "Logistics_Type", "Pickup_Schedule_Date", "Queue_Number", "Dropoff_Status"
on public."Hair_Submission_Logistics"
for each row
execute function public.assign_walkin_dropoff_queue_number();
drop policy if exists "donors_update_own_hair_submission_logistics" on public."Hair_Submission_Logistics";
create policy "donors_update_own_hair_submission_logistics"
on public."Hair_Submission_Logistics"
for update
using (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Hair_Submissions" hs
    where hs."Submission_ID" = "Hair_Submission_Logistics"."Submission_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
)
with check (
  public.current_app_user_is_staff()
  or exists (
    select 1
    from public."Hair_Submissions" hs
    where hs."Submission_ID" = "Hair_Submission_Logistics"."Submission_ID"
      and hs."User_ID" = public.current_app_user_id()
  )
);
