// Mesures de la station météo de comparaison sur une période (courbe « Météo » des graphiques).

import type { Point } from "./types";

export interface WeatherSeries { temperature: Point[]; humidity: Point[] }
