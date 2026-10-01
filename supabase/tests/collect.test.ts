// Tests des Edge Functions sous Node (node --test). Le test de bout en bout sur base n'est lancé que si
// TEST_DATABASE_URL est défini et que la base a été initialisée par les tests Python.

import { test } from "node:test";
import assert from "node:assert/strict";

import { localizeAscending, parseLocalTimestamp, toMaEpoch } from "../functions/_shared/timeutil.ts";
import { parseMeasurementDetails, parseValue } from "../functions/_shared/ma_parser.ts";
import { MAClient } from "../functions/_shared/ma_client.ts";
import { type Rpc, runCollect } from "../functions/collect/handler.ts";

const TZ = "Europe/Paris";

const page = (name: string, rows: [string, string[]][]) => `
<html><body><h3>${name}</h3>
<table class="table table-striped">
  <thead><tr><th class="timestamp">Horodatage</th>
    <th class="measurement">Temp&#233;rature int&#233;rieure</th>
    <th class="measurement">Hygrom&#233;trie int&#233;rieure</th></tr></thead>
  <tbody>${rows.map(([ts, vals]) =>
    `<tr><td class="timestamp">${ts}</td>${vals.map((v) => `<td class="measurement">${v}</td>`).join("")}</tr>`).join("")}
  </tbody></table></body></html>`;

test("epoch du site = heure locale lue comme de l'UTC", () => {
  // 27/07/2020 00:00 à Paris (UTC+2) -> 1595808000, valeur notée dans le script d'origine
  assert.equal(toMaEpoch(Date.UTC(2020, 6, 26, 22, 0), TZ), 1595808000);
  // en hiver (UTC+1)
  assert.equal(toMaEpoch(Date.UTC(2025, 0, 1, 11, 0), TZ), Date.UTC(2025, 0, 1, 12, 0) / 1000);
});

test("heure en double au passage à l'heure d'hiver", () => {
  const walls = ["26/10/2025 02:40:00", "26/10/2025 02:55:00", "26/10/2025 02:05:00", "26/10/2025 03:05:00"]
    .map(parseLocalTimestamp);
  const utc = localizeAscending(walls, TZ).map((t) => new Date(t).toISOString());
  assert.deepEqual(utc, ["2025-10-26T00:40:00.000Z", "2025-10-26T00:55:00.000Z",
                         "2025-10-26T01:05:00.000Z", "2025-10-26T02:05:00.000Z"]);
});

test("analyse de la page MeasurementDetails", () => {
  const p = parseMeasurementDetails(page("01-Salon Mesures", [
    ["01/01/2025 00:13:09", ["20,0 C", "55%"]],
    ["01/01/2025 00:06:15", ["---", "56%"]],
  ]));
  assert.equal(p.deviceName, "01-Salon Mesures");
  assert.deepEqual(p.headers, ["Température intérieure", "Hygrométrie intérieure"]);
  assert.deepEqual(p.rows[0], [Date.UTC(2025, 0, 1, 0, 13, 9), [20, 55]]);
  assert.deepEqual(p.rows[1][1], [null, 56]);
  assert.equal(parseValue("-19,3 C"), -19.3);
  assert.equal(parseValue("43530"), null);
  assert.deepEqual(parseMeasurementDetails("<h3>x</h3>").rows, []);
});

