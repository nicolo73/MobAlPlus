import { test } from "node:test";
import assert from "node:assert/strict";
import { followsNow, loadRange, needsReload } from "../src/lib/period.ts";

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
