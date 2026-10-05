import { test } from "node:test";
import assert from "node:assert/strict";
import { averagePoints, flatten, isWithin, placeTree } from "../src/lib/placetree.ts";

const place = (id: number, name: string, parent_id: number | null = null) =>
  ({ id, code: "", name, parent_id, kind: null, exposure: null });
const serie = (id: number, place_id: number) =>
  ({ id, name: "", place_id, place_name: "", exposure: null, property: "temperature", property_name: "Température", unit: "°C" });
const pts = (...v: [number, number][]) => v.map(([ts, value]) => ({ ts, value, quality: "ok" as const }));

test("arbre : parents, sous-emplacements, emplacements mesurés de chaque branche", () => {
  const tree = placeTree(
    [place(1, "Jardin"), place(2, "Est", 1), place(3, "Ouest", 1), place(4, "Salon"), place(5, "Abri", 1)],
    [serie(10, 2), serie(11, 3), serie(12, 4)],
  );
  assert.deepEqual(tree.map((n) => n.name), ["Jardin", "Salon"]);
  assert.deepEqual(tree[0].children.map((n) => n.name), ["Abri", "Est", "Ouest"]);
  assert.deepEqual(tree[0].measured, [2, 3]);
  assert.equal(tree[0].series.length, 0);
  assert.deepEqual(flatten(tree).map((n) => [n.name, n.depth]),
    [["Jardin", 0], ["Abri", 1], ["Est", 1], ["Ouest", 1], ["Salon", 0]]);
});

test("moyenne : dernières valeurs connues de chaque courbe", () => {
  const avg = averagePoints([pts([0, 10], [20, 12]), pts([10, 20])]);
  assert.deepEqual(avg.map((p) => [p.ts, p.value]), [[0, 10], [10, 15], [20, 16]]);
});

test("moyenne : une courbe muette trop longtemps est ignorée", () => {
  const avg = averagePoints([pts([0, 10], [100, 10]), pts([0, 20])], 50);
  assert.deepEqual(avg.map((p) => [p.ts, p.value]), [[0, 15], [100, 10]]);
});

test("ordre choisi puis nom ; détection des sous-emplacements", () => {
  const ps = [{ ...place(1, "B"), sort_order: 2 }, { ...place(2, "A"), sort_order: 2 }, { ...place(3, "Z", 1), sort_order: 1 }];
  assert.deepEqual(placeTree(ps, []).map((n) => n.name), ["A", "B"]);
  assert.equal(isWithin(ps, 3, 1), true);
  assert.equal(isWithin(ps, 1, 3), false);
  assert.equal(isWithin(ps, null, 1), false);
});
