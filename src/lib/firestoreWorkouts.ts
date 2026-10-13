import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { firestore } from "./firebase";
import type { Workout } from "../types";

type FirestoreWorkout = Workout & {
  owner_id: string;
  client_ids?: string[];
  position?: number;
};

export async function loadNextFirebaseWorkout(userId: string): Promise<Workout | null> {
  const result = await getDocs(query(
    collection(firestore, "workouts"),
    where("owner_id", "==", userId),
  ));
  const row = result.docs[0]?.data() as FirestoreWorkout | undefined;
  return row ? { ...row, status: row.status ?? "next" } : null;
}

export async function loadFirebaseWorkouts(userId: string) {
  const result = await getDocs(query(
    collection(firestore, "workouts"),
    where("owner_id", "==", userId),
  ));
  return result.docs
    .map((snapshot) => {
      const data = snapshot.data() as FirestoreWorkout & { program_id?: string; created_at?: { toDate?: () => Date } };
      const createdAt = data.created_at?.toDate?.()?.toISOString() ?? new Date().toISOString();
      return {
        programId: data.program_id ?? snapshot.id,
        createdAt,
        workout: { ...data, id: snapshot.id, status: data.status ?? "planned" } as Workout,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteFirebaseWorkout(programId: string, workoutId: string) {
  await deleteDoc(doc(firestore, "workouts", workoutId));
  if (programId !== workoutId) await deleteDoc(doc(firestore, "programs", programId));
}

export async function updateFirebaseWorkoutTitle(workoutId: string, title: string) {
  await updateDoc(doc(firestore, "workouts", workoutId), { title: title.trim() });
}

export async function updateFirebaseWorkout(
  workoutId: string,
  title: string,
  exercises: unknown[],
) {
  await updateDoc(doc(firestore, "workouts", workoutId), {
    title: title.trim(),
    exercises,
    updated_at: serverTimestamp(),
  });
}

export async function loadFirebaseProgress(userId: string) {
  const [logsSnapshot, setsSnapshot, workoutsSnapshot] = await Promise.all([
    getDocs(query(collection(firestore, "workout_logs"), where("user_id", "==", userId))),
    getDocs(query(collection(firestore, "set_logs"), where("user_id", "==", userId))),
    getDocs(query(collection(firestore, "workouts"), where("owner_id", "==", userId))),
  ]);
  const titles = new Map(workoutsSnapshot.docs.map((item) => [item.id, item.data().title ?? "Séance"]));
  const setsByLog = new Map<string, { load: number | null; reps: number | null }[]>();
  setsSnapshot.docs.forEach((item) => {
    const data = item.data();
    const current = setsByLog.get(data.workout_log_id) ?? [];
    current.push({ load: data.load ?? null, reps: data.reps ?? null });
    setsByLog.set(data.workout_log_id, current);
  });
  return logsSnapshot.docs
    .map((item) => {
      const data = item.data();
      return {
        id: item.id,
        completed_at: data.completed_at ?? null,
        duration_seconds: data.duration_seconds ?? 0,
        effort: data.effort ?? null,
        workouts: { title: titles.get(data.workout_id) ?? "Séance" },
        set_logs: setsByLog.get(item.id) ?? [],
      };
    })
    .sort((a, b) => String(b.completed_at ?? "").localeCompare(String(a.completed_at ?? "")));
}

export async function saveFirebaseWorkout(
  userId: string,
  workout: Workout,
  effort: string | null,
  durationSeconds = 0,
) {
  const completedAt = new Date().toISOString();
  const log = await addDoc(collection(firestore, "workout_logs"), {
    user_id: userId,
    workout_id: workout.id,
    status: "completed",
    effort,
    started_at: completedAt,
    completed_at: completedAt,
    duration_seconds: durationSeconds,
    created_at: serverTimestamp(),
  });
  await Promise.all(workout.exercises.flatMap((exercise) =>
    Array.from({ length: exercise.done }, (_, index) => addDoc(collection(firestore, "set_logs"), {
      user_id: userId,
      workout_log_id: log.id,
      workout_exercise_id: exercise.id,
      set_number: index + 1,
      reps: Number.parseInt(exercise.performed?.[index]?.reps ?? exercise.reps, 10) || null,
      load: Number.parseFloat(exercise.performed?.[index]?.load ?? exercise.load ?? "") || null,
      completed: true,
      created_at: serverTimestamp(),
    })),
  ));
  return log.id;
}
