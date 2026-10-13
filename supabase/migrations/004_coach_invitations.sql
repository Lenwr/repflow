create table public.coach_invites (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete set null
);

alter table public.coach_invites enable row level security;

create policy "coaches manage own invitations" on public.coach_invites for all
using (coach_id = auth.uid())
with check (
  coach_id = auth.uid()
  and exists(select 1 from public.profiles where id = auth.uid() and role = 'coach')
);

create or replace function public.accept_coach_invite(invite_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_invite public.coach_invites%rowtype;
begin
  select * into selected_invite
  from public.coach_invites
  where token = invite_token
    and accepted_at is null
    and expires_at > now()
  for update;

  if selected_invite.id is null then
    raise exception 'Invitation invalide ou expirée';
  end if;
  if selected_invite.coach_id = auth.uid() then
    raise exception 'Un coach ne peut pas accepter sa propre invitation';
  end if;

  insert into public.coach_clients (coach_id, client_id, status)
  values (selected_invite.coach_id, auth.uid(), 'active')
  on conflict (coach_id, client_id) do update set status = 'active';

  update public.coach_invites
  set accepted_at = now(), accepted_by = auth.uid()
  where id = selected_invite.id;

  update public.profiles set role = 'client' where id = auth.uid();
  return selected_invite.coach_id;
end;
$$;

revoke all on function public.accept_coach_invite(uuid) from public;
grant execute on function public.accept_coach_invite(uuid) to authenticated;
