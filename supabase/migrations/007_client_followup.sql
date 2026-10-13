create table public.coach_client_notes (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.coach_client_notes enable row level security;

create policy "coaches manage private client notes" on public.coach_client_notes for all
using (
  coach_id = auth.uid()
  and exists(select 1 from public.coach_clients where coach_id = auth.uid() and client_id = coach_client_notes.client_id)
)
with check (
  coach_id = auth.uid()
  and exists(select 1 from public.coach_clients where coach_id = auth.uid() and client_id = coach_client_notes.client_id)
);

create or replace function public.end_coaching(target_client uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.coach_clients
  set status = 'inactive'
  where coach_id = auth.uid() and client_id = target_client;

  if not found then
    raise exception 'Relation coach-client introuvable';
  end if;

  update public.program_assignments pa
  set active = false
  where pa.client_id = target_client
    and pa.assigned_by = auth.uid();

  if not exists (
    select 1 from public.coach_clients
    where client_id = target_client and status = 'active'
  ) then
    update public.profiles set role = 'solo' where id = target_client;
  end if;
end;
$$;

revoke all on function public.end_coaching(uuid) from public;
grant execute on function public.end_coaching(uuid) to authenticated;
