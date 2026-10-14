"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAccount = exports.parseWorkout = void 0;
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
(0, app_1.initializeApp)();
const openAiApiKey = (0, params_1.defineSecret)("OPENAI_API_KEY");
const schema = {
    type: "object",
    additionalProperties: false,
    required: ["title", "objective", "exercises", "warnings"],
    properties: {
        title: { type: "string" },
        objective: { type: ["string", "null"] },
        exercises: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "sets", "reps", "load", "rest", "method", "notes", "blockKey", "blockType", "blockDuration", "workSeconds", "blockRest", "blockRounds"],
                properties: {
                    name: { type: "string" }, sets: { type: "integer", minimum: 1, maximum: 100 },
                    reps: { type: "string" }, load: { type: ["string", "null"] },
                    rest: { type: "integer", minimum: 0, maximum: 3600 }, method: { type: ["string", "null"] },
                    notes: { type: ["string", "null"] }, blockKey: { type: ["string", "null"] },
                    blockType: { type: ["string", "null"], enum: ["EMOM", "AMRAP", "Tabata", "Intervalles", "Circuit", null] },
                    blockDuration: { type: ["integer", "null"], minimum: 1 }, workSeconds: { type: ["integer", "null"], minimum: 1 },
                    blockRest: { type: ["integer", "null"], minimum: 0 }, blockRounds: { type: ["integer", "null"], minimum: 1 }
                }
            }
        },
        warnings: { type: "array", items: { type: "string" } }
    }
};
exports.parseWorkout = (0, https_1.onCall)({ region: "europe-west1", secrets: [openAiApiKey], timeoutSeconds: 120 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Connexion requise.");
    const source = typeof request.data?.text === "string" ? request.data.text.trim() : "";
    if (!source)
        throw new https_1.HttpsError("invalid-argument", "Texte manquant.");
    if (source.length > 40_000)
        throw new https_1.HttpsError("invalid-argument", "Document trop long.");
    const examples = Array.isArray(request.data?.examples)
        ? request.data.examples.slice(0, 3).map((example) => ({
            sourceText: String(example?.sourceText ?? "").slice(0, 3000), before: example?.before ?? null, after: example?.after ?? null
        }))
        : [];
    const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${openAiApiKey.value()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "gpt-5.4", store: false,
            input: [
                { role: "system", content: [{ type: "input_text", text: `Tu structures des programmes de musculation en français. Ne crée aucune information absente. Ignore les en-têtes, noms, dates et objectifs comme exercices. Reconnais les circuits, supersets, EMOM, AMRAP et Tabata. Conserve l'échauffement avec method="Échauffement". Place les durées de récupération dans rest en secondes, jamais dans les répétitions. Conserve les consignes dans notes. Les exercices d'un bloc partagent blockKey. Pour « 3 × 115 kg », utilise sets=1, reps="3", load="115 kg". Pour « 4 × 8 » sans kg, utilise sets=4 et reps="8". Signale les ambiguïtés dans warnings.` }] },
                { role: "user", content: [{ type: "input_text", text: `${examples.length ? `Exemples corrigés privés de cet utilisateur (ne copie aucun exercice absent du nouveau document) :\n${JSON.stringify(examples)}\n\n` : ""}Nouveau document :\n${source}` }] }
            ],
            text: { format: { type: "json_schema", name: "workout_import", strict: true, schema } }
        })
    });
    if (!response.ok) {
        console.error("OpenAI", response.status, (await response.text()).slice(0, 500));
        throw new https_1.HttpsError("internal", "Échec de l’analyse IA.");
    }
    const json = await response.json();
    const output = json.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!output)
        throw new https_1.HttpsError("internal", "Réponse structurée vide.");
    return JSON.parse(output);
});
exports.deleteAccount = (0, https_1.onCall)({ region: "europe-west1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Connexion requise.");
    const uid = request.auth.uid;
    const db = (0, firestore_1.getFirestore)();
    const ownedCollections = ["profiles", "programs", "workouts", "workout_logs", "set_logs", "import_corrections"];
    for (const name of ownedCollections) {
        const ref = db.collection(name);
        const snapshots = name === "profiles"
            ? [await ref.doc(uid).get()]
            : (await ref.where(name === "programs" || name === "workouts" ? "owner_id" : "user_id", "==", uid).get()).docs;
        const docs = snapshots.filter((item) => item.exists);
        for (let offset = 0; offset < docs.length; offset += 400) {
            const batch = db.batch();
            docs.slice(offset, offset + 400).forEach((item) => batch.delete(item.ref));
            await batch.commit();
        }
    }
    await (0, auth_1.getAuth)().deleteUser(uid);
    return { deleted: true };
});
