// Edge Function « notify » : envoie sur les téléphones abonnés les alertes nouvelles (Web Push).
//
// Appelée toutes les 10 minutes par pg_cron, juste après l'évaluation des alertes
// (supabase/migrations/*_alerts.sql).
//
// Secrets (supabase secrets set ...) :
//   COLLECT_TOKEN       jeton attendu de pg_cron (le même que pour « collect »)
//   VAPID_PUBLIC_KEY    clés VAPID (npx web-push generate-vapid-keys) ; la clé publique est
//   VAPID_PRIVATE_KEY   aussi donnée à l'application (VITE_VAPID_PUBLIC_KEY)
//   VAPID_SUBJECT       contact, ex. mailto:vous@exemple.fr

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { type Db, runNotify } from "./handler.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || token !== env("COLLECT_TOKEN")) return json({ error: "Non autorisé" }, 401);
  if (!env("VAPID_PUBLIC_KEY") || !env("VAPID_PRIVATE_KEY")) {
    return json({ skipped: "Clés VAPID non configurées : notifications désactivées" });
  }
  webpush.setVapidDetails(env("VAPID_SUBJECT") || "mailto:admin@example.org", env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  try {
    const result = await runNotify(db as unknown as Db, async (sub, payload) => {
      try {
        const res = await webpush.sendNotification(sub, payload, { TTL: 6 * 3600, urgency: "high" });
        return res.statusCode;
      } catch (e) {
        return (e as { statusCode?: number }).statusCode ?? 500;
      }
    });
    return json(result);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
