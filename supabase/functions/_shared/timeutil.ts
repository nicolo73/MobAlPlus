// Heures locales du site Mobile Alerts <-> UTC (équivalent de backend/mobalplus/timeutil.py).
//
// Le site affiche des heures locales sans fuseau et attend fromepoch / toepoch exprimés comme
// « heure locale encodée comme si c'était de l'UTC ». En interne, une heure locale est représentée
// par son « wall time » : millisecondes Date.UTC(année, mois, jour, h, min, s) de l'heure affichée.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Décalage (ms) de l'heure locale par rapport à l'UTC à l'instant donné. */
export function offsetAt(instantMs: number, tz: string): number {
  const parts: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(instantMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wall - Math.floor(instantMs / 1000) * 1000;
}

/** Epoch (secondes) attendu par le site : heure locale lue comme de l'UTC. */
export function toMaEpoch(instantMs: number, tz: string): number {
  return Math.floor((instantMs + offsetAt(instantMs, tz)) / 1000);
}

const PATTERNS: [RegExp, (m: RegExpMatchArray) => number[]][] = [
  // 01/01/2025 00:06:15  ou  01.01.2025 00:06
  [/^(\d{1,2})[./](\d{1,2})[./](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/,
    (m) => [+m[3], +m[2], +m[1], +m[4], +m[5], +(m[6] ?? 0)]],
  // 2025-01-01 00:06:15
  [/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/,
    (m) => [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0)]],
];

/** « 01/01/2025 00:06:15 » -> wall time (ms). */
export function parseLocalTimestamp(text: string): number {
  const s = text.replace(/\s+/g, " ").trim();
  for (const [re, f] of PATTERNS) {
    const m = s.match(re);
    if (m) {
      const [y, mo, d, h, mi, se] = f(m);
      return Date.UTC(y, mo - 1, d, h, mi, se);
    }
  }
  throw new Error(`Format de date non reconnu : ${text}`);
}

/**
 * Convertit des wall times, dans l'ordre chronologique réel, en instants UTC (ms).
 * Au passage à l'heure d'hiver, l'heure 02:00-03:00 existe deux fois : on prend la seconde
 * occurrence dès que la première ferait reculer le temps.
 */
export function localizeAscending(walls: number[], tz: string): number[] {
  const out: number[] = [];
  let prev: number | null = null;
  for (const w of walls) {
    const candidates = new Set<number>();
    for (const probe of [w - 3 * 3600_000, w + 3 * 3600_000]) {
      const off = offsetAt(probe, tz);
      const utc = w - off;
      if (offsetAt(utc, tz) === off) candidates.add(utc);
    }
    const sorted = [...candidates].sort((a, b) => a - b);
    // Heure inexistante (passage à l'heure d'été) : décalage d'avant la transition
    let utc = sorted.length ? sorted[0] : w - offsetAt(w - 3 * 3600_000, tz);
    if (prev !== null && sorted.length === 2 && sorted[0] <= prev && prev < sorted[1]) utc = sorted[1];
    out.push(utc);
    prev = utc;
  }
  return out;
}
