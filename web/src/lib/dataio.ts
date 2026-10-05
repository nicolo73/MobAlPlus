// Lecture des fichiers à importer (CSV MobAlPlus, Excel, ancien tableur Mobile Alerts) et préparation
// des lignes envoyées à la base.

import { localizeAscending, parseLocalTimestamp } from "./timeutil";
import type { Device, Place, SeriesInfo } from "./types";

export type Cell = string | number | boolean | Date | null;
export interface Sheet { name: string; rows: Cell[][] }

/** Fuseau des dates sans indication de fuseau */
export type ImportTz = "Europe/Paris" | "UTC";

export interface ImportRow { s?: number; c?: number; t: string; v: number; q?: string }

export interface ImportGroup {
  label: string;               // « Salon – température » ou « 01-Salon : canaux 1, 2 »
  rows: number;
  first: number | null;
  last: number | null;
  ok: boolean;
  problem?: string;
}

export interface ImportPlan {
  format: "mobalplus" | "ancien tableur";
  kind: "series" | "channel";
  rows: ImportRow[];
  groups: ImportGroup[];
  ignored: number;             // lignes illisibles ou non rattachées
  ignoredSheets: string[];
}

// ---------------------------------------------------------------------------
// Lecture des fichiers
// ---------------------------------------------------------------------------

export function parseCsv(text: string): Cell[][] {
  text = text.replace(/^﻿/, "");
  const firstLine = text.slice(0, text.indexOf("\n") + 1 || undefined);
  const sep = [";", "\t", ","].reduce((best, s) =>
    firstLine.split(s).length > firstLine.split(best).length ? s : best, ";");
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

export async function readFile(file: File): Promise<Sheet[]> {
  if (/\.xlsx?$/i.test(file.name)) {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    const sheets = await readXlsxFile(file);
    return sheets.map((s) => ({ name: s.sheet, rows: s.data as Cell[][] }));
  }
  return [{ name: file.name, rows: parseCsv(await file.text()) }];
}

// ---------------------------------------------------------------------------
// Valeurs
// ---------------------------------------------------------------------------

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function guessProperty(label: unknown): string {
  const t = norm(label);
  if (t.includes("temp")) return "temperature";
  if (t.includes("hygro") || t.includes("humid")) return "humidity";
  if (t.includes("pluie") || t.includes("rain")) return "rain";
  return t;
}

function toNumber(v: Cell): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null || v instanceof Date || typeof v === "boolean") return null;
  const m = String(v).replace(/\s/g, "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return n === 43530 || n === 65295 ? null : n;   // valeurs spéciales Mobile Alerts
}

/**
 * Date d'une cellule : instant exact (ms UTC) si elle porte un fuseau, sinon « heure murale »
 * (ms comme si c'était de l'UTC) à convertir avec le fuseau choisi.
 */
type When = { exact: number } | { wall: number };
function toWhen(v: Cell): When | null {
  if (v instanceof Date) return { wall: v.getTime() };          // Excel : date sans fuseau
  if (typeof v === "number") return { wall: Math.round((v - 25569) * 86_400_000) };  // numéro de série Excel
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  if (/(Z|[+-]\d\d:?\d\d)$/.test(s) && /^\d{4}-\d\d-\d\d/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : { exact: t };
  }
  try { return { wall: parseLocalTimestamp(s.replace("T", " ")) }; } catch { return null; }
}

/** Convertit des dates d'une même série, dans l'ordre du fichier, en instants UTC */
function resolveTimes(whens: When[], tz: ImportTz): number[] {
  if (tz === "UTC") return whens.map((w) => ("exact" in w ? w.exact : w.wall));
  const walls = whens.map((w) => ("wall" in w ? w.wall : 0));
  const local = localizeAscending(walls, tz);
  return whens.map((w, i) => ("exact" in w ? w.exact : local[i]));
}

/** Bornes d'une liste (sans « ...spread », qui déborde sur des centaines de milliers de valeurs) */
function bounds(ts: number[]): [number | null, number | null] {
  let lo = Infinity, hi = -Infinity;
  for (const t of ts) { if (t < lo) lo = t; if (t > hi) hi = t; }
  return ts.length ? [lo, hi] : [null, null];
}

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

const HEADER = { date: ["date", "horodatage", "timestamp"], place: ["emplacement", "lieu", "place"],
                 prop: ["grandeur", "mesure", "property"], value: ["valeur", "value"],
                 quality: ["qualite", "quality"] };

function findHeader(rows: Cell[][]) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = rows[i].map(norm);
    const col = (names: string[]) => cells.findIndex((c) => names.includes(c));
    const idx = { date: col(HEADER.date), place: col(HEADER.place), prop: col(HEADER.prop),
                  value: col(HEADER.value), quality: col(HEADER.quality) };
    if (idx.date >= 0 && idx.place >= 0 && idx.prop >= 0 && idx.value >= 0) return { row: i, idx };
  }
  return null;
}

const isOldSheet = (rows: Cell[][]) => norm(rows[0]?.[0]) === "device id";

