-- Évite les références circulaires entre programs et program_assignments.
-- Ces fonctions ne retournent qu'un booléen d'autorisation et s'exécutent
-- avec les droits du propriétaire pour ne pas réévaluer les RLS imbriquées.

create or replace function public.owns_program(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.programs
    where id = target_program_id and owner_id = auth.uid()
  );
$$;

create or replace function public.is_program_assigned(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.program_assignments
    where program_id = target_program_id and client_id = auth.uid() and active
  );
$$;

revoke all on function public.owns_program(uuid) from public;
revoke all on function public.is_program_assigned(uuid) from public;
grant execute on function public.owns_program(uuid) to authenticated;
grant execute on function public.is_program_assigned(uuid) to authenticated;

drop policy if exists "clients read assigned programs" on public.programs;
drop policy if exists "owners manage workouts" on public.workouts;
drop policy if exists "clients read assigned workouts" on public.workouts;
drop policy if exists "owners manage workout exercises" on public.workout_exercises;
drop policy if exists "clients read assigned workout exercises" on public.workout_exercises;
drop policy if exists "owners manage assignments" on public.program_assignments;

create policy "clients read assigned programs" on public.programs for select
using (public.is_program_assigned(id));

create policy "owners manage workouts" on public.workouts for all
using (public.owns_program(program_id))
with check (public.owns_program(program_id));

create policy "clients read assigned workouts" on public.workouts for select
using (public.is_program_assigned(program_id));

create policy "owners manage workout exercises" on public.workout_exercises for all
using (
  exists(select 1 from public.workouts w where w.id = workout_id and public.owns_program(w.program_id))
)
with check (
  exists(select 1 from public.workouts w where w.id = workout_id and public.owns_program(w.program_id))
);

create policy "clients read assigned workout exercises" on public.workout_exercises for select
using (
  exists(select 1 from public.workouts w where w.id = workout_id and public.is_program_assigned(w.program_id))
);

create policy "owners manage assignments" on public.program_assignments for all
using (public.owns_program(program_id))
with check (public.owns_program(program_id));
