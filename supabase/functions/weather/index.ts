// Edge Function « weather » : collecte la météo publique (Open-Meteo, gratuit, sans clé) des
// stations météo virtuelles. Appelée toutes les 30 minutes par pg_cron, ou depuis l'application
// juste après la création d'une station (droits « gestion »).
//
// Secrets : COLLECT_TOKEN (le même que pour « collect »). Fournis par Supabase : SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "npm:@supabase/supabase-js@2";
import { runWeather } from "./handler.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let allowed = token !== "" && token === env("COLLECT_TOKEN");
  if (!allowed && token) {
    // Un compte connecté peut déclencher la collecte : elle ne touche que les stations météo
    const asUser = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data } = await asUser.auth.getUser();
    allowed = !!data.user;
  }
  if (!allowed) return json({ error: "Non autorisé" }, 401);

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  try {
    const results = await runWeather(db, async (url) => {
      const res = await fetch(url, { headers: { "User-Agent": "MobAlPlus (collecte météo)" } });
      if (!res.ok) throw new Error(`Open-Meteo ${res.status} : ${(await res.text()).slice(0, 200)}`);
      return res.json();
    });
    return json({ results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
