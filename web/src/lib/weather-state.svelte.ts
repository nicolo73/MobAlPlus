// Stations météo de la maison courante : emplacements de type « weather » alimentés côté serveur
// par la collecte Open-Meteo (capteurs virtuels). L'application ne lit que la base : aucun appel
// au service météo depuis les navigateurs.

import { api } from "./api";
import { cssVar } from "./colors";
import type { WeatherSeries } from "./weather-parse";
import type { ChartSeries } from "../components/TimeChart.svelte";

export interface Station { placeId: number; name: string; temperature: number | null; humidity: number | null }

export const homeWeather = $state({ stations: [] as Station[], loaded: false, homeId: null as number | null });

/** Station de comparaison (courbe « Météo » des graphiques) : la première, dans l'ordre des emplacements */
export const primaryStation = (): Station | null => homeWeather.stations[0] ?? null;

export async function loadWeatherStations(homeId: number | null) {
  if (homeId !== homeWeather.homeId) {
    homeWeather.stations = [];
    homeWeather.loaded = false;
    homeWeather.homeId = homeId;
  }
  if (homeId === null) return;
  try {
    const [places, series] = await Promise.all([api.places(), api.seriesList()]);
    if (homeWeather.homeId !== homeId) return;
    homeWeather.stations = places.filter((p) => p.kind === "weather").map((p) => ({
      placeId: p.id, name: p.name,
      temperature: series.find((s) => s.place_id === p.id && s.property === "temperature")?.id ?? null,
      humidity: series.find((s) => s.place_id === p.id && s.property === "humidity")?.id ?? null,
    })).filter((s) => s.temperature !== null || s.humidity !== null);
  } catch { /* on garde ce qu'on a */ }
  homeWeather.loaded = true;
}

/**
 * Courbe de météo publique d'une grandeur, à ajouter à un graphique (pointillés gris) ; aucune si la
 * station fait déjà partie des emplacements affichés (`shown`).
 */
export function weatherCurve(w: WeatherSeries | null, prop: string, shown: number[] = []): ChartSeries[] {
  const points = prop === "temperature" ? w?.temperature : prop === "humidity" ? w?.humidity : undefined;
  const st = primaryStation();
  if (!points?.length || !st || shown.includes(st.placeId)) return [];
  return [{ id: `meteo-${prop}`, name: st.name, color: cssVar("--muted"), dotted: true, points }];
}

/** Mesures de la station de comparaison sur une période (null si désactivée ou sans station) */
export async function loadWeather(enabled: boolean, from: number, to: number): Promise<WeatherSeries | null> {
  const st = primaryStation();
  if (!enabled || !st) return null;
  const ids = [st.temperature, st.humidity].filter((x): x is number => x !== null);
  try {
    const data = await api.seriesData(ids, from, to);
    return { temperature: st.temperature ? data.get(st.temperature) ?? [] : [], humidity: st.humidity ? data.get(st.humidity) ?? [] : [] };
  } catch { return null; }
}
