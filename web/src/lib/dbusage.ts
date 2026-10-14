// Occupation de la base, présentée par rubriques : base générale, chaque maison (ses emplacements et
// capteurs), données publiques (stations partagées, avec les maisons qui les suivent).

import type { DbChannelUsage, DbUsage } from "./types";

export interface Sizes { detail: number; compact: number; simplified: number; weather: number; total: number }
export interface UsageRow { key: string; label: string; sub?: string; sizes: Sizes }
export interface UsageGroup extends UsageRow { children: UsageRow[] }

const zero = (): Sizes => ({ detail: 0, compact: 0, simplified: 0, weather: 0, total: 0 });
function add(s: Sizes, c: Pick<DbChannelUsage, "detail" | "compact" | "simplified" | "weather">) {
  s.detail += c.detail; s.compact += c.compact; s.simplified += c.simplified; s.weather += c.weather;
  s.total += c.detail + c.compact + c.simplified + c.weather;
}

export function usageTree(u: DbUsage): { general: UsageRow; groups: UsageGroup[]; attributed: number } {
  const homes = new Map(u.homes.map((h) => [h.id, h]));
  const groups = new Map<number, UsageGroup>();
  const rows = new Map<string, UsageRow>();
  for (const c of u.channels) {
    const h = homes.get(c.home_id);
    if (!groups.has(c.home_id)) {
      groups.set(c.home_id, {
        key: `h${c.home_id}`, children: [], sizes: zero(),
        label: h?.commons ? "Données publiques (stations partagées)" : h?.name ?? `Maison ${c.home_id}`,
        sub: h?.commons ? undefined : h?.owners.length ? h.owners.join(", ") : undefined,
      });
    }
    const g = groups.get(c.home_id)!;
    add(g.sizes, c);
    // Une ligne par emplacement et capteur (ses canaux réunis)
    const key = `h${c.home_id}-p${c.place_id ?? "x"}-d${c.device_id}`;
    if (!rows.has(key)) {
      let sub = c.place_name ? c.device_name : undefined;
      if (h?.commons && c.place_id != null) {
        const users = u.links.filter((l) => l.place_id === c.place_id).map((l) => homes.get(l.home_id)?.name ?? `#${l.home_id}`);
        sub = users.length ? `suivie par : ${users.join(", ")}` : "suivie par aucune maison (plus collectée)";
      }
      const row: UsageRow = { key, label: c.place_name ?? `${c.device_name} (non affecté)`, sub, sizes: zero() };
      rows.set(key, row);
      g.children.push(row);
    }
    add(rows.get(key)!.sizes, c);
  }
  const list = [...groups.values()];
  for (const g of list) g.children.sort((a, b) => b.sizes.total - a.sizes.total);
  // Maisons d'abord (les plus lourdes), données publiques à la fin
  list.sort((a, b) => Number(a.label.startsWith("Données")) - Number(b.label.startsWith("Données")) || b.sizes.total - a.sizes.total);
  const attributed = list.reduce((t, g) => t + g.sizes.total, 0);
  const rest = Math.max(0, u.total_bytes - attributed);
  return {
    general: { key: "general", label: "Base générale", sub: "comptes, réglages, emplacements, index, système",
               sizes: { ...zero(), total: rest } },
    groups: list, attributed,
  };
}
