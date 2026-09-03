alter table public."AI_Screenings"
  add column if not exists "Dandruff_Detected" boolean not null default false,
  add column if not exists "Dandruff_Severity" text not null default 'none',
  add column if not exists "Dandruff_Notes" text not null default 'No visible dandruff-like flakes were observed in the uploaded views.',
  add column if not exists "Lice_Detected" boolean not null default false,
  add column if not exists "Lice_Confidence" text not null default 'none',
  add column if not exists "Lice_Notes" text not null default 'No visible lice or nit-like signs were observed in the uploaded views.';
update public."AI_Screenings"
set
  "Dandruff_Severity" = coalesce(nullif(trim("Dandruff_Severity"), ''), 'none'),
  "Dandruff_Notes" = coalesce(nullif(trim("Dandruff_Notes"), ''), 'No visible dandruff-like flakes were observed in the uploaded views.'),
  "Lice_Confidence" = coalesce(nullif(trim("Lice_Confidence"), ''), 'none'),
  "Lice_Notes" = coalesce(nullif(trim("Lice_Notes"), ''), 'No visible lice or nit-like signs were observed in the uploaded views.');
