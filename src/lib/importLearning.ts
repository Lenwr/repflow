import { collection, getDocs, query, where } from "firebase/firestore";
import { firestore } from "./firebase";
import type { AiWorkoutImport } from "./aiImport";

export type ImportCorrectionExample = {
  sourceText: string;
  before: AiWorkoutImport;
  after: AiWorkoutImport;
};

const words = (value: string) =>
  new Set(
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]{3,}/g) ?? [],
  );

function similarity(left: string, right: string) {
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  a.forEach((word) => b.has(word) && common++);
  return common / Math.max(a.size, b.size);
}

export async function loadSimilarImportCorrections(userId: string, sourceText: string) {
  const snapshot = await getDocs(
    query(collection(firestore, "import_corrections"), where("user_id", "==", userId)),
  );
  return snapshot.docs
    .map((item) => item.data() as ImportCorrectionExample & { created_at?: { seconds?: number } })
    .map((item) => ({ item, score: similarity(sourceText, item.sourceText) }))
    .filter(({ score }) => score > 0.08)
    .sort((a, b) => b.score - a.score || (b.item.created_at?.seconds ?? 0) - (a.item.created_at?.seconds ?? 0))
    .slice(0, 3)
    .map(({ item }) => ({ sourceText: item.sourceText, before: item.before, after: item.after }));
}

export function importWasCorrected(before: AiWorkoutImport, after: AiWorkoutImport) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