function fakeSite(byDay: Record<string, [string, string[]][]>) {
  const calls: URL[] = [];
  const fetchImpl = (async (input: string) => {
    const url = new URL(input);
    calls.push(url);
    // fromepoch est une heure locale « en UTC » : la date du jour local est lisible directement
    const day = new Date(Number(url.searchParams.get("fromepoch")) * 1000).toISOString().slice(0, 10);
    return new Response(page("Capteur test", byDay[day] ?? []));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test("récupération par fenêtres, ordre chronologique, sans doublon", async () => {
  const site = fakeSite({
    "2025-01-01": [["01/01/2025 23:50:00", ["20,1 C", "55%"]], ["01/01/2025 12:00:00", ["19,0 C", "50%"]]],
    "2025-01-02": [["02/01/2025 00:10:00", ["20,3 C", "55%"]], ["01/01/2025 23:50:00", ["20,1 C", "55%"]]],
  });
  const client = new MAClient({ vendorId: "secret", pauseMs: 0, fetchImpl: site.fetchImpl });
  const since = Date.UTC(2024, 11, 31, 23, 0); // 01/01/2025 00:00 à Paris
  const res = await client.fetchSince("07AAAAAAAAAA", since, since + 2 * 86_400_000);
  assert.equal(site.calls.length, 2);
  assert.equal(site.calls[0].searchParams.get("vendorid"), "secret");
  assert.equal(site.calls[0].searchParams.get("fromepoch"), String(Date.UTC(2025, 0, 1) / 1000 + 1));
  assert.deepEqual(res.rows.map(([t]) => new Date(t).toISOString()),
    ["2025-01-01T11:00:00.000Z", "2025-01-01T22:50:00.000Z", "2025-01-01T23:10:00.000Z"]);
  assert.equal(res.headers.length, 2);
});

test("collecte : un capteur en erreur ne bloque pas les autres", async () => {
  const calls: [string, Record<string, unknown>][] = [];
  const db: Rpc = {
    async rpc(fn, args) {
      calls.push([fn, args]);
      if (fn === "collect_targets") {
        return { data: [{ ma_id: "03BBBBBBBBBB", since: "2025-01-01T00:00:00Z" },
                        { ma_id: "07AAAAAAAAAA", since: "2025-01-01T00:00:00Z" }], error: null };
      }
      if (fn === "ingest_readings") return { data: { received: 1, inserted: 2 }, error: null };
      return { data: null, error: null };
    },
  };
  const client = {
    async fetchSince(id: string) {
      if (id.startsWith("03")) throw new Error("site indisponible");
      return { deviceName: "Salon", headers: ["T", "H"], rows: [[Date.UTC(2025, 0, 1, 1), [20, 50]]] };
    },
  } as unknown as MAClient;
  const now = Date.UTC(2025, 0, 1, 2);
  const results = await runCollect(db, client, { now });
  assert.deepEqual(results.map((r) => r.status), ["ERROR", "OK"]);
  const ingest = calls.find(([fn]) => fn === "ingest_readings")![1];
  assert.deepEqual(ingest.p_rows, [{ ts: "2025-01-01T01:00:00.000Z", v: [20, 50] }]);
  assert.equal(ingest.p_synced_until, new Date(now).toISOString());
  assert.ok(calls.some(([fn, a]) => fn === "record_sync_error" && a.p_ma_id === "03BBBBBBBBBB"));
});

test("collecte de bout en bout sur PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const { default: pg } = await import("pg");
  const conn = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await conn.connect();
  try {
    // Appel des fonctions SQL avec des arguments nommés, comme le fait l'API Supabase (PostgREST)
    const db: Rpc = {
      async rpc(fn, args) {
        const keys = Object.keys(args);
        const casts: Record<string, string> = { p_rows: "::jsonb", p_headers: "::text[]", p_lookback: "::interval" };
        const sql = `SELECT * FROM ${fn}(${keys.map((k, i) => `${k} => $${i + 1}${casts[k] ?? ""}`).join(", ")})`;
        const values = keys.map((k) => (k === "p_rows" ? JSON.stringify(args[k]) : args[k]));
        try {
          const r = await conn.query(sql, values);
          const single = r.fields.length === 1 && r.rows.length === 1 && fn !== "collect_targets";
          return { data: single ? Object.values(r.rows[0])[0] : r.rows, error: null };
        } catch (e) {
          return { data: null, error: { message: (e as Error).message } };
        }
      },
    };
    await conn.query("INSERT INTO device (ma_id, name) VALUES ('07EEEEEEEEEE', 'test node') ON CONFLICT DO NOTHING");
    const now = Date.now();
    const client = {
      async fetchSince(_id: string, since: number) {
        return { deviceName: "Station test", headers: ["Température intérieure", "Hygrométrie intérieure"],
                 rows: [[since + 60_000, [21.5, 48]]] };
      },
    } as unknown as MAClient;
    const results = await runCollect(db, client, { now, devices: ["07EEEEEEEEEE"] });
    assert.deepEqual(results, [{ ma_id: "07EEEEEEEEEE", status: "OK", received: 1, inserted: 2 }]);
    const r = await conn.query(`SELECT op.code, r.value FROM reading r JOIN device_channel c ON c.id = r.channel_id
      JOIN device d ON d.id = c.device_id JOIN observed_property op ON op.id = c.property_id
      WHERE d.ma_id = '07EEEEEEEEEE' ORDER BY c.channel_no`);
    assert.deepEqual(r.rows, [{ code: "temperature", value: 21.5 }, { code: "humidity", value: 48 }]);
  } finally {
    await conn.query("DELETE FROM device WHERE ma_id = '07EEEEEEEEEE'");
    await conn.end();
  }
});
