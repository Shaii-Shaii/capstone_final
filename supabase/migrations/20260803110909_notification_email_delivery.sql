alter table public."Notification"
  add column if not exists "Email_Status" text not null default 'Pending',
  add column if not exists "Email_Sent_At" timestamptz,
  add column if not exists "Email_Response" jsonb;
