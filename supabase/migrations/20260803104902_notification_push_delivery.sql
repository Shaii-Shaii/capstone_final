create table if not exists public."Push_Notification_Tokens" (
  "Push_Token_ID" bigserial primary key,
  "User_ID" bigint not null references public.users(user_id) on delete cascade,
  "Expo_Push_Token" text not null,
  "Device_ID" text,
  "Platform" text,
  "Role" text,
  "Is_Active" boolean not null default true,
  "Last_Registered_At" timestamptz not null default now(),
  "Created_At" timestamptz not null default now(),
  "Updated_At" timestamptz not null default now(),
  constraint "Push_Notification_Tokens_user_token_key" unique ("User_ID", "Expo_Push_Token")
);
create index if not exists "idx_push_notification_tokens_user_active"
  on public."Push_Notification_Tokens" ("User_ID", "Is_Active");
alter table public."Push_Notification_Tokens" enable row level security;
drop policy if exists "Users can read own push tokens" on public."Push_Notification_Tokens";
create policy "Users can read own push tokens"
  on public."Push_Notification_Tokens"
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.users u
      where u.user_id = "Push_Notification_Tokens"."User_ID"
        and u.auth_user_id = (select auth.uid())
    )
  );
drop policy if exists "Users can register own push tokens" on public."Push_Notification_Tokens";
create policy "Users can register own push tokens"
  on public."Push_Notification_Tokens"
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.users u
      where u.user_id = "Push_Notification_Tokens"."User_ID"
        and u.auth_user_id = (select auth.uid())
    )
  );
drop policy if exists "Users can update own push tokens" on public."Push_Notification_Tokens";
create policy "Users can update own push tokens"
  on public."Push_Notification_Tokens"
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.users u
      where u.user_id = "Push_Notification_Tokens"."User_ID"
        and u.auth_user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.users u
      where u.user_id = "Push_Notification_Tokens"."User_ID"
        and u.auth_user_id = (select auth.uid())
    )
  );
grant select, insert, update on public."Push_Notification_Tokens" to authenticated;
grant usage, select on sequence public."Push_Notification_Tokens_Push_Token_ID_seq" to authenticated;
alter table public."Notification"
  add column if not exists "Reference_Type" text,
  add column if not exists "Reference_ID" text,
  add column if not exists "Push_Status" text not null default 'Pending',
  add column if not exists "Push_Sent_At" timestamptz,
  add column if not exists "Push_Response" jsonb;
