// Fenêtre de temps affichée et période chargée autour (pour glisser sans attendre).

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export const PRESETS = [
  { label: "24 h", ms: DAY },
  { label: "3 j", ms: 3 * DAY },
  { label: "7 j", ms: 7 * DAY },
  { label: "30 j", ms: 30 * DAY },
  { label: "1 an", ms: 365 * DAY },
] as const;

export type Window = [number, number];

/** Période à charger : une largeur de fenêtre de part et d'autre (sans dépasser maintenant) */
export function loadRange([s, e]: Window, now = Date.now()): Window {
  const w = e - s;
  return [s - w, Math.min(e + w, now + 5 * 60_000)];
}

/** Faut-il recharger ? fenêtre sortie de la période chargée, ou zoom trop fort pour la résolution chargée */
export function needsReload([s, e]: Window, [ls, le]: Window, now = Date.now()): boolean {
  const w = e - s;
  if (s < ls || (e > le && le < now)) return true;
  return w * 6 < le - ls;
}

export function fmtRange([s, e]: Window): string {
  const sameDay = new Date(s).toDateString() === new Date(e - 1).toDateString();
  const d = (t: number) => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  const h = (t: number) => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `${d(s)}, ${h(s)} – ${h(e)}`;
  return e - s <= 3 * DAY ? `${d(s)} ${h(s)} – ${d(e)} ${h(e)}` : `${d(s)} – ${d(e)}`;
}
