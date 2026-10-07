// Position de la maison courante et dernière météo connue (fiche de la page Maintenant).
// Gardées en mémoire et sur l'appareil : la fiche s'affiche tout de suite avec les dernières valeurs,
// puis se met à jour en arrière-plan (au plus toutes les 10 minutes) ; un échec ne l'efface pas.

import { api } from "./api";
import { cssVar } from "./colors";
import { WEATHER_NAME, currentWeather, weatherSeries, type CurrentWeather, type Location, type WeatherSeries } from "./weather";
import type { ChartSeries } from "../components/TimeChart.svelte";

export const homeWeather = $state({
  loc: null as Location | null, loaded: false, homeId: null as number | null,
  current: null as CurrentWeather | null,
  /** 25 dernières heures (tendance de la fiche) */
  day: null as WeatherSeries | null,
});

const KEY = (homeId: number) => `mobalplus.meteo.${homeId}`;
let fetchedAt = 0;
let fetching: Promise<void> | null = null;

function remember() {
  if (homeWeather.homeId === null) return;
  try {
    localStorage.setItem(KEY(homeWeather.homeId), JSON.stringify({ loc: homeWeather.loc, current: homeWeather.current, day: homeWeather.day }));
  } catch { /* stockage indisponible */ }
}

/** Dernières valeurs mémorisées sur l'appareil pour cette maison */
function recall(homeId: number) {
  try {
    const m = JSON.parse(localStorage.getItem(KEY(homeId)) ?? "null");
    if (m?.loc) homeWeather.loc = m.loc;
    if (m?.current) homeWeather.current = m.current;
    if (m?.day) homeWeather.day = m.day;
  } catch { /* ignoré */ }
}

/** Met à jour la météo actuelle (au plus toutes les 10 minutes, sauf `force`) */
export function refreshCurrentWeather(force = false): Promise<void> {
  const loc = homeWeather.loc;
  if (!loc) return Promise.resolve();
  if (fetching) return fetching;
  if (!force && Date.now() - fetchedAt < 10 * 60_000 && homeWeather.current) return Promise.resolve();
  fetching = (async () => {
    try {
      const cur = await currentWeather(loc);
      if (homeWeather.loc !== loc) return;
      homeWeather.current = cur;
      fetchedAt = Date.now();
      remember();
      const day = await weatherSeries(loc, Date.now() - 25 * 3_600_000, Date.now()).catch(() => null);
      if (day && homeWeather.loc === loc) { homeWeather.day = day; remember(); }
    } catch { /* hors ligne ou service indisponible : on garde les dernières valeurs */ }
    finally { fetching = null; }
  })();
  return fetching;
}

/** Recharge la position ; la précédente reste affichée pendant le chargement (même maison) */
export async function loadHomeLocation(homeId: number | null) {
  if (homeId !== homeWeather.homeId) {
    homeWeather.loc = null;
    homeWeather.current = null;
    homeWeather.day = null;
    homeWeather.loaded = false;
    homeWeather.homeId = homeId;
    fetchedAt = 0;
    if (homeId !== null) recall(homeId);
  }
  if (homeId === null) return;
  try {
    const loc = await api.homeLocation(homeId);
    if (homeWeather.homeId !== homeId) return;
    const same = loc && homeWeather.loc && loc.lat === homeWeather.loc.lat && loc.lon === homeWeather.loc.lon
      && loc.label === homeWeather.loc.label;
    if (!same) {
      homeWeather.loc = loc;
      homeWeather.current = null;  // autre position : les valeurs mémorisées ne valent plus
      homeWeather.day = null;
      fetchedAt = 0;
    }
    remember();
  } catch { /* base pas encore à jour : on garde ce qu'on a */ }
  homeWeather.loaded = true;
}


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
