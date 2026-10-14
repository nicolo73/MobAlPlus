// Edge Function « weather » : collecte la météo publique (Open-Meteo, gratuit, sans clé) des
// stations météo virtuelles. Appelée toutes les 30 minutes par pg_cron, ou depuis l'application
// juste après la création d'une station (droits « gestion »).
// Corps { place: <emplacement> } : cette station seulement (bouton « Actualiser » de sa page, pour
// tout membre de la maison), avec en plus ses détails en direct (altitude, conditions complètes…) ;
// { place, refresh: false } : les détails seulement, sans collecte (ouverture de la page).
//
// Secrets : COLLECT_TOKEN (le même que pour « collect »). Fournis par Supabase : SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "npm:@supabase/supabase-js@2";
import { runNormals, runWeather, stationDetails } from "./handler.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const fetchJson = async (url: string) => {
  const res = await fetch(url, { headers: { "User-Agent": "MobAlPlus (collecte météo)" } });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status} : ${(await res.text()).slice(0, 200)}`);
  return res.json();
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let allowed = token !== "" && token === env("COLLECT_TOKEN");
  // Un compte connecté peut déclencher la collecte : elle ne touche que les stations météo
  const asUser = !allowed && token ? createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } },
  }) : null;
  if (asUser) allowed = !!(await asUser.auth.getUser()).data.user;
  if (!allowed) return json({ error: "Non autorisé" }, 401);

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({})) as { place?: unknown; refresh?: unknown };
  try {
    if (typeof body.place === "number") {
      // Une station : celle de l'emplacement, s'il est accessible au compte (droits vérifiés par la base)
      const { data: info, error } = await (asUser ?? db).rpc("weather_station_info", { p_place: body.place });
      if (error) throw new Error(error.message);
      const st = info as { ma_id: string; lat: number; lon: number } | null;
      if (!st) return json({ error: "Pas de station météo accessible à cet emplacement" }, 404);
      if (body.refresh === false) {
        const details = await stationDetails(fetchJson, st.lat, st.lon).catch((e) => ({ error: String(e) }));
        return json({ results: [], normals: null, details });
      }
      const results = await runWeather(db, fetchJson, Date.now(), st.ma_id);
      const normals = await runNormals(db, fetchJson, st.ma_id).catch((e) => ({ station: st.ma_id, normals: 0, error: String(e) }));
      const details = await stationDetails(fetchJson, st.lat, st.lon).catch((e) => ({ error: String(e) }));
      return json({ results, normals, details });
    }
    const results = await runWeather(db, fetchJson);
    // Normales saisonnières : une tranche pour une station qui n'en a pas encore
    const normals = await runNormals(db, fetchJson).catch((e) => ({ station: "", normals: 0, error: String(e) }));
    return json({ results, normals });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
