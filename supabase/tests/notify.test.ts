import { test } from "node:test";
import assert from "node:assert/strict";
import { message, type Pending, runNotify, runSystemNotify } from "../functions/notify/handler.ts";

const base: Pending = {
  event_id: 1, kind: "above", level: "warning", value: 27.3, threshold: 26, started_at: "2026-10-06T14:00:00Z",
  place_id: 4, place_name: "Salon", property: "temperature", unit: "°C", endpoint: "https://push/a", p256dh: "k", auth: "a",
};

test("texte des notifications", () => {
  assert.deepEqual(message(base), { title: "⚠️ Salon", body: "Température 27,3 °C : au-dessus de 26 °C" });
  assert.equal(message({ ...base, kind: "peak", level: "info", value: 22.8 }).body, "Pic de température passé (22,8 °C), en baisse");
  assert.equal(message({ ...base, kind: "below", property: "humidity", unit: "%", value: 28, threshold: 30 }).body,
    "Humidité 28 % : en dessous de 30 %");
  assert.match(message({ ...base, kind: "silent", value: null, started_at: "2026-10-07T06:00:00Z" }).body,
    /^Capteur muet depuis 7 oct\.,? 08:00/);
  assert.equal(message({ ...base, place_name: "Extérieur", kind: "gap_above", value: 1.2, threshold: 0, ref_place_name: "Salon" }).body,
    "Température plus élevée qu'à Salon (écart 1,2 °C)");
  assert.equal(message({ ...base, kind: "fall", value: 2, threshold: 1.5 }).body, "Température en baisse rapide : −2 °C en une heure");
  assert.match(message({ ...base, kind: "fc_below", value: -2, threshold: 0, forecast_at: "2026-10-08T04:00:00Z" }).body,
    /^Prévision : température en dessous de 0 °C dès \S+ 06:00 \(jusqu'à -2 °C\)$/);
});

test("envoi, abonnements expirés supprimés, alertes marquées notifiées", async () => {
  const calls: string[] = [];
  const deleted: string[] = [];
  const rows = [base, { ...base, endpoint: "https://push/b" }, { ...base, event_id: 2, endpoint: "https://push/b" }];
  const db = {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push(fn + (args ? JSON.stringify(args) : ""));
      return { data: fn === "pending_notifications" ? rows : null, error: null };
    },
    from: () => ({ delete: () => ({ eq: async (_: string, v: string) => { deleted.push(v); } }) }),
  };
  const sent: string[] = [];
  const res = await runNotify(db, async (sub, payload) => {
    sent.push(sub.endpoint + " " + JSON.parse(payload).url);
    return sub.endpoint.endsWith("/b") ? 410 : 201;
  });
  assert.deepEqual(res, { events: 2, sent: 1, failed: 0, expired: 1 });
  assert.deepEqual(sent, ["https://push/a #/lieu/4", "https://push/b #/lieu/4"]);
  assert.deepEqual(deleted, ["https://push/b"]);
  assert.deepEqual(calls, ["expire_notifications", "pending_notifications", 'mark_notified{"p_ids":[1,2]}']);
});

test("alertes de la plateforme : occupation de la base, aux administrateurs, marquées notifiées", async () => {
  const calls: string[] = [];
  const row = { alert_id: 3, kind: "db_quota", level: "warning", value: 71.6, threshold: 70, endpoint: "https://push/a", p256dh: "k", auth: "a" };
  const db = {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push(fn + (args ? JSON.stringify(args) : ""));
      return { data: fn === "pending_system_notifications" ? [row] : null, error: null };
    },
    from: () => ({ delete: () => ({ eq: async () => {} }) }),
  };
  const payloads: { title: string; body: string; url: string }[] = [];
  const res = await runSystemNotify(db, async (_s, p) => { payloads.push(JSON.parse(p)); return 201; });
  assert.deepEqual(res, { alerts: 1, sent: 1 });
  assert.equal(payloads[0].title, "⚠️ Base de données");
  assert.match(payloads[0].body, /^Occupation : 72 % du quota \(seuil 70 %\)/);
  assert.equal(payloads[0].url, "#/admin/base");
  assert.deepEqual(calls, ["pending_system_notifications", 'mark_system_notified{"p_ids":[3]}']);
  // Base pas encore à jour : rien, sans erreur
  const old = { rpc: async () => ({ data: null, error: { message: "inconnue" } }), from: db.from };
  assert.deepEqual(await runSystemNotify(old, async () => 201), { alerts: 0, sent: 0 });
});
