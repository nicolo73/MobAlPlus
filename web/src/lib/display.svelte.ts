// Préférences d'affichage, mémorisées sur l'appareil et communes à toutes les pages : rendu des
// courbes (escalier, lissé, simplifié), grandeurs masquées (ex. l'humidité), taille du texte et
// densité (pour voir plus de fiches à la fois).

import type { CurveMode } from "./curve";
import { TREND_DEFAULTS, type TrendOptions } from "./trend";

const STORE = "mobalplus.display";
const MODES: CurveMode[] = ["step", "smooth", "simple"];

export type TextSize = "normal" | "small" | "smaller";
export type Density = "comfort" | "compact";
const TEXTS: TextSize[] = ["normal", "small", "smaller"];
const DENSITIES: Density[] = ["comfort", "compact"];

export const display = $state({
  curve: "smooth" as CurveMode,
  hidden: [] as string[],
  text: "normal" as TextSize,
  density: "comfort" as Density,
  /** Courbe de comparaison avec la station météo publique (s'il y en a une) */
  weather: true,
  /** Page Maintenant : fiches masquées, par maison (identifiants d'emplacement) */
  nowHidden: {} as Record<string, number[]>,
  trend: structuredClone(TREND_DEFAULTS) as TrendOptions,
});

try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? "{}");
  if (MODES.includes(saved.curve)) display.curve = saved.curve;
  if (TEXTS.includes(saved.text)) display.text = saved.text;
  if (DENSITIES.includes(saved.density)) display.density = saved.density;
  if (typeof saved.weather === "boolean") display.weather = saved.weather;
  if (saved.nowHidden && typeof saved.nowHidden === "object") display.nowHidden = saved.nowHidden;
  if (saved.trend && typeof saved.trend === "object") {
    const t = saved.trend;
    const num = (v: unknown, d: number) => (typeof v === "number" && v > 0 ? v : d);
    display.trend = {
      windowMin: num(t.windowMin, TREND_DEFAULTS.windowMin),
      sensitivity: num(t.sensitivity, TREND_DEFAULTS.sensitivity),
      holdMin: num(t.holdMin, TREND_DEFAULTS.holdMin),
      reversal: { ...TREND_DEFAULTS.reversal, ...Object.fromEntries(Object.entries(t.reversal ?? {}).filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0)) },
    };
  }
  if (Array.isArray(saved.hidden)) display.hidden = saved.hidden.filter((h: unknown) => typeof h === "string");
} catch { /* stockage indisponible : valeurs par défaut */ }
apply();

/** Taille du texte et densité : attributs de <html>, exploités par app.css */
function apply() {
  const root = document.documentElement;
  root.dataset.text = display.text;
  root.dataset.density = display.density;
}

export function setText(size: TextSize) {
  display.text = size;
  apply();
  save();
}

export function setDensity(density: Density) {
  display.density = density;
  apply();
  save();
}

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(display)); } catch { /* ignoré */ }
}

export function setTrend(patch: Partial<TrendOptions>) {
  display.trend = { ...display.trend, ...patch };
  save();
}

export function resetTrend() {
  display.trend = structuredClone(TREND_DEFAULTS);
  save();
}

/** Fiche masquée sur la page Maintenant */
export const nowHidden = (homeId: number | null, key: number) =>
  (display.nowHidden[String(homeId)] ?? []).includes(key);

export function setNowHidden(homeId: number | null, key: number, hidden: boolean) {
  const k = String(homeId);
  const list = (display.nowHidden[k] ?? []).filter((x) => x !== key);
  display.nowHidden = { ...display.nowHidden, [k]: hidden ? [...list, key] : list };
  save();
}

export function setWeather(on: boolean) {
  display.weather = on;
  save();
}

export function setCurve(mode: CurveMode) {
  display.curve = mode;
  save();
}

/** Grandeurs affichées parmi celles disponibles ; jamais aucune (on les montre alors toutes) */
export function visibleProps(available: string[]): string[] {
  const v = available.filter((p) => !display.hidden.includes(p));
  return v.length ? v : available;
}

export function toggleProp(prop: string, available: string[]) {
  if (display.hidden.includes(prop)) display.hidden = display.hidden.filter((p) => p !== prop);
  else if (visibleProps(available).length > 1) display.hidden = [...display.hidden, prop];
  save();
}
