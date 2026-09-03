begin;

-- Preserve legacy recommendation rows when the old table still exists. The
-- dynamic statement keeps this migration safe when that table was removed by
-- an earlier manual SQL run.
do $$
begin
  if to_regclass('public."Donor_Recommendations"') is not null then
    execute $migration$
      with legacy_recommendations as (
        select
          "Submission_ID",
          jsonb_agg(
            jsonb_build_object(
              'title', coalesce("Title", ''),
              'recommendation_text', coalesce("Recommendation_Text", ''),
              'priority_order', coalesce("Priority_Order", 1)
            )
            order by coalesce("Priority_Order", 2147483647), "Recommendation_ID"
          ) as recommendations
        from public."Donor_Recommendations"
        where nullif(btrim(coalesce("Recommendation_Text", '')), '') is not null
        group by "Submission_ID"
      )
      update public."AI_Screenings" ai
      set "Analysis_Result" = jsonb_set(
        jsonb_set(
          coalesce(ai."Analysis_Result", '{}'::jsonb),
          '{recommendations}',
          case
            when jsonb_typeof(ai."Analysis_Result" -> 'recommendations') = 'array'
             and jsonb_array_length(ai."Analysis_Result" -> 'recommendations') > 0
              then ai."Analysis_Result" -> 'recommendations'
            when legacy.recommendations is not null
              then legacy.recommendations
            when jsonb_typeof(ai."Analysis_Result" -> 'care_tips') = 'array'
              then ai."Analysis_Result" -> 'care_tips'
            else '[]'::jsonb
          end,
          true
        ),
        '{care_tips}',
        case
          when jsonb_typeof(ai."Analysis_Result" -> 'recommendations') = 'array'
           and jsonb_array_length(ai."Analysis_Result" -> 'recommendations') > 0
            then ai."Analysis_Result" -> 'recommendations'
          when legacy.recommendations is not null
            then legacy.recommendations
          when jsonb_typeof(ai."Analysis_Result" -> 'care_tips') = 'array'
            then ai."Analysis_Result" -> 'care_tips'
          else '[]'::jsonb
        end,
        true
      )
      from legacy_recommendations legacy
      where legacy."Submission_ID" = ai."Submission_ID"
    $migration$;
  end if;
end;
$$;

-- Keep both supported JSON keys synchronized for screenings that already had
-- recommendations stored directly in Analysis_Result.
with resolved_screenings as (
  select
    "AI_Screening_ID",
    coalesce("Analysis_Result", '{}'::jsonb) as analysis_result,
    case
      when jsonb_typeof("Analysis_Result" -> 'recommendations') = 'array'
       and jsonb_array_length("Analysis_Result" -> 'recommendations') > 0
        then "Analysis_Result" -> 'recommendations'
      when jsonb_typeof("Analysis_Result" -> 'care_tips') = 'array'
        then "Analysis_Result" -> 'care_tips'
      else '[]'::jsonb
    end as recommendations
  from public."AI_Screenings"
)
update public."AI_Screenings" ai
set "Analysis_Result" = jsonb_set(
  jsonb_set(resolved.analysis_result, '{recommendations}', resolved.recommendations, true),
  '{care_tips}', resolved.recommendations, true
)
from resolved_screenings resolved
where resolved."AI_Screening_ID" = ai."AI_Screening_ID";

comment on column public."AI_Screenings"."Analysis_Result"
is 'Complete AI hair-analysis snapshot, including recommendations and care_tips arrays.';

drop table if exists public."Donor_Recommendations";

commit;