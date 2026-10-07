// Position de la maison courante, pour la météo publique (chargée au changement de maison).

import { api } from "./api";
import type { Location } from "./weather";

export const homeWeather = $state({ loc: null as Location | null, loaded: false, homeId: null as number | null });

/** Recharge la position ; la précédente reste affichée pendant le chargement (même maison) */
export async function loadHomeLocation(homeId: number | null) {
  if (homeId !== homeWeather.homeId) {
    homeWeather.loc = null;
    homeWeather.loaded = false;
    homeWeather.homeId = homeId;
  }
  if (homeId === null) return;
  try {
    const loc = await api.homeLocation(homeId);
    if (homeWeather.homeId !== homeId) return;
    const same = loc && homeWeather.loc && loc.lat === homeWeather.loc.lat && loc.lon === homeWeather.loc.lon
      && loc.label === homeWeather.loc.label;
    if (!same) homeWeather.loc = loc;
  } catch { /* base pas encore à jour : on garde ce qu'on a */ }
  homeWeather.loaded = true;
}

import { cssVar } from "./colors";
import { WEATHER_NAME, weatherSeries, type WeatherSeries } from "./weather";
import type { ChartSeries } from "../components/TimeChart.svelte";

/** Courbe de météo publique d'une grandeur, à ajouter à un graphique (pointillés gris) */
export function weatherCurve(w: WeatherSeries | null, prop: string): ChartSeries[] {
  const points = prop === "temperature" ? w?.temperature : prop === "humidity" ? w?.humidity : undefined;
  if (!points?.length) return [];
  return [{ id: `meteo-${prop}`, name: WEATHER_NAME, color: cssVar("--muted"), dotted: true, points }];
}

/** Charge la météo publique d'une période (null si désactivée, sans position, ou indisponible) */
export async function loadWeather(enabled: boolean, from: number, to: number): Promise<WeatherSeries | null> {
  if (!enabled || !homeWeather.loc) return null;
  try { return await weatherSeries(homeWeather.loc, from, to); } catch { return null; }
}
