import { test } from "node:test";
import assert from "node:assert/strict";
import { message, type Pending, runNotify } from "../functions/notify/handler.ts";

const base: Pending = {
  event_id: 1, kind: "above", level: "warning", value: 27.3, threshold: 26, started_at: "2026-10-06T14:00:00Z",
  place_id: 4, place_name: "Salon", property: "temperature", unit: "°C", endpoint: "https://push/a", p256dh: "k", auth: "a",
};

test("texte des notifications", () => {
  assert.deepEqual(message(base), { title: "⚠️ Salon", body: "Température 27,3 °C : au-dessus de 26 °C" });
  assert.equal(message({ ...base, kind: "peak", level: "info", value: 22.8 }).body, "Pic de température passé (22,8 °C), en baisse");
  assert.equal(message({ ...base, kind: "below", property: "humidity", unit: "%", value: 28, threshold: 30 }).body,
    "Humidité 28 % : en dessous de 30 %");
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
