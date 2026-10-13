export type ImportedExercise = {
  name: string;
  sets: number;
  reps: string;
  rest: number;
  method?: string;
  notes?: string;
  blockKey?: string | null;
  blockType?: "EMOM" | "AMRAP" | "Tabata" | "Intervalles" | "Circuit" | null;
  blockDuration?: number | null;
  workSeconds?: number | null;
  blockRest?: number | null;
  blockRounds?: number | null;
};

const clean = (value: string) => value.trim().replace(/^[-•*]\s*/, "");

export function parseWorkoutText(text: string) {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const titleLine = lines.find((line) =>
    /\b(séance|session|workout|jour)\s*\d*/i.test(line),
  );
  const title =
    titleLine && titleLine.length <= 100 ? titleLine : "Programme importé";
  const exercises: ImportedExercise[] = [];

  for (const line of lines) {
    const match = line.match(/^(.+?)\s+(\d+)\s*[x×]\s*([\d-]+)/i);
    if (!match) continue;
    const exerciseName = match[1].replace(/\s*[-–—,:|]+$/, "").trim();
    if (
      exerciseName.length < 2 ||
      exerciseName.length > 80 ||
      /\b(coach|objectif|exercices?|méthodes?|séries?|répétitions?|récupération|consignes?|échauffement|date)\b/i.test(
        exerciseName,
      )
    )
      continue;
    const restMatch = line.match(
      /(?:repos|rest)\s*[:=-]?\s*(\d+)\s*(s|sec(?:ondes?)?|min(?:utes?)?)?/i,
    );
    const restValue = restMatch?.[1] ? Number(restMatch[1]) : 90;
    exercises.push({
      name: exerciseName.replace(/^.*\|\s*/, ""),
      sets: Number(match[2]),
      reps: match[3],
      rest: restMatch?.[2]?.toLowerCase().startsWith("min")
        ? restValue * 60
        : restValue,
    });
  }
  return { title, exercises };
}

export function slugifyExercise(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
