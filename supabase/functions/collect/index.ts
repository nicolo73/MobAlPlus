// Edge Function « collect » : collecte les nouvelles mesures Mobile Alerts.
//
// Appelée toutes les 10 minutes par pg_cron (voir supabase/migrations/*_schedule.sql), ou depuis
// l'interface d'administration (bouton « Collecter maintenant »).
//
// Corps JSON optionnel : { "devices": ["07XXXXXXXXXX"], "lookback_days": 3 }
//
// Secrets (supabase secrets set ...) :
//   MA_VENDOR_ID     identifiant vendorid du site Mobile Alerts
//   COLLECT_TOKEN    jeton attendu de pg_cron (le même que mobalplus_collect_token dans Vault)
//   MA_TIMEZONE      facultatif, Europe/Paris par défaut
// Fournis automatiquement par Supabase : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "npm:@supabase/supabase-js@2";
import { MAClient } from "../_shared/ma_client.ts";
import { runCollect } from "./handler.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
// Appel depuis la PWA (navigateur) : en-têtes CORS ; l'accès reste contrôlé par le jeton ci-dessous
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST attendu" }, 405);

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  // Autorisé : pg_cron (jeton partagé) ou un administrateur connecté (jeton de session)
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let allowed = token !== "" && token === env("COLLECT_TOKEN");
  if (!allowed && token) {
    // Jeton de session d'un utilisateur : rôle lu avec ses propres droits (par identifiant ou e-mail)
    const asUser = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: role } = await asUser.rpc("my_role");
    allowed = role === "admin";
  }
  if (!allowed) return json({ error: "Non autorisé" }, 401);

  if (!env("MA_VENDOR_ID")) return json({ error: "Secret MA_VENDOR_ID manquant" }, 500);
  const body = await req.json().catch(() => ({}));
  const client = new MAClient({
    vendorId: env("MA_VENDOR_ID"),
    tz: env("MA_TIMEZONE") || "Europe/Paris",
    pauseMs: 500,
  });

  try {
    const results = await runCollect(db, client, {
      devices: Array.isArray(body.devices) ? body.devices : undefined,
      lookbackDays: Number(body.lookback_days) || undefined,
    });
    return json({ results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
