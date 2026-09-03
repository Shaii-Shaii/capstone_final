alter table public."AI_Screenings"
  add column if not exists "Analysis_Result" jsonb not null default '{}'::jsonb;
comment on column public."AI_Screenings"."Analysis_Result"
  is 'Complete normalized AI hair-analysis snapshot used to replay the original result in the donor hair log.';
update public."AI_Screenings"
set "Analysis_Result" = jsonb_strip_nulls(jsonb_build_object(
  'estimated_length', "Estimated_Length",
  'detected_color', "Detected_Color",
  'detected_texture', "Detected_Texture",
  'detected_density', "Detected_Density",
  'detected_condition', "Detected_Condition",
  'visible_damage_notes', "Visible_Damage_Notes",
  'confidence_score', "Confidence_Score",
  'shine_level', "Shine_Level",
  'frizz_level', "Frizz_Level",
  'dryness_level', "Dryness_Level",
  'oiliness_level', "Oiliness_Level",
  'damage_level', "Damage_Level",
  'bald_spots_present', "Bald_Spots_Present",
  'affected_regions', "Affected_Regions",
  'hair_density_score', "Hair_Density_Score",
  'shedding_level', "Shedding_Level",
  'visible_scalp_area', "Visible_Scalp_Area",
  'scalp_coverage_notes', "Scalp_Coverage_Notes",
  'dandruff_detected', "Dandruff_Detected",
  'dandruff_severity', "Dandruff_Severity",
  'dandruff_notes', "Dandruff_Notes",
  'lice_detected', "Lice_Detected",
  'lice_confidence', "Lice_Confidence",
  'lice_notes', "Lice_Notes",
  'improvement_tracking_status', "Improvement_Tracking_Status",
  'improvement_recommendation', "Improvement_Recommendation",
  'decision', "Decision",
  'summary', "Summary",
  'length_assessment', "Length_Assessment",
  'donation_readiness_note', "Donation_Readiness_Note",
  'history_assessment', "History_Assessment"
))
where "Analysis_Result" = '{}'::jsonb;
