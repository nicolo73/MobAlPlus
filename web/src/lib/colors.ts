// Couleurs des séries : palette catégorielle validée (8 teintes, ordre fixe, variante claire / sombre).
// Une couleur suit l'emplacement : attribuée à la sélection, conservée tant qu'il reste sélectionné.

export const MAX_SERIES = 8;

const LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

export const isDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

export function slotColor(slot: number, dark = isDark()): string {
  return (dark ? DARK : LIGHT)[slot % MAX_SERIES];
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
