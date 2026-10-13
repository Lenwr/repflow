import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
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

export async function createWorkoutShare(userId: string, workout: Workout) {
  const token = crypto.randomUUID().replace(/-/g, "");
  const cleanWorkout = JSON.parse(JSON.stringify({ ...workout, done: undefined }));
  await setDoc(doc(firestore, "workout_shares", token), {
    owner_id: userId,
    workout: cleanWorkout,
    active: true,
    created_at: serverTimestamp(),
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
  return token;
}

export async function loadWorkoutShare(token: string) {
  const snapshot = await getDoc(doc(firestore, "workout_shares", token));
  if (!snapshot.exists()) throw new Error("Ce partage n’existe pas ou a été retiré.");
  const data = snapshot.data() as { active?: boolean; expires_at?: string; workout?: Workout };
  if (!data.active || !data.workout) throw new Error("Ce partage n’est plus disponible.");
  if (data.expires_at && new Date(data.expires_at) < new Date()) throw new Error("Ce lien de partage a expiré.");
  return data.workout;
}

export async function acceptWorkoutShare(userId: string, token: string) {
  const shared = await loadWorkoutShare(token);
  const createdAt = serverTimestamp();
  const program = await addDoc(collection(firestore, "programs"), {
    owner_id: userId,
    title: shared.subtitle || `Séance partagée — ${shared.title}`,
    description: "Séance reçue par partage",
    duration_weeks: 1,
    client_ids: {},
    source_share_id: token,
    created_at: createdAt,
  });
  const workoutData = JSON.parse(JSON.stringify({
    ...shared,
    id: undefined,
    owner_id: userId,
    program_id: program.id,
    client_ids: {},
    status: "planned",
    exercises: shared.exercises.map((exercise) => ({ ...exercise, id: crypto.randomUUID(), done: 0, performed: undefined })),
  }));
  const saved = await addDoc(collection(firestore, "workouts"), { ...workoutData, created_at: createdAt });
  return { ...shared, ...workoutData, id: saved.id } as Workout;
}
