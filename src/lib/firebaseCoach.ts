import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp,
  setDoc, updateDoc, where, writeBatch,
} from "firebase/firestore";
import { firebaseAuth, firestore } from "./firebase";

const iso = (value: unknown) => {
  if (value && typeof value === "object" && "toDate" in value) return (value as { toDate: () => Date }).toDate().toISOString();
  return typeof value === "string" ? value : new Date().toISOString();
};

export async function acceptCoachInvite(token: string) {
  const invite = await getDoc(doc(firestore, "coach_invites", token));
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid || !invite.exists()) throw new Error("Invitation invalide ou expirée.");
  const data = invite.data();
  if (data.used || (data.expires_at && new Date(data.expires_at) < new Date())) throw new Error("Invitation invalide ou expirée.");
  const batch = writeBatch(firestore);
  batch.set(doc(firestore, "coach_clients", `${data.coach_id}_${uid}`), { coach_id: data.coach_id, client_id: uid, status: "active", created_at: serverTimestamp() });
  batch.update(invite.ref, { used: true, used_by: uid, used_at: serverTimestamp() });
  batch.set(doc(firestore, "profiles", uid), { role: "client" }, { merge: true });
  await batch.commit();
}

export async function createCoachInvite() {
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid) throw new Error("Votre session a expiré.");
  const token = crypto.randomUUID();
  await setDoc(doc(firestore, "coach_invites", token), { coach_id: uid, used: false, created_at: serverTimestamp(), expires_at: new Date(Date.now() + 14 * 864e5).toISOString() });
  return token;
}

export async function loadCoachClients() {
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid) return [];
  const links = await getDocs(query(collection(firestore, "coach_clients"), where("coach_id", "==", uid), where("status", "==", "active")));
  return Promise.all(links.docs.map(async (link, index) => {
    const clientId = String(link.data().client_id);
    const [profile, logs] = await Promise.all([
      getDoc(doc(firestore, "profiles", clientId)),
      getDocs(query(collection(firestore, "workout_logs"), where("user_id", "==", clientId))),
    ]);
    const dates = logs.docs.map((item) => String(item.data().completed_at ?? "")).filter(Boolean).sort().reverse();
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); weekStart.setHours(0, 0, 0, 0);
    const name = String(profile.data()?.display_name ?? "Client");
    return { id: clientId, name, initials: name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(), color: ["#dff56d", "#d9e8ff", "#ffe3cf", "#eadcff"][index % 4], lastActivity: dates[0] ?? null, completedThisWeek: dates.filter((date) => new Date(date) >= weekStart).length };
  }));
}

export async function loadPrograms() {
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid) return [];
  const programs = await getDocs(query(collection(firestore, "programs"), where("owner_id", "==", uid)));
  const workouts = await getDocs(query(collection(firestore, "workouts"), where("owner_id", "==", uid)));
  const assignments = await getDocs(query(collection(firestore, "program_assignments"), where("assigned_by", "==", uid)));
  return programs.docs.map((item) => ({
    id: item.id, title: item.data().title ?? "Programme", description: item.data().description ?? null,
    duration_weeks: item.data().duration_weeks ?? null, created_at: iso(item.data().created_at),
    workouts: workouts.docs.filter((workout) => workout.data().program_id === item.id).map((workout) => ({ id: workout.id })),
    program_assignments: assignments.docs.filter((assignment) => assignment.data().program_id === item.id).map((assignment) => ({ id: assignment.id })),
  })).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function createProgram(title: string) {
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid) throw new Error("Votre session a expiré.");
  return addDoc(collection(firestore, "programs"), { owner_id: uid, title, description: null, duration_weeks: 8, client_ids: {}, created_at: serverTimestamp() });
}

export async function assignProgram(programId: string, clientId: string, startsOn: string) {
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid) throw new Error("Votre session a expiré.");
  const id = `${programId}_${clientId}`;
  const batch = writeBatch(firestore);
  batch.set(doc(firestore, "program_assignments", id), { program_id: programId, client_id: clientId, assigned_by: uid, starts_on: startsOn, active: true, created_at: serverTimestamp() }, { merge: true });
  batch.update(doc(firestore, "programs", programId), { [`client_ids.${clientId}`]: true });
  const workouts = await getDocs(query(collection(firestore, "workouts"), where("owner_id", "==", uid), where("program_id", "==", programId)));
  workouts.docs.forEach((workout) => batch.update(workout.ref, { [`client_ids.${clientId}`]: true }));
  await batch.commit();
}

export async function loadProgramEditor(programId: string) {
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid) throw new Error("Votre session a expiré.");
  const [program, workouts] = await Promise.all([
    getDoc(doc(firestore, "programs", programId)),
    getDocs(query(collection(firestore, "workouts"), where("owner_id", "==", uid), where("program_id", "==", programId))),
  ]);
  if (!program.exists()) throw new Error("Programme introuvable");
  return { title: String(program.data().title ?? "Programme"), workouts: workouts.docs.map((item) => {
    const data = item.data();
    return { id: item.id, title: data.title ?? "Séance", position: data.position ?? 0, estimated_minutes: data.estimated_minutes ?? 45, workout_blocks: data.workout_blocks ?? [], workout_exercises: data.workout_exercises ?? data.exercises ?? [] };
  }).sort((a, b) => a.position - b.position) };
}

