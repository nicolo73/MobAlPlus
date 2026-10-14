import { test } from "node:test";
import assert from "node:assert/strict";
import { usageTree } from "../src/lib/dbusage.ts";
import type { DbChannelUsage, DbUsage } from "../src/lib/types.ts";

const ch = (o: Partial<DbChannelUsage>): DbChannelUsage => ({
  channel_id: 1, channel_no: 1, property: "temperature", device_id: 1, device_name: "Capteur", vendor: null, active: true,
  home_id: 1, place_id: 10, place_name: "Salon", n_detail: 0, n_compact: 0, n_simplified: 0,
  detail: 0, compact: 0, simplified: 0, weather: 0, ...o,
});

test("occupation par maison, emplacement et capteur ; stations publiques et maisons qui les suivent ; base générale", () => {
  const u: DbUsage = {
    total_bytes: 10_000, quota_mb: 500, info_pct: 40, warning_pct: 70, tables: {}, alert: null,
    homes: [{ id: 1, name: "Ma maison", commons: false, owners: ["a@ex.fr"] }, { id: 2, name: "Chez Paul", commons: false, owners: [] },
            { id: 9, name: "Données publiques", commons: true, owners: [] }],
    links: [{ place_id: 20, home_id: 1 }, { place_id: 20, home_id: 2 }],
    channels: [
      ch({ channel_id: 1, detail: 1000, compact: 500 }),
      ch({ channel_id: 2, channel_no: 2, property: "humidity", detail: 800, compact: 400 }),   // même capteur : une ligne
      ch({ channel_id: 3, device_id: 2, place_id: 11, place_name: "Cave", detail: 300 }),
      ch({ channel_id: 4, device_id: 3, home_id: 2, place_id: 12, place_name: "Séjour", compact: 2000 }),
      ch({ channel_id: 5, device_id: 4, home_id: 9, place_id: 20, place_name: "Météo · Paris", detail: 600, weather: 400 }),
    ],
  };
  const t = usageTree(u);
  assert.deepEqual(t.groups.map((g) => [g.label, g.sizes.total]), [
    ["Ma maison", 3000], ["Chez Paul", 2000], ["Données publiques (stations partagées)", 1000]]);
  assert.equal(t.groups[0].sub, "a@ex.fr");
  assert.deepEqual(t.groups[0].children.map((r) => [r.label, r.sizes.total, r.sizes.detail]), [["Salon", 2700, 1800], ["Cave", 300, 300]]);
  assert.equal(t.groups[2].children[0].sub, "suivie par : Ma maison, Chez Paul");
  assert.equal(t.attributed, 6000);
  assert.equal(t.general.sizes.total, 4000);
});
