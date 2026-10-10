export type Role = "admin" | "viewer";
export type HomeRole = "owner" | "editor" | "viewer";

export interface HomeInfo {
  id: number;
  name: string;
  role: HomeRole;
}

/** Ce que le compte connecté peut voir et faire */
export interface Context {
  email: string | null;
  platform_admin: boolean;
  homes: HomeInfo[];
}

export interface Member {
  id: number;
  home_id: number;
  email: string;
  user_id: string | null;
  role: HomeRole;
  created_at: string;
}

export interface CurrentValue {
  series_id: number;
  series_name: string;
  place_id: number;
  place_name: string;
  property: string;
  unit: string;
  ts: string | null;
  value: number | null;
  ma_id: string;
  device_name: string | null;
}

export interface Place {
  id: number;
  code: string;
  name: string;
  parent_id: number | null;
  kind: string | null;
  exposure: "indoor" | "outdoor" | "appliance" | null;
  /** Ordre parmi les emplacements de même parent */
  sort_order?: number;
  /** Couleur dans les courbes : numéro dans la palette (0 à 7), null = automatique */
  color_slot?: number | null;
  /** Couleur personnalisée (#rrggbb), prioritaire sur color_slot */
  color?: string | null;
}

export interface Channel {
  id: number;
  channel_no: number;
  label: string | null;
  property: string;
  property_name: string;
  unit: string;
  /** Affectation en cours */
  place_id: number | null;
  since: string | null;
}

export interface Device {
  id: number;
  ma_id: string;
  name: string | null;
  ma_name: string | null;
  model: string | null;
  /** Origine des mesures : capteur Mobile Alerts, ou station météo publique (Open-Meteo, collectée par le serveur) */
  vendor?: "mobile_alerts" | "open_meteo";
  active: boolean;
  added_at: string;
  retired_at: string | null;
  channels: Channel[];
}

export interface DeviceStats {
  ma_id: string;
  name: string | null;
  active: boolean;
  channels: number | null;
  values: number | null;
  first_ts: string | null;
  last_ts: string | null;
  last_run: string | null;
  status: "OK" | "NO_DATA" | "ERROR" | null;
  message: string | null;
}

export interface Stats {
  db_size_bytes: number;
  tables: Record<string, number>;
  counts: {
    devices: number; active_devices: number; channels: number; places: number; series: number;
    active_deployments: number; corrections: number; annotations: number;
  };
  values: { recent: number; compacted: number; simplified: number; simplified_raw: number };
  devices: DeviceStats[];
  last_maintenance: { run_at: string; details: Record<string, unknown> } | null;
  settings: Record<string, unknown>;
}

export interface Property {
  id: number;
  code: string;
  name: string;
  unit: string;
  simplify_tolerance: number | null;
}

export interface CollectResult {
  ma_id: string;
  status: "OK" | "ERROR" | "SKIPPED";
  received?: number;
  inserted?: number;
  error?: string;
}

export interface SeriesInfo {
  id: number;
  name: string;
  place_id: number;
  place_name: string;
  exposure: Place["exposure"];
  property: string;
  property_name: string;
  unit: string;
}

export interface Point {
  ts: number;          // millisecondes
  value: number;
  quality: "ok" | "corrected" | "rejected";
}

export interface Observation extends Point {
  series_id: number;
}

export interface SeriesStats {
  n: number;
  vmin: number | null;
  tmin: string | null;
  vmax: number | null;
  tmax: string | null;
  vavg: number | null;
  first_ts: string | null;
  last_ts: string | null;
}

export interface PlaceDeployment {
  series_id: number;
  property: string;
  property_name: string;
  ma_id: string;
  device_name: string | null;
  channel_no: number;
  from: string | null;
  to: string | null;
}

export interface ImportResult {
  received: number;
  inserted: number;
  identical: number;   // déjà présentes (dans la marge, même valeur)
  conflicts: number;   // valeurs existantes différentes, conservées
  replaced: number;    // valeurs existantes remplacées par celles du fichier
  skipped: number;     // hors de toute affectation
  extended: number;    // affectations étendues vers le passé
  rejected: number;    // corrections recréées
}

export interface ConflictSample { t: string; v: number; et: string; ev: number }

export interface ImportPreview {
  groups: { key: number; new: number; identical: number; conflict: number; unassigned: number; samples: ConflictSample[] }[];
  tz_sampled: number;
  tz_shifted: number;
}

export type ImportMode = "keep" | "replace";

export interface ExportOptions {
  tz: "Europe/Paris" | "UTC";
  sep: ";" | ",";
  decimal: "," | ".";
  limit?: number | null;
}

export type ImportRows = { s?: number; c?: number; t: string; v: number; q?: string }[];

export type AlertKind = "above" | "below" | "peak" | "trough" | "silent" | "gap_above" | "gap_below" | "rise" | "fall"
  | "fc_above" | "fc_below";
export type AlertLevel = "info" | "warning";

/** Règle d'alerte d'une série : seuil haut / bas, ou pic / creux (seuil = montée minimale) */
export interface AlertRule {
  series_id: number;
  kind: AlertKind;
  level: AlertLevel;
  threshold: number | null;
  enabled: boolean;
  /** Comparaison (gap_above / gap_below) : série de référence, même grandeur, autre emplacement */
  ref_series_id?: number | null;
}