export async function createProgramWorkout(programId: string, title: string, position: number) {
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid) throw new Error("Votre session a expiré.");
  return addDoc(collection(firestore, "workouts"), { owner_id: uid, program_id: programId, client_ids: {}, title, position, estimated_minutes: 45, workout_blocks: [], workout_exercises: [], exercises: [], status: "planned", created_at: serverTimestamp() });
}

export async function addProgramExercise(workoutId: string, line: Record<string, unknown>) {
  const ref = doc(firestore, "workouts", workoutId); const snapshot = await getDoc(ref);
  const current = snapshot.data()?.workout_exercises ?? snapshot.data()?.exercises ?? [];
  await updateDoc(ref, { workout_exercises: [...current, line], exercises: [...current, line], updated_at: serverTimestamp() });
}

export async function addProgramBlock(workoutId: string, block: Record<string, unknown>) {
  const ref = doc(firestore, "workouts", workoutId); const snapshot = await getDoc(ref);
  await updateDoc(ref, { workout_blocks: [...(snapshot.data()?.workout_blocks ?? []), block], updated_at: serverTimestamp() });
}

export async function replaceProgramExercises(workoutId: string, lines: unknown[]) {
  await updateDoc(doc(firestore, "workouts", workoutId), { workout_exercises: lines, exercises: lines, updated_at: serverTimestamp() });
}

export async function loadClientDetails(clientId: string) {
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid) throw new Error("Votre session a expiré.");
  const [profile, assignments, programs, workouts, logs, sets, notes] = await Promise.all([
    getDoc(doc(firestore, "profiles", clientId)),
    getDocs(query(collection(firestore, "program_assignments"), where("client_id", "==", clientId))),
    getDocs(query(collection(firestore, "programs"), where("owner_id", "==", uid))),
    getDocs(query(collection(firestore, "workouts"), where("owner_id", "==", uid))),
    getDocs(query(collection(firestore, "workout_logs"), where("user_id", "==", clientId))),
    getDocs(query(collection(firestore, "set_logs"), where("user_id", "==", clientId))),
    getDocs(query(collection(firestore, "coach_client_notes"), where("coach_id", "==", uid), where("client_id", "==", clientId))),
  ]);
  return {
    name: profile.data()?.display_name ?? "Client",
    assignments: assignments.docs.map((item) => { const data = item.data(); const program = programs.docs.find((p) => p.id === data.program_id); return { id: item.id, starts_on: data.starts_on, active: data.active, programs: program ? { id: program.id, title: program.data().title, workouts: workouts.docs.filter((w) => w.data().program_id === program.id).map((w) => ({ id: w.id, title: w.data().title })) } : null }; }),
    logs: logs.docs.map((item) => { const data = item.data(); const workout = workouts.docs.find((w) => w.id === data.workout_id); return { id: item.id, completed_at: data.completed_at ?? null, effort: data.effort ?? null, workouts: workout ? { title: workout.data().title } : null, set_logs: sets.docs.filter((s) => s.data().workout_log_id === item.id).map((s) => ({ load: s.data().load ?? null, reps: s.data().reps ?? null })) }; }).sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at))),
    notes: notes.docs.map((item) => ({ id: item.id, content: item.data().content, created_at: iso(item.data().created_at) })).sort((a, b) => b.created_at.localeCompare(a.created_at)),
  };
}

export async function addClientNote(clientId: string, content: string) { const uid = firebaseAuth.currentUser?.uid; if (!uid) throw new Error("Session expirée"); await addDoc(collection(firestore, "coach_client_notes"), { coach_id: uid, client_id: clientId, content, created_at: serverTimestamp() }); }
export async function deactivateAssignment(id: string) { await updateDoc(doc(firestore, "program_assignments", id), { active: false, updated_at: serverTimestamp() }); }
export async function endCoaching(clientId: string) { const uid = firebaseAuth.currentUser?.uid; if (!uid) throw new Error("Session expirée"); await updateDoc(doc(firestore, "coach_clients", `${uid}_${clientId}`), { status: "ended", ended_at: serverTimestamp() }); }

export async function loadRecentLogs(userId: string) {
  const [logs, sets, workouts] = await Promise.all([getDocs(query(collection(firestore, "workout_logs"), where("user_id", "==", userId))), getDocs(query(collection(firestore, "set_logs"), where("user_id", "==", userId))), getDocs(query(collection(firestore, "workouts"), where("owner_id", "==", userId)))]);
  return logs.docs.map((item) => ({ completed_at: item.data().completed_at ?? null, duration_seconds: item.data().duration_seconds ?? 0, workouts: { title: workouts.docs.find((w) => w.id === item.data().workout_id)?.data().title ?? "Séance" }, set_logs: sets.docs.filter((s) => s.data().workout_log_id === item.id).map((s) => ({ load: s.data().load ?? null, reps: s.data().reps ?? null })) })).sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at))).slice(0, 20);
}
