import { test } from "node:test";
import assert from "node:assert/strict";
import { LONGVIEW_DEFAULTS as O, averageBands, bandMain, gapThreshold, ghostLevel, gridLines, needs, normLongView, scaleOf, weeklyBands } from "../src/lib/longview.ts";

const H = 3_600_000, D = 24 * H;
const NOW = Date.UTC(2026, 9, 10, 12);

test("passage progressif courbe → bande (3, 7, 30 jours par défaut)", () => {
  const w = (days: number) => [NOW - days * D, NOW] as [number, number];
  assert.deepEqual(needs(w(2), O), { raw: true, band: false });
  assert.deepEqual(needs(w(5), O), { raw: true, band: true });
  assert.deepEqual(needs(w(60), O), { raw: false, band: true });
  assert.ok(!bandMain(w(5), O) && bandMain(w(10), O));
  assert.equal(ghostLevel(w(3), O), 0);            // bande à peine visible
  assert.equal(ghostLevel(w(5), O), 0.5);
  assert.equal(ghostLevel(w(7), O), 1);            // bande pleinement là, courbe encore nette
  assert.equal(ghostLevel(w(18.5), O), 0.5);       // courbe à moitié effacée
  assert.equal(ghostLevel(w(30), O), 0);
  // Seuils incohérents : remis dans l'ordre
  assert.deepEqual(normLongView({ bandFrom: 10, bandFull: 5, rawUntil: -1 }), { bandFrom: 10, bandFull: 10, rawUntil: 30 });
});

test("seuil d'interruption : tient compte de la réduction des points et de la fenêtre", () => {
  // 24 h affichées, 72 h chargées : seuil « capteur muet » (3 h)
  assert.equal(gapThreshold(3 * H, [NOW - 3 * D, NOW], [NOW - D, NOW]), 3 * H);
  // 30 jours affichés, 90 jours chargés, 1000 points : intervalles de ~4,3 h → pas de fausse coupure
  const t = gapThreshold(3 * H, [NOW - 90 * D, NOW], [NOW - 30 * D, NOW]);
  assert.ok(t >= 2.5 * (90 * D / 500));
  assert.ok(t >= 30 * D / 40);
});

test("repères verticaux : jour, semaine, mois, année", () => {
  assert.equal(scaleOf([NOW - 7 * D, NOW]), "day");
  assert.equal(scaleOf([NOW - 30 * D, NOW]), "week");
  assert.equal(scaleOf([NOW - 365 * D, NOW]), "month");
  assert.equal(scaleOf([NOW - 3 * 365 * D, NOW]), "year");
  const weeks = gridLines(NOW - 30 * D, NOW, "week");
  assert.ok(weeks.length >= 4 && weeks.length <= 5);
  assert.ok(weeks.every((t) => new Date(t).getDay() === 1 && new Date(t).getHours() === 0));
  const months = gridLines(NOW - 365 * D, NOW, "month");
  assert.equal(months.length, 12);
  assert.ok(months.every((t) => new Date(t).getDate() === 1));
});

test("bande moyenne d'un groupe", () => {
  const a = [{ ts: 1, min: 10, max: 20, avg: 15 }, { ts: 2, min: 12, max: 22, avg: 17 }];
  const b = [{ ts: 1, min: 14, max: 24, avg: 19 }];
  assert.deepEqual(averageBands([a, b]), [{ ts: 1, min: 12, max: 22, avg: 17 }, { ts: 2, min: 12, max: 22, avg: 17 }]);
});

test("bandes hebdomadaires : moyennes des minimums et maximums, au jeudi midi", () => {
  // Lundi 5 → dimanche 11 oct. 2026, puis lundi 12
  const day = (d: number, min: number, max: number) => ({ ts: new Date(2026, 9, d, 12).getTime(), min, max, avg: (min + max) / 2 });
  const w = weeklyBands([day(5, 10, 20), day(8, 12, 22), day(11, 14, 18), day(12, 0, 10)]);
  assert.equal(w.length, 2);
  assert.equal(w[0].ts, new Date(2026, 9, 8, 12).getTime());
  assert.equal(w[0].min, 12);
  assert.equal(w[0].max, 20);
  assert.equal(w[1].min, 0);
});