export function buildPlan(sheets: Sheet[], tz: ImportTz, ctx: { series: SeriesInfo[]; places: Place[]; devices: Device[] }): ImportPlan {
  const old = sheets.filter((s) => isOldSheet(s.rows));
  return old.length ? planOld(sheets, tz, ctx.devices) : planStandard(sheets, tz, ctx.series);
}

function planStandard(sheets: Sheet[], tz: ImportTz, series: SeriesInfo[]): ImportPlan {
  const byKey = new Map(series.map((s) => [`${norm(s.place_name)}|${s.property}`, s]));
  const groups = new Map<string, { label: string; serie?: SeriesInfo; whens: When[]; values: number[]; q: string[] }>();
  let ignored = 0;
  const ignoredSheets: string[] = [];
  for (const sheet of sheets) {
    const h = findHeader(sheet.rows);
    if (!h) { ignoredSheets.push(sheet.name); continue; }
    for (const row of sheet.rows.slice(h.row + 1)) {
      const when = toWhen(row[h.idx.date]);
      const value = toNumber(row[h.idx.value]);
      if (!when || value === null) { ignored++; continue; }
      const place = String(row[h.idx.place] ?? "").trim();
      const prop = guessProperty(row[h.idx.prop]);
      const key = `${norm(place)}|${prop}`;
      if (!groups.has(key)) groups.set(key, { label: `${place} – ${prop}`, serie: byKey.get(key), whens: [], values: [], q: [] });
      const g = groups.get(key)!;
      g.whens.push(when);
      g.values.push(value);
      g.q.push(h.idx.quality >= 0 ? norm(row[h.idx.quality]) : "");
    }
  }
  const rows: ImportRow[] = [];
  const out: ImportGroup[] = [];
  for (const g of groups.values()) {
    const times = resolveTimes(g.whens, tz);
    const [first, last] = bounds(times);
    out.push({ label: g.label, rows: times.length, first, last, ok: !!g.serie,
               problem: g.serie ? undefined : "emplacement ou grandeur inconnus dans cette maison" });
    if (!g.serie) { ignored += times.length; continue; }
    times.forEach((t, i) => rows.push({ s: g.serie!.id, t: new Date(t).toISOString(), v: g.values[i],
                                        ...(g.q[i] === "rejected" ? { q: "rejected" } : {}) }));
  }
  return { format: "mobalplus", kind: "series", rows, groups: out, ignored, ignoredSheets };
}

/** Ancien tableur : un onglet par capteur, « Device ID » en A1, colonnes Mobile Alerts dans « columns » */
function planOld(sheets: Sheet[], tz: ImportTz, devices: Device[]): ImportPlan {
  const rows: ImportRow[] = [];
  const out: ImportGroup[] = [];
  const ignoredSheets: string[] = [];
  let ignored = 0;
  for (const sheet of sheets) {
    if (!isOldSheet(sheet.rows)) { ignoredSheets.push(sheet.name); continue; }
    const head = sheet.rows[0].map(norm);
    const maId = String(sheet.rows[1]?.[0] ?? "").trim().toUpperCase();
    const colCell = String(sheet.rows[1]?.[head.indexOf("columns") >= 0 ? head.indexOf("columns") : 3] ?? "");
    const dataStart = sheet.rows.findIndex((r) => norm(r[0]) === "date") + 1;
    if (dataStart <= 0) { ignoredSheets.push(sheet.name); continue; }
    const nbValues = sheet.rows[dataStart - 1].slice(1).filter((c) => c !== null && c !== "").length;
    let columns = colCell.replace(/\.0$/, "").split(/[;,]/).map((c) => parseInt(c, 10)).filter((n) => n > 0);
    if (!columns.length) columns = Array.from({ length: nbValues }, (_, i) => i + 1);

    const device = devices.find((d) => d.ma_id === maId);
    const channels = columns.map((no) => device?.channels.find((c) => c.channel_no === no));
    const label = `${sheet.name} : capteur ${maId || "?"}, colonnes ${columns.join(", ")}`;
    const data = sheet.rows.slice(dataStart);
    const whens: When[] = [];
    const vals: (number | null)[][] = [];
    for (const r of data) {
      const w = toWhen(r[0]);
      if (!w) { if (r.some((c) => c !== null && c !== "")) ignored++; continue; }
      whens.push(w);
      vals.push(columns.map((_, i) => toNumber(r[i + 1] ?? null)));
    }
    const times = resolveTimes(whens, tz);
    const problem = !device ? "capteur absent de cette maison (ajoutez-le d'abord dans Admin › Capteurs)"
      : channels.some((c) => !c) ? "canaux pas encore détectés (lancez une collecte de ce capteur)" : undefined;
    const [first, last] = bounds(times);
    out.push({ label, rows: times.length, first, last, ok: !problem, problem });
    if (problem) { ignored += times.length; continue; }
    times.forEach((t, i) => vals[i].forEach((v, j) => {
      if (v !== null) rows.push({ c: channels[j]!.id, t: new Date(t).toISOString(), v });
    }));
  }
  return { format: "ancien tableur", kind: "channel", rows, groups: out, ignored, ignoredSheets };
}
