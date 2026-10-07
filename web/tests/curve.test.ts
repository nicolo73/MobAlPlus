import { test } from "node:test";
import assert from "node:assert/strict";
import { curveData, valueAt } from "../src/lib/curve.ts";

const pts = (...vals: [number, number][]) => vals.map(([ts, value]) => ({ ts, value, quality: "raw" as const }));

test("escalier : toutes les mesures, sans les valeurs rejetées", () => {
  const p = [...pts([0, 18.2], [10, 18.3]), { ts: 20, value: 99, quality: "rejected" as const }];
  assert.deepEqual(curveData(p, "step"), [[0, 18.2], [10, 18.3]]);
});

test("simplifié : un point au milieu de chaque palier", () => {
  const p = pts([0, 18.2], [10, 18.2], [20, 18.2], [40, 18.3], [50, 18.3], [60, 18.4]);
  // paliers 18,2 de 0 à 40 (milieu 20), 18,3 de 40 à 60 (milieu 50), 18,4 en dernier point
  assert.deepEqual(curveData(p, "simple"), [[0, 18.2], [20, 18.2], [50, 18.3], [60, 18.4]]);
});

test("simplifié : un pic isolé est conservé", () => {
  const p = pts([0, 20], [10, 20], [20, 25], [30, 20], [40, 20]);
  const d = curveData(p, "simple");
  assert.ok(d.some(([, v]) => v === 25));
  assert.deepEqual(d, [[0, 20], [10, 20], [25, 25], [35, 20], [40, 20]]);
});

test("coupure sur les longues absences de mesure", () => {
  const p = pts([0, 1], [10, 1], [1000, 2], [1010, 2]);
  assert.deepEqual(curveData(p, "simple", 100), [[0, 1], [5, 1], [10, 1], [11, null], [1000, 2], [1005, 2], [1010, 2]]);
});

test("valeur d'une courbe à un instant (infobulle)", () => {
  const d = curveData(pts([0, 10], [600, 20], [1200, 30]), "step");
  assert.equal(valueAt(d, -1, false), null);          // avant la courbe
  assert.equal(valueAt(d, 300, false), 10);           // escalier : dernière mesure
  assert.equal(valueAt(d, 300, true), 15);            // lissé : interpolation
  assert.equal(valueAt(d, 1200 + 60_000, true), 30);  // juste après la dernière mesure
  assert.equal(valueAt(d, 1200 + 3_600_000, true), null);
  const cut = curveData(pts([0, 1], [10, 1], [1000, 2]), "step", 100);
  assert.equal(valueAt(cut, 500, false), null);       // dans une coupure
});
