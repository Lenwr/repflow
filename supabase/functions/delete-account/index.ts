import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return Response.json({ error: "Méthode refusée" }, { status: 405, headers: corsHeaders });
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return Response.json({ error: "Non authentifié" }, { status: 401, headers: corsHeaders });
    const token = authorization.replace(/^Bearer\s+/i, "");
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("Configuration Supabase manquante");

    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return Response.json({ error: "Session invalide" }, { status: 401, headers: corsHeaders });

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: deleteError } = await admin.auth.admin.deleteUser(userData.user.id);
    if (deleteError) throw deleteError;
    return Response.json({ deleted: true }, { headers: corsHeaders });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Account deletion failed");
    return Response.json({ error: "Suppression du compte impossible" }, { status: 500, headers: corsHeaders });
  }
});
