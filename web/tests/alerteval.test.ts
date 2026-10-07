import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRule } from "../src/lib/alerteval.ts";

const M = 60_000;
const pts = (vals: number[], step = 10) => vals.map((value, i) => ({ ts: i * step * M, value, quality: "ok" as const }));

test("dépassement de seuil : début, valeur extrême, fin avec hystérésis", () => {
  const ev = evaluateRule(pts([21, 22, 22.5, 23, 22.6, 22, 21.95, 21.9, 23.2]),
    { kind: "above", level: "warning", threshold: 22, enabled: true }, "temperature");
  // fermée à 21,9 (70 min), refranchie 10 min plus tard : la même alerte est rouverte
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].started_at, ev[0].value, ev[0].ended_at], [20 * M, 23.2, null]);
});

test("seuil bas", () => {
  const ev = evaluateRule(pts([5, 3, 2, 4, 6]), { kind: "below", level: "info", threshold: 3.5, enabled: true }, "temperature");
  assert.deepEqual(ev.map((e) => [e.started_at, e.value]), [[10 * M, 2]]);
});

test("pic lent (cas réel) et pas de pic sur une oscillation", () => {
  const rise = Array.from({ length: 29 }, (_, i) => 20 + i / 10);
  const peak = evaluateRule(pts([...rise, 22.8, 22.8, 22.7, 22.7, 22.6, 22.6]),
    { kind: "peak", level: "warning", threshold: null, enabled: true }, "temperature");
  assert.equal(peak.length, 1);
  assert.equal(peak[0].value, 22.8);
  assert.equal(peak[0].started_at, 30 * 10 * M);
  const flat = evaluateRule(pts([20, 20.2, 20.4, 20.6, 20.6, 20.5, 20.6, 20.5]),
    { kind: "peak", level: "warning", threshold: null, enabled: true }, "temperature");
  assert.equal(flat.length, 0);
});

test("une alerte par franchissement, même si la valeur oscille autour du seuil", () => {
  const rule = { kind: "above" as const, level: "warning" as const, threshold: 25, enabled: true };
  const ev = evaluateRule(pts([24.5, 25.1, 25.3, 24.9, 25.2, 24.8, 25.1, 25.4, 24, 23.5]), rule, "temperature");
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].started_at, ev[0].ended_at, ev[0].value], [10 * M, 80 * M, 25.4]);
  // nouveau franchissement 2 h plus tard : nouvelle alerte
  const two = evaluateRule(pts([25.5, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 25.5]), rule, "temperature");
  assert.equal(two.length, 2);
});

test("capteur muet : silences de plus de N heures, en cours jusqu'à maintenant", () => {
  const H = 60 * M;
  const p = [0, 10, 20, 400, 410].map((m) => ({ ts: m * M, value: 20, quality: "ok" as const }));
  const ev = evaluateRule(p, { kind: "silent", level: "warning", threshold: 3, enabled: true }, "temperature", 410 * M + 4 * H);
  assert.deepEqual(ev.map((e) => [e.started_at, e.ended_at]), [[20 * M, 400 * M], [410 * M, null]]);
});
