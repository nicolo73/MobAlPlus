import { test } from "node:test";
import assert from "node:assert/strict";

// localStorage minimal (Node)
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v),
  get length() { return store.size; }, key: (i: number) => [...store.keys()][i] ?? null,
};
const { addDashboard, allDashboards, getDashboard, listDashboards, removeDashboard, replaceDashboards, setDashboardsSaveHook,
        updateDashboard } = await import("../src/lib/dashboards.ts");

test("première synthèse : reprise de l'ancien réglage de la page Courbes", () => {
  store.set("mobalplus.charts.1", JSON.stringify({ slots: { 4: 0, "-10": 1 }, width: 7 * 86_400_000 }));
  const [d] = listDashboards(1);
  assert.equal(d.name, "Synthèse");
  assert.deepEqual(d.slots, { 4: 0, "-10": 1 });
  assert.equal(d.width, 7 * 86_400_000);
});

test("ajout, réglage, suppression ; il en reste toujours une", () => {
  const id = addDashboard(1);
  assert.equal(listDashboards(1).length, 2);
  assert.equal(getDashboard(1, id).name, "Synthèse 2");
  updateDashboard(1, id, { name: "Chambres", slots: { 3: 0 } });
  assert.equal(getDashboard(1, id).name, "Chambres");
  assert.equal(getDashboard(1, "inconnue").name, "Synthèse");     // inconnue : la première
  const next = removeDashboard(1, id);
  assert.equal(next, "principale");
  assert.equal(listDashboards(1).length, 1);
  assert.equal(removeDashboard(1, "principale"), "principale");  // la dernière reste
  assert.equal(listDashboards(1).length, 1);
});

test("synthèses du compte : toutes les maisons, remplacement, enregistrement signalé", () => {
  let saved = 0;
  setDashboardsSaveHook(() => saved++);
  updateDashboard(1, "principale", { hidden: ["humidity"], weather: false });
  assert.equal(saved, 1);
  assert.deepEqual(allDashboards()["1"][0].hidden, ["humidity"]);
  // Reçues du compte (autre appareil) : remplacent, sans renvoyer au compte
  replaceDashboards({ 2: [{ id: "a", name: "Chalet", slots: {}, width: 1 }], 3: "invalide" });
  assert.equal(saved, 1);
  assert.equal(listDashboards(2)[0].name, "Chalet");
  assert.equal(listDashboards(3)[0].name, "Synthèse");
});
