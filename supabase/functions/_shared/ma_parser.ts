// Analyse de la page MeasurementDetails (équivalent de backend/mobalplus/ma_parser.py).
// Sans dépendance : marqueurs du script d'origine (<h3>, table.table-striped, td.timestamp, td.measurement).

import { parseLocalTimestamp } from "./timeutil.ts";

// Valeurs spéciales documentées par Mobile Alerts (capteur non connecté / hors plage)
const SPECIAL_VALUES = new Set([43530, 65295]);

export interface MAPage {
  deviceName: string | null;
  headers: string[];
  /** [wall time (ms), valeurs par colonne], dans l'ordre de la page (plus récent en premier) */
  rows: [number, (number | null)[]][];
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return NAMED[code.toLowerCase()] ?? all;
  });
}

function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function cells(html: string, tag: "th" | "td", cls: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*class\\s*=\\s*["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  return [...html.matchAll(re)].map((m) => text(m[1]));
}

export function parseValue(s: string | null | undefined): number | null {
  if (s == null) return null;
  const m = s.match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const v = parseFloat(m[0].replace(",", "."));
  return SPECIAL_VALUES.has(v) ? null : v;
}

export function parseMeasurementDetails(html: string): MAPage {
  const h3 = html.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
  const deviceName = h3 ? text(h3[1]) : null;

  const start = html.search(/<table\b[^>]*class\s*=\s*["'][^"']*table-striped/i);
  if (start < 0) return { deviceName, headers: [], rows: [] };
  const end = html.indexOf("</table>", start);
  const table = html.slice(start, end < 0 ? undefined : end);

  const headers = cells(table, "th", "measurement");
  const rows: MAPage["rows"] = [];
  for (const tr of table.split(/<tr\b/i).slice(1)) {
    const ts = cells(tr, "td", "timestamp");
    if (!ts.length) continue;
    rows.push([parseLocalTimestamp(ts[0]), cells(tr, "td", "measurement").map(parseValue)]);
  }
  return { deviceName, headers, rows };
}
