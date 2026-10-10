// Chargement des courbes d'une période : mesures détaillées et / ou bandes min – max journalières,
// selon la largeur visible et les seuils du temps long (Options).

import { api } from "./api";
import { display } from "./display.svelte";
import { needs, viewKey, type DayBand } from "./longview";
import type { Window } from "./period";
import type { Point } from "./types";

export interface Curves { data: Map<number, Point[]>; bands: Map<number, DayBand[]>; key: string }

export async function loadCurves(ids: number[], range: Window, win: Window): Promise<Curves> {
  const o = display.longview;
  const n = needs(win, o);
  const [data, bands] = await Promise.all([
    n.raw ? api.seriesData(ids, range[0], range[1]) : Promise.resolve(new Map<number, Point[]>()),
    n.band ? api.seriesDaily(ids, range[0], range[1]) : Promise.resolve(new Map<number, DayBand[]>()),
  ]);
  return { data, bands, key: viewKey(win, o) };
}

/** Faut-il recharger pour cette fenêtre (données d'une autre nature) ? */
export const otherView = (w: Window, loadedKey: string) => viewKey(w, display.longview) !== loadedKey;
