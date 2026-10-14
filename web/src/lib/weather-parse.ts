// Mesures de la station météo de comparaison sur une période (courbe « Météo » des graphiques).

import type { Point } from "./types";

export interface WeatherSeries {
  temperature: Point[];
  humidity: Point[];
  /** Temps long : bandes min – max journalières */
  bands?: { temperature: import("./longview").DayBand[]; humidity: import("./longview").DayBand[] };
  /** Prévision des heures à venir */
  forecast?: { temperature: Point[]; humidity: Point[] };
  /** Normales saisonnières (jour par jour de l'année) */
  normals?: { temperature: import("./normals").NormalDay[]; humidity: import("./normals").NormalDay[] };
}
