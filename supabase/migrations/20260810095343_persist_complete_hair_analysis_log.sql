alter table public."AI_Screenings"
  add column if not exists "Length_Assessment" text null,
  add column if not exists "Donation_Readiness_Note" text null,
  add column if not exists "History_Assessment" text null;

comment on column public."AI_Screenings"."Length_Assessment"
  is 'Saved AI explanation of the detected hair length for history replay.';

comment on column public."AI_Screenings"."Donation_Readiness_Note"
  is 'Saved AI donation-readiness explanation shown with the original result.';

comment on column public."AI_Screenings"."History_Assessment"
  is 'Saved comparison or questionnaire guidance shown with the original result.';
