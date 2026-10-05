// Préférences d'affichage des courbes, mémorisées sur l'appareil et communes à toutes les pages :
// rendu (escalier, lissé, simplifié) et grandeurs masquées (ex. l'humidité).

import type { CurveMode } from "./curve";

const STORE = "mobalplus.display";
const MODES: CurveMode[] = ["step", "smooth", "simple"];

export const display = $state({ curve: "smooth" as CurveMode, hidden: [] as string[] });

try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? "{}");
  if (MODES.includes(saved.curve)) display.curve = saved.curve;
  if (Array.isArray(saved.hidden)) display.hidden = saved.hidden.filter((h: unknown) => typeof h === "string");
} catch { /* stockage indisponible : valeurs par défaut */ }

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
