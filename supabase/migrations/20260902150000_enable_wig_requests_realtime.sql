-- Keep patient request timelines synchronized when staff update Wig_Requests.
do $$
begin
  alter publication supabase_realtime add table public."Wig_Requests";
exception
  when duplicate_object then
    null;
end;
$$;
