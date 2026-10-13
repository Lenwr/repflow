create type public.app_role as enum ('solo', 'client', 'coach');
create type public.workout_status as enum ('planned', 'in_progress', 'completed', 'skipped');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role public.app_role not null default 'solo',
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.coach_clients (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique(coach_id, client_id)
);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  muscle_group text,
  equipment text,
  instructions text,
  media_url text,
  media_license text,
  source_url text,
  created_by uuid references public.profiles(id)
);

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  duration_weeks int,
  created_at timestamptz not null default now()
);

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  title text not null,
  position int not null default 0,
  estimated_minutes int
);

create table public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id),
  position int not null,
  sets int not null,
  reps text not null,
  target_load numeric,
  rest_seconds int not null default 90,
  coach_note text
);

create table public.program_assignments (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id),
  starts_on date not null default current_date,
  active boolean not null default true
);

create table public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status public.workout_status not null default 'planned',
  effort text check (effort in ('Facile', 'Bien', 'Difficile')),
  pain_note text,
  started_at timestamptz,
  completed_at timestamptz
);

create table public.set_logs (
  id uuid primary key default gen_random_uuid(),
  workout_log_id uuid not null references public.workout_logs(id) on delete cascade,
  workout_exercise_id uuid not null references public.workout_exercises(id),
  set_number int not null,
  reps int,
  load numeric,
  completed boolean not null default false
);

alter table public.profiles enable row level security;
alter table public.coach_clients enable row level security;
alter table public.exercises enable row level security;
alter table public.programs enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.program_assignments enable row level security;
alter table public.workout_logs enable row level security;
alter table public.set_logs enable row level security;

create policy "profiles visible to self and linked coaches" on public.profiles for select using (
  id = auth.uid() or exists(select 1 from public.coach_clients cc where cc.coach_id = auth.uid() and cc.client_id = profiles.id)
);
create policy "users update own profile" on public.profiles for update using (id = auth.uid());
create policy "exercise library readable" on public.exercises for select to authenticated using (true);
create policy "coaches manage own exercises" on public.exercises for all using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "owners manage programs" on public.programs for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "clients read assigned programs" on public.programs for select using (exists(select 1 from public.program_assignments pa where pa.program_id = programs.id and pa.client_id = auth.uid()));
create policy "users manage own logs" on public.workout_logs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "coaches read client logs" on public.workout_logs for select using (exists(select 1 from public.coach_clients cc where cc.coach_id = auth.uid() and cc.client_id = workout_logs.user_id));

-- Les politiques des tables enfants seront complétées avec des fonctions
-- security-definer testées avant la mise en production.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data ->> 'role')::public.app_role, 'solo')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create policy "linked users read relationships" on public.coach_clients for select
using (coach_id = auth.uid() or client_id = auth.uid());
create policy "coaches create relationships" on public.coach_clients for insert
with check (coach_id = auth.uid());
create policy "coaches manage relationships" on public.coach_clients for update
using (coach_id = auth.uid());

create policy "owners manage workouts" on public.workouts for all
using (exists(select 1 from public.programs p where p.id = workouts.program_id and p.owner_id = auth.uid()));
create policy "clients read assigned workouts" on public.workouts for select
using (exists(select 1 from public.program_assignments pa where pa.program_id = workouts.program_id and pa.client_id = auth.uid()));
create policy "owners manage workout exercises" on public.workout_exercises for all
using (exists(select 1 from public.workouts w join public.programs p on p.id = w.program_id where w.id = workout_exercises.workout_id and p.owner_id = auth.uid()));
create policy "clients read assigned workout exercises" on public.workout_exercises for select
using (exists(select 1 from public.workouts w join public.program_assignments pa on pa.program_id = w.program_id where w.id = workout_exercises.workout_id and pa.client_id = auth.uid()));
create policy "owners manage assignments" on public.program_assignments for all
using (exists(select 1 from public.programs p where p.id = program_assignments.program_id and p.owner_id = auth.uid()));
create policy "clients read assignments" on public.program_assignments for select
using (client_id = auth.uid());
create policy "users manage set logs" on public.set_logs for all
using (exists(select 1 from public.workout_logs wl where wl.id = set_logs.workout_log_id and wl.user_id = auth.uid()))
with check (exists(select 1 from public.workout_logs wl where wl.id = set_logs.workout_log_id and wl.user_id = auth.uid()));
create policy "coaches read client set logs" on public.set_logs for select
using (exists(select 1 from public.workout_logs wl join public.coach_clients cc on cc.client_id = wl.user_id where wl.id = set_logs.workout_log_id and cc.coach_id = auth.uid()));
