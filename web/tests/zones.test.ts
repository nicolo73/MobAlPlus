import { test } from "node:test";
import assert from "node:assert/strict";
import { trendTone, zoneOf } from "../src/lib/zones.ts";

const r = (kind: "above" | "below" | "peak", level: "info" | "warning", threshold: number | null) =>
  ({ series_id: 1, kind, level, threshold, enabled: true });
// Congélateur-type : info au-dessus de 22, important au-dessus de 25, info en dessous de 16, important en dessous de 12
const rules = [r("above", "info", 22), r("above", "warning", 25), r("below", "info", 16), r("below", "warning", 12), r("peak", "warning", null)];

test("zone d'une valeur d'après les seuils haut / bas", () => {
  assert.equal(zoneOf(26, rules), "hot2");
  assert.equal(zoneOf(23, rules), "hot1");
  assert.equal(zoneOf(22, rules), null);           // seuil non dépassé
  assert.equal(zoneOf(19, rules), null);
  assert.equal(zoneOf(15, rules), "cold1");
  assert.equal(zoneOf(11, rules), "cold2");
  assert.equal(zoneOf(30, [r("peak", "warning", null)]), null);   // pic : ne compte pas
  assert.equal(zoneOf(30, [r("above", "warning", 25)]), "hot2");  // un seul niveau réglé
});

test("ton de la flèche : aggravation ou retour vers la normale", () => {
  const up = { level: 2, slope: 0.5 }, down = { level: -1, slope: -0.2 };
  assert.equal(trendTone(21.5, up, rules, "temperature"), "worse-hot");   // proche du seuil haut, monte
  assert.equal(trendTone(19, up, rules, "temperature"), null);            // loin des seuils
  assert.equal(trendTone(21.5, down, rules, "temperature"), null);        // redescend
  assert.equal(trendTone(15, down, rules, "temperature"), "worse-cold");  // trop froid, baisse encore
  const peak = { level: -1, slope: -0.3, reversal: { kind: "peak" as const, ts: 0, value: 23 } };
  const trough = { level: 1, slope: 0.3, reversal: { kind: "trough" as const, ts: 0, value: 14 } };
  assert.equal(trendTone(22.8, peak, rules, "temperature"), "better");    // pic passé en zone chaude
  assert.equal(trendTone(14.5, trough, rules, "temperature"), "better");  // creux passé en zone froide
  assert.equal(trendTone(19, peak, rules, "temperature"), null);
  assert.equal(trendTone(21.5, up, [], "temperature"), null);             // pas de seuil
  // En alerte, la tendance ramène vers la normale : verte
  assert.equal(trendTone(15, up, rules, "temperature"), "better");        // trop froid, remonte
  assert.equal(trendTone(23, down, rules, "temperature"), "better");      // trop chaud, redescend
  assert.equal(trendTone(16.5, up, rules, "temperature"), null);          // proche du seuil bas, sans alerte
});
