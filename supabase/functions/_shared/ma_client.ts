// Client du site measurements.mobile-alerts.eu (équivalent de backend/mobalplus/ma_client.py).

import { type MAPage, parseMeasurementDetails } from "./ma_parser.ts";
import { localizeAscending, toMaEpoch } from "./timeutil.ts";

export const BASE_URL = "https://measurements.mobile-alerts.eu/Home/MeasurementDetails";
const APP_BUNDLE = "eu.mobile_alerts.mobilealerts";
const DAY = 86_400_000;

export interface FetchResult {
  deviceName: string | null;
  headers: string[];
  /** [instant UTC (ms), valeurs par colonne], ordre chronologique, sans doublon */
  rows: [number, (number | null)[]][];
}

export interface ClientOptions {
  vendorId: string;
  tz?: string;
  baseUrl?: string;
  pauseMs?: number;     // délai entre deux appels, pour ménager le serveur
  windowMs?: number;    // taille des fenêtres de requête
  pageLimit?: number;   // au-delà, on suppose une page tronquée et on découpe
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MAClient {
  private o: Required<ClientOptions>;

  constructor(options: ClientOptions) {
    this.o = {
      tz: "Europe/Paris", baseUrl: BASE_URL, pauseMs: 1000, windowMs: DAY, pageLimit: 500,
      fetchImpl: fetch, ...options,
    };
  }

  async fetchPage(deviceId: string, startMs: number, endMs: number): Promise<MAPage> {
    const params = new URLSearchParams({
      deviceid: deviceId,
      vendorid: this.o.vendorId,
      appbundle: APP_BUNDLE,
      // +1 s : ne pas récupérer à nouveau la dernière mesure
      fromepoch: String(toMaEpoch(startMs, this.o.tz) + 1),
      toepoch: String(toMaEpoch(endMs, this.o.tz)),
    });
    const resp = await this.o.fetchImpl(`${this.o.baseUrl}?${params}`, { signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} pour le capteur ${deviceId}`);
    const page = parseMeasurementDetails(await resp.text());
    if (this.o.pauseMs) await sleep(this.o.pauseMs);
    return page;
  }

  private async fetchWindow(deviceId: string, start: number, end: number, pages: MAPage[]) {
    const page = await this.fetchPage(deviceId, start, end);
    if (page.rows.length >= this.o.pageLimit && end - start > 30 * 60_000) {
      const mid = start + Math.floor((end - start) / 2);
      await this.fetchWindow(deviceId, start, mid, pages);
      await this.fetchWindow(deviceId, mid, end, pages);
    } else {
      pages.push(page);
    }
  }

  /** Toutes les mesures de ]since, until], par fenêtres successives. */
  async fetchSince(deviceId: string, sinceMs: number, untilMs: number): Promise<FetchResult> {
    const pages: MAPage[] = [];
    for (let start = sinceMs; start < untilMs; start += this.o.windowMs) {
      await this.fetchWindow(deviceId, start, Math.min(start + this.o.windowMs, untilMs), pages);
    }
    const deviceName = pages.find((p) => p.deviceName)?.deviceName ?? null;
    const headers = pages.reduce<string[]>((h, p) => (p.headers.length > h.length ? p.headers : h), []);

    // Chaque page est la plus récente en premier : on remet dans l'ordre chronologique
    const naive = pages.flatMap((p) => [...p.rows].reverse());
    const utcs = localizeAscending(naive.map((r) => r[0]), this.o.tz);
    const seen = new Set<number>();
    const rows: FetchResult["rows"] = [];
    naive.forEach(([, values], i) => {
      const t = utcs[i];
      if (t <= sinceMs || seen.has(t)) return;
      seen.add(t);
      rows.push([t, values]);
    });
    rows.sort((a, b) => a[0] - b[0]);
    return { deviceName, headers, rows };
  }
}
