import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTrend } from "../src/lib/trend.ts";

const M = 60_000;
/** Une mesure toutes les 7 minutes, valeur donnée par f(minutes) arrondie au dixième */
function series(minutes: number, f: (m: number) => number) {
  const out = [];
  for (let m = 0; m <= minutes; m += 7) out.push({ ts: m * M, value: Math.round(f(m) * 10) / 10, quality: "ok" as const });
  return out;
}

test("stable", () => {
  const t = computeTrend(series(24 * 60, () => 20), "temperature")!;
  assert.equal(t.level, 0);
  assert.equal(t.reversal, undefined);
});

test("hausse forte et hausse légère selon l'amplitude du jour", () => {
  // amplitude du jour 10 °C ; dernière heure +1,5 °C/h : 15 % de l'amplitude par heure
  const strong = computeTrend(series(24 * 60, (m) => (m < 23 * 60 ? 10 + (m % 600 < 300 ? 0 : 10) : 15 + (m - 23 * 60) / 40)), "temperature")!;
  assert.equal(strong.level, 3);
  // amplitude du jour 4 °C (creux à 16 °C la nuit) ; +0,2 °C/h : 5 %
  const slight = computeTrend(series(24 * 60, (m) => (m < 120 ? 16 : 20 + Math.max(0, m - 23 * 60) / 300)), "temperature")!;
  assert.equal(slight.level, 1);
});

test("baisse : niveau négatif", () => {
  const t = computeTrend(series(24 * 60, (m) => 25 - m / 300), "temperature")!;
  assert.ok(t.level < 0);
  assert.ok(t.slope < -0.1);
});

test("inversion : pic passé il y a 40 min", () => {
  // montée jusqu'à 23 h 20 puis baisse
  const peakAt = 24 * 60 - 40;
  const t = computeTrend(series(24 * 60, (m) => (m <= peakAt ? 20 + (m - peakAt + 120) / 60 : 22 - (m - peakAt) / 60)), "temperature")!;
  assert.equal(t.reversal?.kind, "peak");
  assert.ok(Math.abs(t.reversal!.ts - peakAt * M) <= 7 * M);
});

test("inversion : creux, et pas d'inversion sous le seuil", () => {
  const lowAt = 24 * 60 - 30;
  const trough = computeTrend(series(24 * 60, (m) => 15 + Math.abs(m - lowAt) / 60), "temperature")!;
  assert.equal(trough.reversal?.kind, "trough");
  const small = computeTrend(series(24 * 60, (m) => 15 + Math.abs(m - lowAt) / 600), "temperature")!;
  assert.equal(small.reversal, undefined);
});

test("pas d'inversion quand le pic est trop ancien", () => {
  const peakAt = 24 * 60 - 300;
  const t = computeTrend(series(24 * 60, (m) => 20 - Math.abs(m - peakAt) / 60), "temperature")!;
  assert.equal(t.reversal, undefined);
  assert.ok(t.level < 0);
});
