alter table public.exercises
  drop constraint if exists exercises_created_by_fkey,
  add constraint exercises_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.program_assignments
  drop constraint if exists program_assignments_assigned_by_fkey,
  add constraint program_assignments_assigned_by_fkey
    foreign key (assigned_by) references public.profiles(id) on delete set null;
