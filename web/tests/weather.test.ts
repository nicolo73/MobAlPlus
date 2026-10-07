import { test } from "node:test";
import assert from "node:assert/strict";

// Fonctions pures de lecture des réponses Open-Meteo
const { parseHourly, merge } = await import("../src/lib/weather-parse.ts");

test("réponse horaire Open-Meteo → points (heures UTC)", () => {
  const s = parseHourly({ hourly: { time: ["2026-10-07T00:00", "2026-10-07T01:00"], temperature_2m: [8.4, null], relative_humidity_2m: [91, 92] } });
  assert.deepEqual(s.temperature, [{ ts: Date.UTC(2026, 9, 7, 0), value: 8.4, quality: "ok" }]);
  assert.equal(s.humidity.length, 2);
});

test("fusion des réponses archives + récentes", () => {
  const a = { temperature: [1, 2, 3].map((h) => ({ ts: h, value: h, quality: "ok" as const })), humidity: [] };
  const b = { temperature: [3, 4].map((h) => ({ ts: h, value: h * 10, quality: "ok" as const })), humidity: [] };
  assert.deepEqual(merge([a, b], 2, 4).temperature.map((p) => p.value), [2, 30, 40]);
});
