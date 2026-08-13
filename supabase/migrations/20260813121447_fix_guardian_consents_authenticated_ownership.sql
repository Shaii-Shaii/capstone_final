-- guardian_consents uses the application's integer user_id, while Supabase
-- Auth identifies the current user with a UUID. Bridge those identifiers
-- through public.users so donors can only access consent rows for themselves.

alter table public.guardian_consents enable row level security;

grant select, insert, update on table public.guardian_consents to authenticated;

drop policy if exists "guardian_consents_read_own" on public.guardian_consents;
create policy "guardian_consents_read_own"
on public.guardian_consents
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.users u
    where u.user_id = guardian_consents.user_id
      and u.auth_user_id = (select auth.uid())
  )
);

drop policy if exists "guardian_consents_insert_own" on public.guardian_consents;
create policy "guardian_consents_insert_own"
on public.guardian_consents
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.users u
    where u.user_id = guardian_consents.user_id
      and u.auth_user_id = (select auth.uid())
  )
);

drop policy if exists "guardian_consents_update_own" on public.guardian_consents;
create policy "guardian_consents_update_own"
on public.guardian_consents
for update
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.users u
    where u.user_id = guardian_consents.user_id
      and u.auth_user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.users u
    where u.user_id = guardian_consents.user_id
      and u.auth_user_id = (select auth.uid())
  )
);
