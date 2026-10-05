// Préférences d'affichage, mémorisées sur l'appareil et communes à toutes les pages : rendu des
// courbes (escalier, lissé, simplifié), grandeurs masquées (ex. l'humidité), taille du texte et
// densité (pour voir plus de fiches à la fois).

import type { CurveMode } from "./curve";

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
});

try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? "{}");
  if (MODES.includes(saved.curve)) display.curve = saved.curve;
  if (TEXTS.includes(saved.text)) display.text = saved.text;
  if (DENSITIES.includes(saved.density)) display.density = saved.density;
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
