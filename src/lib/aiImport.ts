import type { ImportedExercise } from "./importProgram";
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

  const { data, error } = await supabase.functions.invoke("parse-workout", {
    body: { text },
  });

  if (error) {
    throw new Error(
      "L’analyse IA n’est pas encore disponible. Vérifiez que la fonction Supabase et la clé OpenAI sont installées.",
    );
  }
  if (!data?.title || !Array.isArray(data.exercises)) {
    throw new Error("L’IA a renvoyé un résultat incomplet.");
  }
  return data as AiWorkoutImport;
}
