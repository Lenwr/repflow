import { normalizeWorkoutOcr, type ImportedExercise } from "./importProgram";
import { httpsCallable } from "firebase/functions";
import { firebaseFunctions } from "./firebase";
import type { ImportCorrectionExample } from "./importLearning";

export type AiWorkoutImport = {
  title: string;
  objective?: string | null;
  exercises: ImportedExercise[];
  warnings?: string[];
};

export async function analyzeWorkoutWithAi(
  text: string,
  examples: ImportCorrectionExample[] = [],
): Promise<AiWorkoutImport> {
  const normalizedText = normalizeWorkoutOcr(text);
  let data: AiWorkoutImport;
  try {
    const parseWorkout = httpsCallable<
      { text: string; examples: ImportCorrectionExample[] },
      AiWorkoutImport
    >(firebaseFunctions, "parseWorkout");
    const result = await parseWorkout({ text: normalizedText, examples });
    data = result.data;
  } catch {
    throw new Error(
      "L’analyse IA Firebase n’est pas encore disponible. Vérifiez que la fonction parseWorkout et la clé OpenAI sont déployées.",
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

  return { ...data, exercises };
}
