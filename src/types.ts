export type Role = "solo" | "client" | "coach" | "admin" | "superadmin";
export type Effort = "Facile" | "Bien" | "Difficile";

export interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: string;
  load?: string;
  rest: number;
  muscle: string;
  done: number;
  imageUrl?: string;
  imageUrlEnd?: string;
  instructions?: string[];
  sourceUrl?: string;
  method?: string;
  notes?: string;
  blockKey?: string;
  blockType?: "EMOM" | "AMRAP" | "Tabata" | "Intervalles" | "Circuit";
  blockDuration?: number;
  workSeconds?: number;
  blockRest?: number;
  blockRounds?: number;
  performed?: Record<number, { load: string; reps: string }>;
}
export interface Workout {
  id: string;
  title: string;
  subtitle: string;
  duration: number;
  exercises: Exercise[];
  status: "next" | "done" | "planned";
  day: string;
}
export interface Client {
  id: string;
  name: string;
  initials: string;
  color: string;
  goal: string;
  lastActivity: string;
  adherence: number;
  alert?: string;
  trend: string;
}
