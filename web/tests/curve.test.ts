import { test } from "node:test";
import assert from "node:assert/strict";
import { curveData } from "../src/lib/curve.ts";

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
