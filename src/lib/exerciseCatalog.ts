export type CatalogExercise = {
  id: string;
  name: string;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  images: string[];
};

const sourceBase = "https://github.com/yuhonas/free-exercise-db";
const imageBase =
  "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";

const aliases: Record<string, string> = {
  "developpe couche": "Barbell_Bench_Press_-_Medium_Grip",
  "developpe incline halteres": "Incline_Dumbbell_Press",
  "tirage horizontal": "Seated_Cable_Rows",
  "developpe epaules": "Dumbbell_Shoulder_Press",
  "curl incline": "Incline_Dumbbell_Curl",
  "elevations laterales": "Side_Lateral_Raise",
  "extension triceps": "Triceps_Pushdown",
  squat: "Barbell_Squat",
};

export const normalizeName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export const catalogImage = (path: string) =>
  imageBase + path.split("/").map(encodeURIComponent).join("/");
export const catalogSource = (id: string) =>
  `${sourceBase}/tree/main/exercises/${encodeURIComponent(id)}`;

export function findCatalogExercise(items: CatalogExercise[], name: string) {
  const normalized = normalizeName(name);
  if (!normalized || normalized.length > 70) return undefined;
  const alias = aliases[normalized];
  if (alias) return items.find((item) => item.id === alias);
  return items.find((item) => normalizeName(item.name) === normalized);
}
