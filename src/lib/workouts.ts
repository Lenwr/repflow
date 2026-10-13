import type { SupabaseClient } from "@supabase/supabase-js";
import type { Workout } from "../types";

type ExerciseRow = {
  id: string;
  name: string;
  muscle_group: string | null;
  instructions: string | null;
  media_url: string | null;
  source_url: string | null;
};
type WorkoutExerciseRow = {
  id: string;
  position: number;
  sets: number;
  reps: string;
  target_load: number | null;
  rest_seconds: number;
  coach_note: string | null;
  workout_blocks: {
    block_key: string;
    block_type: "EMOM" | "AMRAP" | "Tabata" | "Intervalles" | "Circuit";
    duration_seconds: number | null;
    work_seconds: number | null;
    rest_seconds: number;
    rounds: number;
  } | null;
  exercises: ExerciseRow | null;
};
type WorkoutRow = {
  id: string;
  title: string;
  estimated_minutes: number | null;
  position: number;
  workout_exercises: WorkoutExerciseRow[];
};
type ProgramRow = {
  id: string;
  title: string;
  created_at: string;
  workouts: WorkoutRow[];
};

export type WorkoutListItem = {
  programId: string;
  createdAt: string;
  workout: Workout;
};

export async function loadWorkouts(
  client: SupabaseClient,
): Promise<WorkoutListItem[]> {
  const { data, error } = await client
    .from("programs")
    .select(
      `id,title,created_at,workouts(id,title,estimated_minutes,position,workout_exercises(id,position,sets,reps,target_load,rest_seconds,coach_note,workout_blocks(block_key,block_type,duration_seconds,work_seconds,rest_seconds,rounds),exercises(id,name,muscle_group,instructions,media_url,source_url)))`,
    )
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  return ((data ?? []) as unknown as ProgramRow[]).flatMap((program) =>
    [...(program.workouts ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((row) => {
        const exercises = [...(row.workout_exercises ?? [])]
          .sort((a, b) => a.position - b.position)
          .map((line) => {
            const [method, ...noteParts] = line.coach_note?.split(" — ") ?? [];
            return {
              id: line.id,
              name: line.exercises?.name ?? "Exercice",
              sets: line.sets,
              reps: line.reps,
              load: line.target_load == null ? undefined : `${line.target_load} kg`,
              rest: line.rest_seconds,
              muscle: line.exercises?.muscle_group ?? "Non renseigné",
              done: 0,
              imageUrl: line.exercises?.media_url ?? undefined,
              instructions: line.exercises?.instructions?.split("\n").filter(Boolean),
              sourceUrl: line.exercises?.source_url ?? undefined,
              method: method || undefined,
              notes: noteParts.join(" — ") || undefined,
              blockKey: line.workout_blocks?.block_key,
              blockType: line.workout_blocks?.block_type,
              blockDuration: line.workout_blocks?.duration_seconds ?? undefined,
              workSeconds: line.workout_blocks?.work_seconds ?? undefined,
              blockRest: line.workout_blocks?.rest_seconds,
              blockRounds: line.workout_blocks?.rounds,
            };
          });
        return {
          programId: program.id,
          createdAt: program.created_at,
          workout: {
            id: row.id,
            title: row.title,
            subtitle: program.title,
            duration: row.estimated_minutes ?? 45,
            status: "next" as const,
            day: "À faire",
            exercises,
          },
        };
      }),
  );
}

export async function loadNextWorkout(
  client: SupabaseClient,
): Promise<Workout | null> {
  return (await loadWorkouts(client))[0]?.workout ?? null;
}

export async function saveCompletedWorkout(
  client: SupabaseClient,
  userId: string,
  workout: Workout,
  effort: string | null,
) {
  const completedAt = new Date().toISOString();
  const { data: log, error } = await client
    .from("workout_logs")
    .insert({
      workout_id: workout.id,
      user_id: userId,
      status: "completed",
      effort,
      started_at: completedAt,
      completed_at: completedAt,
    })
    .select("id")
    .single();
  if (error) throw error;
  const sets = workout.exercises.flatMap((exercise) =>
    Array.from({ length: exercise.done }, (_, index) => {
      const actual = exercise.performed?.[index];
      return {
        workout_log_id: log.id,
        workout_exercise_id: exercise.id,
        set_number: index + 1,
        reps: Number.parseInt(actual?.reps ?? exercise.reps, 10) || null,
        load: Number.parseFloat(actual?.load ?? exercise.load ?? "") || null,
        completed: true,
      };
    }),
  );
  if (sets.length) {
    const { error: setError } = await client.from("set_logs").insert(sets);
    if (setError) throw setError;
  }
  return log.id as string;
}
