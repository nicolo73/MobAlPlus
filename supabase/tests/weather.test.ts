import { test } from "node:test";
import assert from "node:assert/strict";
import { computeNormals, rowsOf, runNormals, runWeather, type NormalRow } from "../functions/weather/handler.ts";

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

test("normales : moyenne par jour de l'année des min / max journaliers, lissée, sur 366 jours", () => {
  // 3 années : chaque jour, min = 5 et max = 15 (température), humidité 60 – 90 ; une valeur absente
  const time: string[] = [], tmin: (number | null)[] = [], tmax: number[] = [], hmin: number[] = [], hmax: number[] = [];
  for (let t = Date.UTC(1991, 0, 1); t < Date.UTC(1994, 0, 1); t += DAY) {
    time.push(new Date(t).toISOString().slice(0, 10)); tmin.push(5); tmax.push(15); hmin.push(60); hmax.push(90);
  }
  tmin[10] = null;
  const rows = computeNormals({ daily: { time, temperature_2m_min: tmin, temperature_2m_max: tmax,
                                         relative_humidity_2m_min: hmin, relative_humidity_2m_max: hmax } });
  assert.equal(rows.length, 366);
  assert.deepEqual(rows[0], { md: 101, min: [5, 60], max: [15, 90] });
  assert.equal(rows.find((r) => r.md === 229)?.md, 229);   // 29 février (aucune année bissextile : lissage)
  assert.deepEqual(rows.find((r) => r.md === 229)?.min, [5, 60]);
  assert.equal(rows.at(-1)!.md, 1231);
});

test("normales : le lissage efface les écarts d'un jour isolé", () => {
  const time: string[] = [], v: number[] = [];
  for (let t = Date.UTC(2001, 0, 1); t < Date.UTC(2002, 0, 1); t += DAY) { time.push(new Date(t).toISOString().slice(0, 10)); v.push(10); }
  v[180] = 31;   // un jour à 31 (au lieu de 10) : +1 sur la moyenne des 21 jours autour
  const rows = computeNormals({ daily: { time, temperature_2m_min: v, temperature_2m_max: v } });
  const md = (Number(time[180].slice(5, 7)) * 100 + Number(time[180].slice(8, 10)));
  assert.equal(rows.find((r) => r.md === md)!.max[0], 11);
  assert.equal(rows[0].max[0], 10);
  assert.deepEqual(rows[0].min, [10, null]);   // pas d'humidité dans la réponse
});

test("normales : une station sans normales, archives 1991 – 2020, enregistrement", async () => {
  const urls: string[] = [];
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const db = {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "normals_targets") return { data: [{ ma_id: "METEO-AB", lat: 43.6, lon: 1.44 }], error: null };
      return { data: 732, error: null };
    },
  };
  const res = await runNormals(db, async (url) => {
    urls.push(url);
    return { daily: { time: ["1991-01-01"], temperature_2m_min: [2], temperature_2m_max: [9],
                      relative_humidity_2m_min: [70], relative_humidity_2m_max: [95] } };
  });
  assert.match(urls[0], /archive-api.*latitude=43\.6&longitude=1\.44.*daily=temperature_2m_min.*start_date=1991-01-01&end_date=2020-12-31/);
  const store = calls.find((c) => c.fn === "store_normals")!;
  assert.equal(store.args!.p_period, "1991-2020");
  assert.ok((store.args!.p_rows as NormalRow[]).length > 0);
  assert.deepEqual(res, { station: "METEO-AB", normals: 732 });
});

test("normales : rien à faire, ou erreur rapportée sans exception", async () => {
  const none = { rpc: async () => ({ data: [], error: null }) };
  assert.equal(await runNormals(none, async () => ({})), null);
  const one = { rpc: async () => ({ data: [{ ma_id: "METEO-X", lat: 1, lon: 1 }], error: null }) };
  const res = await runNormals(one, async () => { throw new Error("Open-Meteo 429 : trop de requêtes"); });
  assert.deepEqual(res, { station: "METEO-X", normals: 0, error: "normales : Open-Meteo 429 : trop de requêtes" });
});
