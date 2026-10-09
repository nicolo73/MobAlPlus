// Couleurs des séries : palette catégorielle validée (8 teintes, ordre fixe, variante claire / sombre).
// Une couleur suit l'emplacement : attribuée à la sélection, conservée tant qu'il reste sélectionné.

/** Teintes de la palette (couleur choisie pour un emplacement : numéro 0 à 7, voir place.color_slot) */
export const PALETTE_SIZE = 8;
/** Courbes au plus en même temps (Courbes, Synthèse) ; au-delà de la palette, couleurs d'appoint */
export const MAX_SERIES = 12;

const LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
/** Couleurs d'appoint (9e à 12e courbe automatique) : turquoise, marron, olive, bordeaux */
const EXTRA_LIGHT = ["#0fa3b1", "#8b5a2b", "#8a8f2a", "#8e1b3a"];
const EXTRA_DARK = ["#22b8c6", "#b07a45", "#a9ae3c", "#c2476a"];

export const isDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

export function slotColor(slot: number, dark = isDark()): string {
  const n = PALETTE_SIZE + EXTRA_LIGHT.length;
  const i = ((slot % n) + n) % n;
  return i < PALETTE_SIZE ? (dark ? DARK : LIGHT)[i] : (dark ? EXTRA_DARK : EXTRA_LIGHT)[i - PALETTE_SIZE];
}

/** Couleurs fixes de la page d'un emplacement : température orange, humidité bleue */
export function propertyColor(property: string, dark = isDark()): string {
  return slotColor(property === "temperature" ? 1 : property === "humidity" ? 0 : 2, dark);
}

/** Lit une variable CSS du thème courant */
export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Couleurs supplémentaires proposées pour un emplacement (fixes, identiques en clair et en sombre) */
export const EXTRA_COLORS: { hex: string; name: string }[] = [
  { hex: "#7a7f85", name: "gris" }, { hex: "#b0b5ba", name: "gris clair" }, { hex: "#3a3f44", name: "anthracite" },
  { hex: "#8b5a2b", name: "marron" }, { hex: "#0fa3b1", name: "turquoise" }, { hex: "#5bb3e8", name: "bleu ciel" },
  { hex: "#8e1b3a", name: "bordeaux" }, { hex: "#8a8f2a", name: "olive" },
];

/** Choix de couleur d'un emplacement : numéro de palette, couleur personnalisée (#rrggbb) ou automatique */
export type ColorChoice = number | string | null;

/** Couleur effective d'un emplacement : personnalisée, sinon palette, sinon `fallback` */
export function placeColor(p: { color?: string | null; color_slot?: number | null }, dark: boolean, fallback: number): string {
  return p.color ?? slotColor(p.color_slot ?? fallback, dark);
}
