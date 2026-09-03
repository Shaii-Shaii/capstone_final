alter table public."Patients"
  add column if not exists "Medical_Document_Verification_Status" text default 'not_submitted',
  add column if not exists "Medical_Document_OCR_Text" text,
  add column if not exists "Medical_Document_Verified_At" timestamptz,
  add column if not exists "Doctor_Name" text,
  add column if not exists "Doctor_License_Number" text;
alter table public."Patients"
  drop constraint if exists "Patients_Medical_Document_Verification_Status_check";
alter table public."Patients"
  add constraint "Patients_Medical_Document_Verification_Status_check"
  check (
    "Medical_Document_Verification_Status" is null
    or "Medical_Document_Verification_Status" in (
      'not_submitted',
      'ocr_failed',
      'ocr_passed_prc_pending',
      'prc_verified',
      'rejected',
      'verified'
    )
  );
create index if not exists idx_patients_doctor_license_number
on public."Patients" ("Doctor_License_Number");
create index if not exists idx_patients_medical_document_verification_status
on public."Patients" ("Medical_Document_Verification_Status");
