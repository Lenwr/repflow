create table public.workout_blocks (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts(id) on delete cascade,
  block_key text not null,
  title text not null,
  block_type text not null check (block_type in ('EMOM','AMRAP','Tabata','Intervalles','Circuit')),
  position int not null default 0,
  duration_seconds int,
  work_seconds int,
  rest_seconds int not null default 0,
  rounds int not null default 1,
  unique(workout_id, block_key)
);

alter table public.workout_exercises
  add column block_id uuid references public.workout_blocks(id) on delete set null;

alter table public.workout_blocks enable row level security;

create policy "owners manage workout blocks" on public.workout_blocks for all
using (
  exists(select 1 from public.workouts w where w.id = workout_id and public.owns_program(w.program_id))
)
with check (
  exists(select 1 from public.workouts w where w.id = workout_id and public.owns_program(w.program_id))
);

create policy "clients read assigned workout blocks" on public.workout_blocks for select
using (
  exists(select 1 from public.workouts w where w.id = workout_id and public.is_program_assigned(w.program_id))
);
