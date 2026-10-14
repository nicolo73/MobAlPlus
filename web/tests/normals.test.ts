import { test } from "node:test";
import assert from "node:assert/strict";
import { mdOf, normalAt, normalBands, type NormalDay } from "../src/lib/normals.ts";

const D = 86_400_000;
const days: NormalDay[] = [{ md: 228, min: 1, max: 9 }, { md: 229, min: 1.5, max: 9.5 }, { md: 301, min: 2, max: 10 }];

test("normale du jour d'un instant (heure locale)", () => {
  assert.equal(mdOf(new Date(2026, 9, 14, 23, 30).getTime()), 1014);
  assert.deepEqual(normalAt(days, new Date(2026, 2, 1, 8).getTime()), { md: 301, min: 2, max: 10 });
  assert.equal(normalAt(days, new Date(2026, 5, 1).getTime()), null);
  assert.equal(normalAt(undefined, Date.now()), null);
});

test("normales dépliées sur une période : un point à midi par jour, 29 février les années bissextiles seulement", () => {
  const b = normalBands(days, new Date(2027, 1, 28, 6).getTime(), new Date(2027, 2, 1, 6).getTime());
  assert.deepEqual(b.map((x) => new Date(x.ts).getDate()), [28, 1]);   // 2027 : pas de 29 février
  assert.equal(new Date(b[0].ts).getHours(), 12);
  assert.deepEqual([b[1].min, b[1].max, b[1].avg], [2, 10, 6]);
  const leap = normalBands(days, new Date(2028, 1, 28).getTime(), new Date(2028, 2, 1).getTime());
  assert.deepEqual(leap.map((x) => x.min), [1, 1.5, 2]);
  assert.deepEqual(normalBands(days, 10 * D, 5 * D), []);
});
