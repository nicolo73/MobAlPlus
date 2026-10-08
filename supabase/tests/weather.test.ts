import { test } from "node:test";
import assert from "node:assert/strict";
import { rowsOf, runWeather } from "../functions/weather/handler.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 7, 10, 20);

test("réponse Open-Meteo → lignes de mesures (heures UTC, conditions actuelles)", () => {
  const rows = rowsOf({
    hourly: { time: ["2026-10-07T09:00", "2026-10-07T10:00"], temperature_2m: [12.1, 12.6], relative_humidity_2m: [80, null] },
    current: { time: "2026-10-07T10:15", temperature_2m: 12.8, relative_humidity_2m: 78 },
  });
  assert.deepEqual(rows, [
    { ts: "2026-10-07T09:00:00.000Z", v: [12.1, 80] },
    { ts: "2026-10-07T10:00:00.000Z", v: [12.6, null] },
    { ts: "2026-10-07T10:15:00.000Z", v: [12.8, 78] },
  ]);
});

test("collecte : archives pour l'historique, mesures récentes, puis prévision des heures futures", async () => {
  const urls: string[] = [];
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const db = {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "weather_targets") {
        return { data: [{ ma_id: "METEO-AB", lat: 43.6, lon: 1.44, since: new Date(NOW - 365 * DAY).toISOString() }], error: null };
      }
      return fn === "store_forecast" ? { data: 2, error: null } : { data: { received: 3, inserted: 3 }, error: null };
    },
  };
  const res = await runWeather(db, async (url) => {
    urls.push(url);
    return url.includes("archive")
      ? { hourly: { time: ["2025-10-08T00:00"], temperature_2m: [9], relative_humidity_2m: [90] } }
      : { hourly: { time: ["2026-10-07T10:00", "2026-10-07T11:00"], temperature_2m: [12, 13], relative_humidity_2m: [80, 79] },
          current: { time: "2026-10-07T10:15", temperature_2m: 12.3, relative_humidity_2m: 79 } };
  }, NOW);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /archive-api.*start_date=2025-10-07/);
  assert.match(urls[1], /forecast.*past_days=81&forecast_days=7/);
  const ingest = calls.find((c) => c.fn === "ingest_readings")!;
  assert.deepEqual((ingest.args!.p_rows as { ts: string }[]).map((r) => r.ts),
    ["2025-10-08T00:00:00.000Z", "2026-10-07T10:00:00.000Z", "2026-10-07T10:15:00.000Z"]);  // 11:00 = prévision
  const fc = calls.find((c) => c.fn === "store_forecast")!;
  assert.deepEqual(fc.args!.p_rows, [{ ts: "2026-10-07T11:00:00.000Z", v: [13, 79] }]);   // heures à venir seulement
  assert.deepEqual(res, [{ station: "METEO-AB", received: 3, inserted: 3, forecast: 2 }]);
});

test("collecte : une erreur est enregistrée pour la station, sans arrêter les autres", async () => {
  const calls: string[] = [];
  const db = {
    rpc: async (fn: string) => {
      calls.push(fn);
      return fn === "weather_targets"
        ? { data: [{ ma_id: "METEO-A", lat: 1, lon: 1, since: new Date(NOW - DAY).toISOString() },
                   { ma_id: "METEO-B", lat: 2, lon: 2, since: new Date(NOW - DAY).toISOString() }], error: null }
        : { data: { received: 0, inserted: 0 }, error: null };
    },
  };
  let n = 0;
  const res = await runWeather(db, async () => { if (n++ === 0) throw new Error("Open-Meteo 429"); return {}; }, NOW);
  assert.equal(res[0].error, "Open-Meteo 429");
  assert.equal(res[1].error, undefined);
  assert.ok(calls.includes("record_sync_error"));
});
