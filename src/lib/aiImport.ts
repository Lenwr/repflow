import { normalizeWorkoutOcr, type ImportedExercise } from "./importProgram";
import { supabase } from "./supabase";

export type AiWorkoutImport = {
  title: string;
  objective?: string | null;
  exercises: ImportedExercise[];
  warnings?: string[];
};

export async function analyzeWorkoutWithAi(
  text: string,
): Promise<AiWorkoutImport> {
  if (!supabase) throw new Error("Supabase n’est pas connecté.");

  const normalizedText = normalizeWorkoutOcr(text);

  const { data, error } = await supabase.functions.invoke("parse-workout", {
    body: { text: normalizedText },
  });

  if (error) {
    throw new Error(
      "L’analyse IA n’est pas encore disponible. Vérifiez que la fonction Supabase et la clé OpenAI sont installées.",
    );
  }
  if (!data?.title || !Array.isArray(data.exercises)) {
    throw new Error("L’IA a renvoyé un résultat incomplet.");
  }

  // Keep imports correct while an older deployed function still uses the
  // legacy schema without a dedicated load field. OCR often turns 115 into
  // "1 | 1 | 5"; normalizeWorkoutOcr has already rebuilt that number here.
  const prescriptions = Array.from(
    normalizedText.matchAll(
      /\b(top\s*set|volume)\b[^\n]*?\b(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*kg\b/gi,
    ),
  );
  const used = new Set<number>();
  const exercises = (data.exercises as ImportedExercise[]).map((exercise) => {
    if (exercise.load || !exercise.method) return exercise;
    const method = exercise.method.toLowerCase().replace(/\s+/g, " ").trim();
    const prescriptionIndex = prescriptions.findIndex((match, index) => {
      if (used.has(index)) return false;
      return match[1].toLowerCase().replace(/\s+/g, " ").trim() === method;
    });
    if (prescriptionIndex < 0) return exercise;
    used.add(prescriptionIndex);
    const match = prescriptions[prescriptionIndex];
    return {
      ...exercise,
      sets: 1,
      reps: match[2],
      load: `${match[3].replace(",", ".")} kg`,
    };
  });

  return { ...(data as AiWorkoutImport), exercises };
}
