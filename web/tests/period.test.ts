import { test } from "node:test";
import assert from "node:assert/strict";
import { barRange, followsNow, loadRange, needsReload, needsRescale, shiftWindow } from "../src/lib/period.ts";

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 8, 12);

test("période chargée : une largeur de part et d'autre, jamais au-delà de maintenant", () => {
  assert.deepEqual(loadRange([NOW - 48 * H, NOW - 24 * H], NOW), [NOW - 72 * H, NOW]);
  assert.deepEqual(loadRange([NOW - 24 * H, NOW], NOW), [NOW - 48 * H, NOW + 5 * 60_000]);
});

test("fenêtre glissée dans le futur (prévisions) : les mesures récentes restent chargées", () => {
  const [s, e] = loadRange([NOW + 48 * H, NOW + 72 * H], NOW);
  assert.ok(s < e);
  assert.equal(e, NOW + 5 * 60_000);
  assert.equal(s, NOW + 5 * 60_000 - 48 * H);
  assert.equal(needsReload([NOW + 48 * H, NOW + 72 * H], [s, e], NOW), false);
});

test("fenêtre qui suit maintenant", () => {
  assert.ok(followsNow([NOW - 24 * H, NOW - 5 * 60_000], NOW));
  assert.ok(!followsNow([NOW - 48 * H, NOW - 24 * H], NOW));
  assert.ok(!followsNow([NOW, NOW + 24 * H], NOW));   // glissée dans le futur : on la laisse
});

test("barre de glissement : la fenêtre en occupe ½ à ¾, et elle s'étend quand on atteint un bord", () => {
  const w: [number, number] = [NOW - 48 * H, NOW - 24 * H];
  const bar = barRange(w, NOW);
  assert.deepEqual(bar, [NOW - 56 * H, NOW - 16 * H]);                       // 24 h sur 40 h : 60 %
  assert.ok(!needsRescale(w, bar, NOW));
  // Poignée gauche amenée contre le bord : la barre doit s'élargir
  assert.ok(needsRescale([NOW - 56 * H, NOW - 24 * H], bar, NOW));
  // Fenêtre très réduite : la barre se remet à l'échelle
  assert.ok(needsRescale([NOW - 30 * H, NOW - 28 * H], bar, NOW));
  // Calée sur maintenant : 75 %, bord droit = limite, pas de recalcul
  const atNow: [number, number] = [NOW - 24 * H, NOW];
  assert.deepEqual(barRange(atNow, NOW), [NOW - 32 * H, NOW]);
  assert.ok(!needsRescale(atNow, barRange(atNow, NOW), NOW));
});

test("période précédente / suivante, sans dépasser maintenant", () => {
  assert.deepEqual(shiftWindow([NOW - 24 * H, NOW], -1, NOW), [NOW - 48 * H, NOW - 24 * H]);
  assert.deepEqual(shiftWindow([NOW - 30 * H, NOW - 6 * H], 1, NOW), [NOW - 24 * H, NOW]);
});
