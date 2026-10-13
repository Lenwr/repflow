alter table public.program_assignments
  add constraint program_assignments_program_client_unique
  unique (program_id, client_id);
