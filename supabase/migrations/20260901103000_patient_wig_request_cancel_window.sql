-- Patients may cancel only during the first seven days and before wig
-- preparation begins. Staff policies remain unchanged.

drop policy if exists "patients_cancel_own_pending_wig_requests" on public."Wig_Requests";

create policy "patients_cancel_own_pending_wig_requests"
on public."Wig_Requests"
for update
using (
  "Request_Date" is not null
  and "Request_Date" >= now() - interval '7 days'
  and lower(trim(coalesce("Status", 'pending'))) not in (
    'accepted',
    'accepted - wig allocated',
    'accepted - no wig available',
    'approved',
    'preparing',
    'preparing wig',
    'production',
    'wig in production',
    'in production',
    'to be release',
    'releasing',
    'released',
    'ready for claiming',
    'claimed',
    'completed',
    'rejected',
    'cancelled',
    'canceled',
    'closed'
  )
  and exists (
    select 1
    from public."Patients" p
    where p."Patient_ID" = "Wig_Requests"."Patient_ID"
      and p."User_ID" = public.current_app_user_id()
  )
)
with check (
  lower(trim(coalesce("Status", ''))) = 'cancelled'
  and exists (
    select 1
    from public."Patients" p
    where p."Patient_ID" = "Wig_Requests"."Patient_ID"
      and p."User_ID" = public.current_app_user_id()
  )
);
