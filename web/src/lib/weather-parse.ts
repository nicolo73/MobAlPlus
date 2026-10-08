// Mesures de la station météo de comparaison sur une période (courbe « Météo » des graphiques).

import type { Point } from "./types";

export interface WeatherSeries {
  temperature: Point[];
  humidity: Point[];
  /** Prévision des heures à venir */
  forecast?: { temperature: Point[]; humidity: Point[] };
}