export interface AlertEvent {
  id: number;
  series_id: number;
  place_id: number;
  place_name: string;
  property: string;
  unit: string;
  kind: AlertKind;
  level: AlertLevel;
  threshold: number | null;
  started_at: number;          // millisecondes
  ended_at: number | null;     // null : dépassement en cours
  value: number | null;        // valeur extrême (écart ou variation horaire pour une comparaison ou une pente)
  ref_series_id?: number | null;
  /** Comparaison : emplacement de référence */
  ref_place_name?: string | null;
  /** Alerte sur prévision : heure prévue du franchissement (millisecondes) */
  forecast_at?: number | null;
  archived: boolean;           // masquée par le compte connecté
}

/** Résultat de la collecte météo d'une station */
export interface WeatherResult { station: string; received: number; inserted: number; forecast?: number; error?: string }

export interface Api {
  readonly demo: boolean;
  session(): Promise<{ email: string } | null>;
  onAuthChange(cb: () => void): void;
  signIn(email: string, password: string): Promise<void>;
  /** Crée un compte ; « confirm » si un e-mail de confirmation a été envoyé */
  signUp(email: string, password: string): Promise<"ok" | "confirm">;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  /** Rattache les invitations en attente puis renvoie les maisons accessibles */
  context(): Promise<Context>;
  /** Maison courante : toutes les lectures et créations ci-dessous s'y rapportent */
  setHome(homeId: number | null): void;
  createHome(name: string): Promise<number>;
  renameHome(id: number, name: string): Promise<void>;
  members(homeId: number): Promise<Member[]>;
  addMember(homeId: number, email: string, role: HomeRole): Promise<void>;
  setMemberRole(id: number, role: HomeRole): Promise<void>;
  removeMember(id: number): Promise<void>;

  currentValues(): Promise<CurrentValue[]>;
  seriesList(): Promise<SeriesInfo[]>;
  /** Points d'affichage (tous, ou min / max réels par intervalle au-delà de maxPoints) */
  seriesData(ids: number[], from: number, to: number, maxPoints?: number): Promise<Map<number, Point[]>>;
  /** Minimum, maximum et moyenne par jour (courbes sur le temps long), par série */
  seriesDaily(ids: number[], from: number, to: number): Promise<Map<number, import("./longview").DayBand[]>>;
  /** Prévisions (stations météo) : heures à venir, par série ; vide pour un capteur */
  seriesForecast(ids: number[], from: number, to: number): Promise<Map<number, Point[]>>;
  seriesStats(id: number, from: number, to: number): Promise<SeriesStats>;
  /** Mesures détaillées antérieures à « before », les plus récentes d'abord */
  observations(ids: number[], from: number, before: number, limit: number): Promise<Observation[]>;
  placeDeployments(placeId: number): Promise<PlaceDeployment[]>;
  /** Première et dernière mesure de séries */
  seriesBounds(ids: number[]): Promise<{ first: number | null; last: number | null }>;
  /** Lignes CSV (format MobAlPlus, sans en-tête) de [from, to[ */
  exportCsv(ids: number[], from: number, to: number, opts: ExportOptions): Promise<string>;
  /** Classe les valeurs (nouvelles, identiques, en conflit) sans rien écrire ; marge en secondes */
  importPreview(kind: "series" | "channel", rows: ImportRows, tolerance: number): Promise<ImportPreview>;
  importValues(kind: "series" | "channel", rows: ImportRows, tolerance: number, mode: ImportMode): Promise<ImportResult>;
  stats(): Promise<Stats>;
  devices(): Promise<Device[]>;
  places(): Promise<Place[]>;
  properties(): Promise<Property[]>;

  addDevice(maId: string, name: string): Promise<void>;
  renameDevice(id: number, name: string): Promise<void>;
  retireDevice(id: number): Promise<void>;
  reactivateDevice(id: number): Promise<void>;
  assignChannel(channelId: number, placeId: number | null, from: Date): Promise<void>;
  /** Couleur d'un emplacement dans les courbes (numéro de palette, null = automatique) */
  setPlaceColor(id: number, color: number | string | null): Promise<void>;
  /** Range ces emplacements, dans cet ordre, sous ce parent (null : premier niveau) */
  reorderPlaces(parentId: number | null, ids: number[]): Promise<void>;
  savePlace(place: Omit<Place, "id"> & { id?: number }): Promise<void>;
  deletePlace(id: number): Promise<void>;
  saveSetting(key: string, value: unknown): Promise<void>;
  saveTolerance(propertyId: number, tolerance: number | null): Promise<void>;
  collectNow(maIds?: string[]): Promise<CollectResult[]>;
  runMaintenance(): Promise<Record<string, unknown>>;
  /** Crée une station météo publique (capteur virtuel + emplacement) ; renvoie l'emplacement */
  addWeatherStation(label: string, lat: number, lon: number): Promise<number>;
  /** Lance la collecte météo (après création d'une station) */
  collectWeather(): Promise<WeatherResult[]>;
  /** Emplacements parents qui ont encore un capteur affecté (incohérence à corriger) */
  placeIssues(): Promise<{ place_id: number; place_name: string; channels: number }[]>;
  alertRules(seriesIds: number[]): Promise<AlertRule[]>;
  /** Remplace les règles d'une série (droits « gestion ») */
  saveAlertRules(seriesId: number, rules: Omit<AlertRule, "series_id">[]): Promise<void>;
  /** Alertes en cours ou commencées depuis `since`, archivées comprises (champ archived) */
  alertEvents(opts: { since: number; seriesIds?: number[] }): Promise<AlertEvent[]>;
  archiveAlerts(ids: number[], archived: boolean): Promise<void>;
  deleteAlerts(ids: number[]): Promise<void>;
  savePushSubscription(sub: PushSubscriptionJSON, minLevel: AlertLevel): Promise<void>;
  deletePushSubscription(endpoint: string): Promise<void>;
}
