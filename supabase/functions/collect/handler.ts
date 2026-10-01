// Logique de la collecte, indépendante du runtime (testable sous Node).

import { MAClient } from "../_shared/ma_client.ts";

export interface Rpc {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface CollectOptions {
  devices?: string[];       // limiter à certains capteurs
  lookbackDays?: number;    // relecture forcée des N derniers jours
  now?: number;
  maxWindows?: number;      // fenêtres (jours) au plus par capteur et par appel : le rattrapage se poursuit à l'appel suivant
  budgetMs?: number;        // au-delà, on ne commence plus de nouveau capteur (limite de durée des Edge Functions)
}

export interface DeviceResult {
  ma_id: string;
  status: "OK" | "ERROR" | "SKIPPED";
  received?: number;
  inserted?: number;
  error?: string;
}

const DAY = 86_400_000;

export async function runCollect(db: Rpc, client: MAClient, opts: CollectOptions = {}): Promise<DeviceResult[]> {
  const started = Date.now();
  const now = opts.now ?? Date.now();
  const maxWindows = opts.maxWindows ?? 10;
  const budgetMs = opts.budgetMs ?? 110_000;

  const { data, error } = await db.rpc("collect_targets", {
    p_lookback: opts.lookbackDays ? `${opts.lookbackDays} days` : null,
  });
  if (error) throw new Error(`collect_targets : ${error.message}`);
  let targets = data as { ma_id: string; since: string }[];
  if (opts.devices?.length) {
    const wanted = new Set(opts.devices.map((d) => d.toUpperCase()));
    targets = targets.filter((t) => wanted.has(t.ma_id));
  }

  const results: DeviceResult[] = [];
  for (const target of targets) {
    if (Date.now() - started > budgetMs) {
      results.push({ ma_id: target.ma_id, status: "SKIPPED" });
      continue;
    }
    const since = Date.parse(target.since);
    const until = Math.min(now, since + maxWindows * DAY);
    try {
      const res = await client.fetchSince(target.ma_id, since, until);
      const { data: out, error: err } = await db.rpc("ingest_readings", {
        p_ma_id: target.ma_id,
        p_device_name: res.deviceName,
        p_headers: res.headers,
        p_rows: res.rows.map(([t, v]) => ({ ts: new Date(t).toISOString(), v })),
        p_run_at: new Date(now).toISOString(),
        p_synced_until: new Date(until).toISOString(),
      });
      if (err) throw new Error(err.message);
      const o = out as { received: number; inserted: number };
      results.push({ ma_id: target.ma_id, status: "OK", received: o.received, inserted: o.inserted });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db.rpc("record_sync_error", { p_ma_id: target.ma_id, p_message: message });
      results.push({ ma_id: target.ma_id, status: "ERROR", error: message });
    }
  }
  return results;
}
