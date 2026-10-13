const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
        required: ["name", "sets", "reps", "rest", "method", "notes", "blockKey", "blockType", "blockDuration", "workSeconds", "blockRest", "blockRounds"],
        properties: {
          name: { type: "string" },
          sets: { type: "integer", minimum: 1, maximum: 100 },
          reps: { type: "string" },
          rest: { type: "integer", minimum: 0, maximum: 3600 },
          method: { type: ["string", "null"] },
          notes: { type: ["string", "null"] },
          blockKey: { type: ["string", "null"] },
          blockType: { type: ["string", "null"], enum: ["EMOM", "AMRAP", "Tabata", "Intervalles", "Circuit", null] },
          blockDuration: { type: ["integer", "null"], minimum: 1 },
          workSeconds: { type: ["integer", "null"], minimum: 1 },
          blockRest: { type: ["integer", "null"], minimum: 0 },
          blockRounds: { type: ["integer", "null"], minimum: 1 },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY manquante");

    const { text } = await request.json();
    const source = typeof text === "string" ? text.trim() : "";
    if (!source) {
      return Response.json({ error: "Texte manquant" }, { status: 400, headers: corsHeaders });
    }
    if (source.length > 40_000) {
      return Response.json({ error: "Document trop long" }, { status: 413, headers: corsHeaders });
    }

    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") ?? "gpt-5.4",
        store: false,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: `Tu structures des programmes de musculation en français. Ne crée aucune information absente. Ignore les en-têtes de tableau, noms du coach, dates et objectifs comme exercices. Reconnais les abréviations courantes (MU, pull-up, SBD), circuits, supersets, blocs, EMOM, AMRAP et Tabata. Crée une ligne par exercice réellement demandé. Conserve l'échauffement et la mobilité, avec method="Échauffement". Pour une durée, écris-la dans reps. Si le repos n'est pas indiqué, mets rest=0. Place le nom du bloc dans method. Tous les exercices d'un même bloc reçoivent le même blockKey court. Renseigne blockType uniquement pour EMOM, AMRAP, Tabata, Intervalles ou Circuit, sinon null. Convertis toutes les durées de bloc en secondes dans blockDuration. Pour EMOM, workSeconds=60. Pour Tabata, utilise les temps indiqués ou 20/10. Renseigne blockRounds seulement s'il est indiqué ou directement déductible. Une liste avec « ou » reste un choix unique. Signale toute ambiguïté dans warnings.`,
            }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: source }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "workout_import",
            strict: true,
            schema,
          },
        },
      }),
    });

    if (!openaiResponse.ok) {
      const detail = await openaiResponse.text();
      console.error("OpenAI response error", openaiResponse.status, detail.slice(0, 500));
      throw new Error("Échec de l’analyse OpenAI");
    }

    const response = await openaiResponse.json();
    const outputText = response.output
      ?.flatMap((item: { content?: Array<{ type: string; text?: string }> }) => item.content ?? [])
      .find((item: { type: string }) => item.type === "output_text")?.text;
    if (!outputText) throw new Error("Réponse structurée vide");

    return Response.json(JSON.parse(outputText), { headers: corsHeaders });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unknown error");
    return Response.json(
      { error: "Impossible d’analyser cette séance" },
      { status: 500, headers: corsHeaders },
    );
  }
});
