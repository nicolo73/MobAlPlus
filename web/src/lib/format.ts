const nf = new Intl.NumberFormat("fr-FR");

export const fmtInt = (n: number | null | undefined) => (n == null ? "–" : nf.format(n));

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "–";
  const units = ["o", "Ko", "Mo", "Go"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
}

export function fmtValue(v: number | null, unit: string): string {
  if (v == null) return "–";
  const digits = unit === "%" ? 0 : 1;
  return `${v.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${unit === "%" ? " %" : ` ${unit}`}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** « il y a 5 min », « il y a 3 h », « il y a 2 j » */
export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "jamais";
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86_400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86_400)} j`;
}

/** Une mesure de plus de 2 h est considérée comme ancienne (capteur muet ou pile faible) */
export const isStale = (iso: string | null | undefined, now = Date.now()) =>
  !iso || now - new Date(iso).getTime() > 2 * 3600_000;

export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
