-- Fixes: record "old" has no field "Input_Method"
--
-- Cause: the Hair_Submission_Details update trigger still reads
-- OLD."Input_Method", but that column is not present in the current table.
-- AI origin is derived from the linked AI_Screenings row instead.

begin;

create or replace function public.capture_hair_ai_review_baseline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_request_id integer;
  v_is_ai_source boolean := false;
begin
  if exists (
    select 1
    from public."Hair_AI_Review_Comparisons" c
    where c."Submission_Detail_ID" = old."Submission_Detail_ID"
  ) then
    return new;
  end if;

  select hs."Event_Request_ID"
  into v_event_request_id
  from public."Hair_Submissions" hs
  where hs."Submission_ID" = old."Submission_ID";

  select exists (
    select 1
    from public."AI_Screenings" ai
    where ai."Submission_ID" = old."Submission_ID"
  )
  into v_is_ai_source;

  insert into public."Hair_AI_Review_Comparisons" (
    "Submission_Detail_ID",
    "Submission_ID",
    "Event_Request_ID",
    "AI_Values",
    "Is_AI_Source"
  ) values (
    old."Submission_Detail_ID",
    old."Submission_ID",
    v_event_request_id,
    pg_catalog.jsonb_build_object(
      'length', old."Declared_Length",
      'color', old."Declared_Color",
      'texture', old."Declared_Texture",
      'density', old."Declared_Density",
      'condition', old."Declared_Condition",
      'chemicallyTreated', coalesce(old."Is_Chemically_Treated", false),
      'colored', coalesce(old."Is_Colored", false),
      'bleached', coalesce(old."Is_Bleached", false),
      'rebonded', coalesce(old."Is_Rebonded", false)
    ),
    v_is_ai_source
  )
  on conflict ("Submission_Detail_ID") do nothing;

  return new;
end;
$$;

-- Trigger functions should only be executed by their owning trigger.
revoke execute on function public.capture_hair_ai_review_baseline()
from public, anon, authenticated;

commit;

-- Verification: should return false after the fix.
select
  pg_get_functiondef('public.capture_hair_ai_review_baseline()'::regprocedure)
    ilike '%old."Input_Method"%' as still_references_missing_input_method;
