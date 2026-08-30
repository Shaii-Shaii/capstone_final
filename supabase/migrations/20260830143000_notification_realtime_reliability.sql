create index if not exists "idx_notification_user_updated"
  on public."Notification" ("User_ID", "Updated_At" desc);

create index if not exists "idx_push_notification_tokens_device_active"
  on public."Push_Notification_Tokens" ("User_ID", "Device_ID", "Is_Active");

-- Keep filtered update/delete events useful to clients and ensure the table is
-- included in Realtime even when a project was created with selective tables.
alter table public."Notification" replica identity full;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'Notification'
  ) then
    alter publication supabase_realtime add table public."Notification";
  end if;
end
$$;
