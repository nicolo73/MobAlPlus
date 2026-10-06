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

test("inversion : pic lent d'une pièce (cas réel du 6 octobre)", () => {
  // 12:56 → 18:39, une mesure toutes les 7 min : montée de 20,1 à 22,8 °C, puis 22,7 et 22,6
  const vals = [20.1, 20.2, 20.3, 20.3, 20.4, 20.5, 20.5, 20.6, 20.6, 20.7, 20.8, 20.9, 21.0, 21.1, 21.2, 21.3, 21.4,
    21.5, 21.6, 21.7, 21.7, 21.9, 22.0, 22.0, 22.0, 22.1, 22.2, 22.3, 22.4, 22.5, 22.5, 22.5, 22.7, 22.7, 22.7, 22.7,
    22.7, 22.7, 22.7, 22.8, 22.8, 22.8, 22.7, 22.7, 22.7, 22.7, 22.7, 22.6, 22.6, 22.6];
  const pts = vals.map((value, i) => ({ ts: i * 7 * M, value, quality: "ok" as const }));
  const t = computeTrend(pts, "temperature")!;
  assert.equal(t.reversal?.kind, "peak");
  assert.equal(t.reversal?.value, 22.8);
});

test("pas d'inversion sur une simple oscillation d'un pas", () => {
  const vals = [20.0, 20.2, 20.4, 20.6, 20.8, 21.0, 21.0, 20.9, 21.0, 20.9];
  const pts = vals.map((value, i) => ({ ts: i * 7 * M, value, quality: "ok" as const }));
  assert.equal(computeTrend(pts, "temperature")!.reversal, undefined);
});
