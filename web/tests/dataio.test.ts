import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, mergePlans } from "../src/lib/dataio.ts";

// Onglet d'ancien tableur Mobile Alerts (export des Google Sheets) : identifiant fictif
const sheet = (name: string, columns: string, rows: unknown[][]) => ({
  name,
  rows: [
    ["Device ID", "from Date", "to Date", "columns", "rowStart"],
    ["07AAAAAAAAAA", "2026-10-06 20:59:21", "=NOW() +1", columns, 131707],
    ["01-Salon Mesures"],
    ["Status", "Nb Measures", "Messages"],
    ["FINISHED", 1, ""],
    ["Columns:", "Temp&#233;rature int&#233;rieure", "Hygrom&#233;trie int&#233;rieure", "Temp&#233;rature ext&#233;rieure", "Hygrom&#233;trie ext&#233;rieure"],
    ["Date", "Temp", "Hygro"],
    ...rows,
  ],
});
const devices = [{ id: 1, ma_id: "07AAAAAAAAAA", channels: [1, 2, 3, 4].map((no) => ({ id: 10 + no, channel_no: no })) }];

test("ancien tableur : colonnes du capteur, heure de Paris, dates Excel arrondies à la seconde", () => {
  const plan = buildPlan([
    { name: "Config", rows: [["WebSite", "https://exemple"]] },
    // Date Excel lue avec une erreur d'arrondi (18,999 s), valeurs numériques
    sheet("01-Salon", "1;2", [[new Date(Date.UTC(2025, 0, 1, 4, 25, 18, 999)), 20, 53]]),
    sheet("01-Ext", "3;4", [[new Date(Date.UTC(2025, 0, 1, 0, 6, 15)), 4.5, 94], [new Date(Date.UTC(2025, 0, 1, 0, 13, 9)), "4,6", null]]),
  ], "Europe/Paris", { series: [], places: [], devices: devices as never });
  assert.equal(plan.format, "ancien tableur");
  assert.deepEqual(plan.ignoredSheets, ["Config"]);
  assert.deepEqual(plan.rows, [
    { c: 11, t: "2025-01-01T03:25:19.000Z", v: 20 },   // 04:25:19 à Paris
    { c: 12, t: "2025-01-01T03:25:19.000Z", v: 53 },
    { c: 13, t: "2024-12-31T23:06:15.000Z", v: 4.5 },  // onglet « 3;4 » : canaux extérieurs
    { c: 14, t: "2024-12-31T23:06:15.000Z", v: 94 },
    { c: 13, t: "2024-12-31T23:13:09.000Z", v: 4.6 },
  ]);
});

test("ancien tableur : capteur absent de la maison signalé, rien d'importé", () => {
  const plan = buildPlan([sheet("01-Salon", "1;2", [[new Date(Date.UTC(2025, 0, 1)), 20, 50]])], "Europe/Paris",
                         { series: [], places: [], devices: [] });
  assert.equal(plan.rows.length, 0);
  assert.match(plan.groups[0].problem ?? "", /capteur absent/);
});

test("bilan de plusieurs onglets analysés un par un", () => {
  const ctx = { series: [], places: [], devices: devices as never };
  const parts = [
    buildPlan([{ name: "Config", rows: [["WebSite", "x"]] }], "Europe/Paris", ctx),
    buildPlan([sheet("01-Salon", "1;2", [[new Date(Date.UTC(2025, 0, 1)), 20, 50]])], "Europe/Paris", ctx),
    buildPlan([sheet("01-Ext", "3;4", [[new Date(Date.UTC(2025, 0, 2)), 4, 90]])], "Europe/Paris", ctx),
  ];
  const plan = parts.reduce((acc, p) => mergePlans(acc, p), null as ReturnType<typeof mergePlans> | null)!;
  assert.equal(plan.format, "ancien tableur");
  assert.equal(plan.kind, "channel");
  assert.equal(plan.values, 4);
  assert.equal(plan.rows.length, 0);               // les lignes ne sont pas gardées
  assert.deepEqual(plan.ignoredSheets, ["Config"]);
  assert.equal(plan.groups.length, 2);
});
