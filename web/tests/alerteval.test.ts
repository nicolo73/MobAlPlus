import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRule } from "../src/lib/alerteval.ts";

const M = 60_000;
const pts = (vals: number[], step = 10) => vals.map((value, i) => ({ ts: i * step * M, value, quality: "ok" as const }));

test("dépassement de seuil : début, valeur extrême, fin avec hystérésis", () => {
  const ev = evaluateRule(pts([21, 22, 22.5, 23, 22.6, 22, 21.95, 21.9, 23.2]),
    { kind: "above", level: "warning", threshold: 22, enabled: true }, "temperature");
  assert.equal(ev.length, 2);
  assert.deepEqual([ev[0].started_at, ev[0].value, ev[0].ended_at], [20 * M, 23, 70 * M]);
  assert.equal(ev[1].ended_at, null);
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
