<script lang="ts" module>
  // ECharts chargé à la demande (les pages sans courbe restent légères)
  let lib: Promise<typeof import("./echarts")> | null = null;
  const loadLib = () => (lib ??= import("./echarts"));
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import type { ECharts } from "echarts/core";
  import { cssVar } from "../lib/colors";
  import type { Window } from "../lib/period";
  import type { Point } from "../lib/types";
  import { GAP, curveData, valueAt, type CurveMode } from "../lib/curve";
  import { WEEKLY_FROM, gridLines, scaleOf, weeklyBands, type DayBand } from "../lib/longview";

  export interface ChartSeries {
    id: number | string;
    name: string;
    color: string;
    points: Point[];
    /** Courbe calculée (moyenne d'un groupe) : tracé en tirets */
    dashed?: boolean;
    /** Courbe de référence (météo publique) : pointillés fins */
    dotted?: boolean;
    /** Prévision (dans le futur) : trait mixte, plus pâle */
    forecast?: boolean;
    /** Temps long : bande min – max par jour (à la place des points) */
    band?: DayBand[];
  }

  interface Props {
    series: ChartSeries[];
    unit: string;
    /** Période chargée : bornes de l'axe, jusqu'où l'on peut glisser */
    loaded: Window;
    /** Fenêtre visible */
    window: Window;
    onwindow?: (w: Window) => void;
    loading?: boolean;
    height?: number;
    /** Courbes synchronisées (curseur et glissement communs) */
    group?: string;
    label: string;
    /** Rendu (affichage seulement) : escalier fidèle, lissé ou simplifié */
    curve?: CurveMode;
    /** Seuils d'alerte : lignes horizontales en tirets */
    thresholds?: { value: number; level: "info" | "warning"; label: string }[];
    /** Points en alerte (mesures au-delà d'un seuil, pics, creux) */
    alertPoints?: { ts: number; value: number; level: "info" | "warning"; label?: string }[];
    /** Points d'alerte seulement sur grand écran ou en plein écran (courbes superposées) */
    alertsWideOnly?: boolean;
    /** Périodes sans mesure (capteur muet) : zones grisées */
    gaps?: [number, number][];
    /** Durée sans mesure au-delà de laquelle la courbe est coupée (48 h par défaut) */
    cutAfter?: number;
    /**
     * Mode curseur (page Synthèse) : pas d'infobulle ; un trait vertical marque l'instant choisi
     * (`cursor`), déplacé en touchant ou survolant la courbe (`oncursor`) ; les valeurs sont
     * affichées par la page, sous le graphique.
     */
    cursor?: number | null;
    oncursor?: (t: number) => void;
    /** Bouton plein écran */
    fullscreen?: boolean;
    /** Courbes mises en évidence (identifiants) : les autres s'estompent */
    highlight?: string[];
  }

  let { series, unit, loaded, window, onwindow, loading = false, height = 280, group, label, curve = "step",
        thresholds = [], alertPoints = [], alertsWideOnly = false, gaps = [], cutAfter = GAP,
        cursor = null, oncursor, fullscreen = true, highlight = [] }: Props = $props();

  let el: HTMLDivElement;
  let box: HTMLDivElement;
  /** Plein écran : API du navigateur quand elle existe (et paysage sur Android), sinon superposition */
  let full = $state(false);
  let chart: ECharts | null = null;
  let applied: Window = [0, 0];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const decimals = $derived(unit === "%" ? 0 : 1);
  const fmt = (v: number) => v.toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const fmtTime = (t: number) =>
    new Date(t).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  function escapeHtml(s: string) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  }

  const HOUR = 3_600_000;
  /** Échelle des repères et affichage des points : nouveau rendu quand elle change (zoom) */
  const scaleKey = $derived(`${scaleOf(window)}-${window[1] - window[0] > 7.5 * 86_400_000}-${window[1] - window[0] > WEEKLY_FROM}`);
  /** Fin de la prévision la plus lointaine (0 sans prévision) */
  const futureEnd = $derived(Math.max(0, ...series.filter((s) => s.forecast).map((s) => s.points.at(-1)?.ts ?? 0)));
  /**
   * Fenêtre affichée : celle de la page, prolongée d'une heure dans le futur quand une prévision
   * existe et que la fenêtre se termine maintenant (on glisse la barre pour voir plus loin)
   */
  function shown([s, e]: Window): Window {
    const now = Date.now();
    return futureEnd > now + HOUR / 2 && Math.abs(e - now) <= 10 * 60_000 ? [s, now + HOUR] : [s, e];
  }

  function option() {
    const text = cssVar("--text"), muted = cssVar("--muted"), border = cssVar("--border"), surface = cssVar("--surface");
    const now = Date.now();
    const axisMax = Math.max(loaded[1], futureEnd);
    const [ws, we] = shown(window);
    // Repères verticaux selon la largeur visible ; au-delà d'une semaine, pas de points d'alerte
    // (trop nombreux) ni de quadrillage horaire
    const scale = scaleOf([ws, we]);
    const long = we - ws > 7.5 * 86_400_000;   // « 7 j » (plus l'heure de prévision) garde ses points
    // Étiquettes en bout de courbe de 2 à 4 séries ; une seule série est nommée par le titre
    // (pas sur écran étroit : la place va à la courbe, les couleurs sont rappelées au-dessus)
    const measured = series.filter((s) => !s.forecast).length;
    const endLabels = measured >= 2 && measured <= 4 && (el?.clientWidth ?? 0) >= 500;
    const dashed = new Set(series.filter((s) => s.dashed || s.forecast).map((s) => s.name));
    const dotted = new Set(series.filter((s) => s.dotted).map((s) => s.name));
    // Points tracés, gardés pour l'infobulle : valeur de chaque courbe à l'instant pointé
    const prepared = series.map((s) => ({ s, data: curveData(s.points, curve, cutAfter) }));
    const levelColor = (l: "info" | "warning") => cssVar(l === "warning" ? "--err" : "--hum");
    const showPoints = alertPoints.length > 0 && !long && (!alertsWideOnly || full || (el?.clientWidth ?? 0) >= 500);
    // Au-delà de ~3 mois : une bande par semaine (moyennes des min et max journaliers)
    const weekly = we - ws > WEEKLY_FROM;
    const bandsOf = (s: ChartSeries) => (weekly ? weeklyBands(s.band ?? []) : s.band ?? []);
    /** Bande d'une courbe à l'instant t (le jour, ou la semaine) */
    const bandAt = (b: DayBand[], t: number) => b.find((x) => Math.abs(x.ts - t) <= (weekly ? 3.5 : 0.5) * 86_400_000) ?? null;
    // Échelle : les seuils proches des mesures sont inclus, les seuils lointains n'écrasent pas la courbe
    const near = (v: { min: number; max: number }) => {
      const span = Math.max(v.max - v.min, unit === "%" ? 5 : 1);
      return thresholds.map((t) => t.value).filter((x) => x >= v.min - span && x <= v.max + span);
    };
    return {
      animation: false,
      backgroundColor: "transparent",
      textStyle: { fontFamily: "inherit" },
      // Mode curseur : marge gauche fixe, pour que les traits de plusieurs courbes soient alignés
      grid: oncursor ? { left: 46, right: 16, top: 12, bottom: 64, containLabel: false }
        : { left: 8, right: endLabels ? 96 : 16, top: 12, bottom: 64, containLabel: true },
      xAxis: {
        type: "time", min: loaded[0], max: axisMax,
        axisLine: { lineStyle: { color: border } }, axisTick: { lineStyle: { color: border } },
        axisLabel: {
          color: muted, hideOverlap: true,
          formatter: { year: "{yyyy}", month: "{MMM} {yyyy}", day: "{d} {MMM}", hour: "{HH}:{mm}", minute: "{HH}:{mm}", second: "{HH}:{mm}:{ss}" },
        },
        // Lignes verticales aux graduations (heures, jours, semaines… selon le zoom)
        splitLine: { show: scale === "day", lineStyle: { color: border, opacity: 0.45 } },
      },
      yAxis: {
        type: "value", scale: true,
        min: (v: { min: number; max: number }) => Math.min(v.min, ...near(v)),
        max: (v: { min: number; max: number }) => Math.max(v.max, ...near(v)),
        axisLabel: { color: muted, formatter: (v: number) => fmt(v) },
        splitLine: { lineStyle: { color: border, opacity: 0.6 } },
        // Plein écran : graduations plus nombreuses et lignes intermédiaires sans étiquette
        splitNumber: full ? 8 : 5,
        minorTick: { show: full, splitNumber: 5, lineStyle: { color: border } },
        minorSplitLine: { show: full, lineStyle: { color: border, opacity: 0.3 } },
      },
      tooltip: oncursor ? {
        // Mode curseur : le pointeur ne sert qu'à choisir l'instant (trait propre, persistant)
        trigger: "axis", showContent: false,
        axisPointer: { type: "line", lineStyle: { opacity: 0 } },
      } : {
        trigger: "axis",
        backgroundColor: surface, borderColor: border, textStyle: { color: text },
        confine: true,
        axisPointer: { type: "line", lineStyle: { color: muted, width: 1 } },
        // Toutes les courbes à l'instant pointé, même si leurs mesures ne tombent pas au même instant
        // (ECharts ne garderait que la courbe dont un point est le plus proche) ; de la plus haute à
        // la plus basse, comme sur le graphique
        formatter: (params: { axisValue: number }[]) => {
          const t = params[0]?.axisValue;
          if (t == null) return "";
          const banded = series.some((s) => s.band);
          const rows = prepared
            .map(({ s, data }) => {
              if (s.band) { const b = bandAt(bandsOf(s), t); return { s, v: b?.max ?? null, text: b ? `${fmt(b.min)} – ${fmt(b.max)}` : "" }; }
              const v = valueAt(data, t, curve !== "step");
              return { s, v, text: v === null ? "" : fmt(v) };
            })
            .filter((r): r is { s: ChartSeries; v: number; text: string } => r.v !== null)
            .sort((a, b) => b.v - a.v)
            .map(({ s, text }) => `<div style="display:flex;align-items:center;gap:.5rem">
              <span style="display:inline-block;width:14px;border-top:2px ${dotted.has(s.name) ? "dotted" : dashed.has(s.name) ? "dashed" : "solid"} ${s.color}"></span>
              <b style="min-width:4.5rem">${text} ${escapeHtml(unit)}</b>
              <span style="color:${muted}">${escapeHtml(s.name)}</span></div>`)
            .join("");
          const when = !banded ? fmtTime(t)
            : weekly ? `semaine du ${new Date(t - ((new Date(t).getDay() + 6) % 7) * 86_400_000).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })} · moyennes des min et max`
            : `${new Date(t).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" })} · min – max du jour`;
          return `<div style="font-size:12px;color:${muted};margin-bottom:4px">${when}</div>${rows}`;
        },
      },
      dataZoom: [
        // Dans le graphique : zoom seulement (molette, deux doigts) ; un glissement déplace le curseur
        // des valeurs. On se déplace dans le temps avec la barre du dessous et ses poignées.
        { type: "inside", xAxisIndex: 0, filterMode: "none", startValue: ws, endValue: we,
          zoomOnMouseWheel: true, moveOnMouseMove: false, moveOnMouseWheel: false, preventDefaultMouseMove: false },
        { type: "slider", xAxisIndex: 0, filterMode: "none", startValue: ws, endValue: we,
          height: 28, bottom: 8, left: 40, right: 40, handleSize: "120%", borderColor: border, fillerColor: "rgba(127,127,127,0.12)",
          dataBackground: { lineStyle: { color: muted, opacity: 0.5 }, areaStyle: { opacity: 0 } },
          selectedDataBackground: { lineStyle: { color: muted }, areaStyle: { opacity: 0 } },
          handleStyle: { color: surface, borderColor: muted }, moveHandleStyle: { color: muted, opacity: 0.4 },
          textStyle: { color: muted }, labelFormatter: (v: number) =>
            new Date(v).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }),
          brushSelect: false },
      ],
      series: [...withMarks(prepared.flatMap<object>(({ s, data }) => s.band ? bandSeries({ ...s, band: bandsOf(s) }, endLabels, muted, weekly) : [{
        id: String(s.id), name: s.name, type: "line",
        // Lissage monotone : pas de faux pics au-delà des valeurs mesurées
        ...(curve === "step" ? { step: "end", smooth: false } : { step: false, smooth: 0.35, smoothMonotone: "x" }),
        showSymbol: false, symbolSize: 8, sampling: undefined,
        lineStyle: { width: s.dotted ? 1.5 : 2, color: s.color, opacity: s.forecast ? 0.75 : 1,
                     type: s.forecast ? [7, 3, 1.5, 3] : s.dotted ? [2, 3] : s.dashed ? [6, 4] : "solid" },
        itemStyle: { color: s.color, borderColor: surface, borderWidth: 2 },
        emphasis: { focus: "series", lineStyle: { width: 3.5 } },
        blur: { lineStyle: { opacity: 0.18 } },
        endLabel: endLabels && !s.forecast ? { show: true, formatter: "{a}", color: muted, fontSize: 11, width: 88, overflow: "truncate" } : { show: false },
        labelLayout: { moveOverlap: "shiftY" },
        data,
      }]), {
        // Périodes sans mesure : grisé léger ; étiquette seulement si la période est assez large pour l'écrire
        ...(gaps.length ? {
          markArea: {
            silent: true, animation: false,
            itemStyle: { color: muted, opacity: 0.07 },
            label: { show: false, position: "insideTop", color: muted, fontSize: 10, formatter: "sans mesure" },
            data: gaps.map(([a, b]) => [{ xAxis: a, label: { show: b - a > (we - ws) / 12 } }, { xAxis: b }]),
          },
        } : {}),
        ...(thresholds.length ? {
          markLine: {
            silent: true, symbol: "none", animation: false,
            data: thresholds.map((t) => ({
              yAxis: t.value,
              lineStyle: { color: levelColor(t.level), type: [5, 4], width: t.level === "warning" ? 1.5 : 1, opacity: 0.85 },
              label: { formatter: t.label, position: "insideStartTop", color: levelColor(t.level), fontSize: 10 },
            })),
          },
        } : {}),
      }),
      // Repères verticaux : minuits jusqu'à une semaine, puis lundis, 1ers du mois ou 1ers janvier
      {
        id: "jours", type: "line", data: [], silent: true,
        markLine: {
          silent: true, symbol: "none", animation: false, label: { show: false },
          lineStyle: { color: muted, type: "solid", width: 1, opacity: scale === "day" ? 0.35 : 0.25 },
          data: gridLines(loaded[0], axisMax, scale).map((t) => ({ xAxis: t })),
        },
      },
      // Futur (prévisions) : zone légèrement grisée, trait « maintenant »
      ...(futureEnd > now ? [{
        id: "futur", type: "line", data: [], silent: true,
        markArea: { silent: true, animation: false, itemStyle: { color: muted, opacity: 0.07 },
                    // étiquette seulement si la partie future visible est assez large pour l'écrire
                    label: { show: we - Math.max(now, ws) > 0.2 * (we - ws), position: "insideTopLeft", color: muted, fontSize: 10, formatter: "prévision" },
                    data: [[{ xAxis: now }, { xAxis: axisMax }]] },
        markLine: { silent: true, symbol: "none", animation: false, lineStyle: { color: muted, type: [3, 3], width: 1 },
                    label: { show: false }, data: [{ xAxis: now }] },
      }] : []),
      ...(oncursor ? [cursorSeries()] : []),
      ...(showPoints ? [{
        id: "alertes", name: "Alertes", type: "scatter", silent: true, z: 5, animation: false,
        symbolSize: alertsWideOnly ? 9 : 6,
        data: alertPoints.map((p) => ({
          value: [p.ts, p.value],
          itemStyle: { color: levelColor(p.level), borderColor: surface, borderWidth: alertsWideOnly ? 1.5 : 0.5 },
          symbol: alertsWideOnly ? "triangle" : "circle",
        })),
      }] : [])],
    };
  }

  /** Trait vertical de l'instant choisi (mode curseur) */
  function cursorSeries() {
    return {
      id: "curseur", type: "line", data: [], silent: true, z: 6,
      markLine: {
        silent: true, symbol: ["none", "circle"], symbolSize: 7, animation: false, label: { show: false },
        lineStyle: { color: cssVar("--primary"), type: "solid", width: 1.5 },
        // reste net quand une courbe est mise en évidence
        blur: { lineStyle: { opacity: 1 }, itemStyle: { opacity: 1 } },
        data: cursor == null ? [] : [{ xAxis: cursor }],
      },
    };
  }

  /** Seuils et périodes sans mesure, portés par la première courbe */
  function withMarks<T extends object>(list: T[], marks: object): T[] {
    return list.map((x, i) => (i === 0 ? { ...x, ...marks } : x));
  }

  /**
   * Bande min – max d'une courbe (temps long) : minimum (trait fin), puis l'écart jusqu'au maximum
   * empilé dessus, rempli de la couleur de la courbe en plus léger ; le haut de l'empilement est le maximum.
   */
  function bandSeries(s: ChartSeries, endLabels: boolean, muted: string, weekly: boolean) {
    const band = s.band ?? [];
    const stack = `bande-${s.id}`;
    // Jour manquant : la bande s'interrompt
    const withBreaks = <V,>(f: (b: DayBand) => V) => band.flatMap((b, i) =>
      i > 0 && b.ts - band[i - 1].ts > (weekly ? 10 : 1.5) * 86_400_000 ? [[b.ts - 86_400_000, null], [b.ts, f(b)]] : [[b.ts, f(b)]]);
    const common = {
      type: "line", stack, stackStrategy: "all", showSymbol: false, smooth: curve === "step" ? false : 0.3,
      emphasis: { focus: "series", lineStyle: { width: 2.5 } }, blur: { lineStyle: { opacity: 0.18 }, areaStyle: { opacity: 0.05 } },
      lineStyle: { width: 1.2, color: s.color, type: s.dotted ? [2, 3] : s.dashed ? [6, 4] : "solid" },
      itemStyle: { color: s.color },
    };
    return [
      { ...common, id: `${s.id}-min`, name: s.name, data: withBreaks((b) => b.min) },
      { ...common, id: `${s.id}-range`, name: s.name, data: withBreaks((b) => b.max - b.min),
        areaStyle: { color: s.color, opacity: s.dotted ? 0.08 : 0.2 },
        endLabel: endLabels ? { show: true, formatter: "{a}", color: muted, fontSize: 11, width: 88, overflow: "truncate" } : { show: false } },
    ];
  }

  function render() {
    if (!chart) return;
    chart.setOption(option(), { replaceMerge: ["series"] });
    applied = [window[0], window[1]];
    applyHighlight();
  }

  /** Mise en évidence demandée par la page (ligne de légende survolée ou touchée) */
  function applyHighlight() {
    if (!chart) return;
    const n = ((chart.getOption() as { series?: unknown[] }).series ?? []).length;
    chart.dispatchAction({ type: "downplay", seriesIndex: [...Array(n).keys()] });
    // Une courbe en bande est faite de deux séries (minimum, écart jusqu'au maximum)
    if (highlight.length) chart.dispatchAction({ type: "highlight", seriesId: highlight.flatMap((id) => [id, `${id}-min`, `${id}-range`]) });
  }
  $effect(() => { void highlight; applyHighlight(); });

  type Orientation = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void };

  /**
   * Taille recalculée après une rotation ou la sortie du plein écran : le navigateur donne la
   * nouvelle largeur avec retard ; un canevas resté à la largeur du paysage élargirait la page
   * (affichage rétréci en portrait).
   */
  function settle() {
    for (const ms of [0, 150, 400, 800]) setTimeout(() => chart?.resize(), ms);
  }

  async function toggleFull() {
    if (full) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      try { (screen.orientation as Orientation).unlock?.(); } catch { /* non pris en charge */ }
      full = false;
      settle();
      return;
    }
    full = true;
    try {
      await box.requestFullscreen?.({ navigationUI: "hide" });
      await (screen.orientation as Orientation).lock?.("landscape");
    } catch { /* iPhone, ou paysage refusé : la superposition suffit */ }
  }

  onMount(() => {
    // Sortie du plein écran par le système (bouton retour, Échap)
    const onFs = () => {
      if (!document.fullscreenElement && full) {
        full = false;
        try { (screen.orientation as Orientation).unlock?.(); } catch { /* non pris en charge */ }
      }
      settle();
    };
    screen.orientation?.addEventListener?.("change", settle);
    addEventListener("orientationchange", settle);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && full && !document.fullscreenElement) full = false; };
    document.addEventListener("fullscreenchange", onFs);
    addEventListener("keydown", onKey);
    let disposed = false;
    let wide: boolean | null = null;
    const ro = new ResizeObserver(() => {
      if (!chart) return;
      chart.resize();
      // Étiquettes en bout de courbe selon la largeur disponible
      if (wide !== null && wide !== el.clientWidth >= 500) render();
      wide = el.clientWidth >= 500;
    });
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => render();
    loadLib().then(({ echarts }) => {
      if (disposed) return;
      chart = echarts.init(el, null, { locale: "FR", renderer: "canvas" });
      if (group) { chart.group = group; echarts.connect(group); }
      // Mode curseur : instant pointé (toucher, survol), gardé quand le pointeur quitte la courbe
      chart.on("updateAxisPointer", (e: unknown) => {
        const v = (e as { axesInfo?: { axisDim: string; value: number }[] }).axesInfo?.find((a) => a.axisDim === "x")?.value;
        if (v != null && oncursor) oncursor(Math.round(v));
      });
      chart.on("datazoom", () => {
        const dz = (chart!.getOption() as { dataZoom: { startValue: number; endValue: number }[] }).dataZoom[0];
        const w: Window = [Math.round(dz.startValue), Math.round(dz.endValue)];
        applied = w;
        clearTimeout(timer);
        timer = setTimeout(() => onwindow?.(w), 250);
      });
      render();
      ro.observe(el);
      scheme.addEventListener("change", onScheme);
    });
    return () => {
      disposed = true;
      clearTimeout(timer);
      ro.disconnect();
      scheme.removeEventListener("change", onScheme);
      document.removeEventListener("fullscreenchange", onFs);
      screen.orientation?.removeEventListener?.("change", settle);
      removeEventListener("orientationchange", settle);
      removeEventListener("keydown", onKey);
      chart?.dispose();
    };
  });

  // Données ou bornes changées : nouveau rendu complet
  $effect(() => {
    void series; void loaded; void unit; void curve; void thresholds; void alertPoints; void full; void gaps; void cutAfter; void scaleKey;
    render();
  });

  // Instant choisi déplacé : seul le trait est redessiné
  $effect(() => {
    void cursor;
    if (chart && oncursor) chart.setOption({ series: [cursorSeries()] });
  });

  // Fenêtre changée par les boutons (et non par un glissement sur la courbe) : on la déplace
  $effect(() => {
    const [s, e] = window;
    if (!chart || (Math.abs(s - applied[0]) < 1000 && Math.abs(e - applied[1]) < 1000)) return;
    applied = [s, e];
    const [ss, se] = shown([s, e]);
    chart.dispatchAction({ type: "dataZoom", startValue: ss, endValue: se });
  });
</script>

<div class="box" class:full bind:this={box}>
  {#if full}<div class="full-title">{label}</div>{/if}
  <div class="chart" class:loading style={full ? "" : `height:${height}px`} bind:this={el} role="img" aria-label={label}></div>
  {#if fullscreen || full}<button class="fs" onclick={toggleFull} title={full ? "Quitter le plein écran" : "Plein écran"}
          aria-label={full ? "Quitter le plein écran" : `Plein écran : ${label}`}>
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      {#if full}<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />{:else}<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />{/if}
    </svg>
  </button>{/if}
</div>

<style>
  /* Jamais plus large que son conteneur (canevas pas encore redimensionné après une rotation) */
  .box { position: relative; max-width: 100%; overflow: hidden; }
  .chart { width: 100%; max-width: 100%; overflow: hidden; transition: opacity 0.2s; touch-action: pan-y; }
  .loading { opacity: 0.55; }
  .fs { position: absolute; top: 0; right: 0; min-height: 0; padding: 0.3rem; border-radius: 6px;
        background: color-mix(in srgb, var(--surface) 80%, transparent); color: var(--muted); z-index: 2; }
  .fs:hover { color: var(--text); }
  .fs svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .full { position: fixed; inset: 0; z-index: 100; background: var(--surface); display: flex; flex-direction: column;
          padding: max(0.5rem, env(safe-area-inset-top)) max(0.5rem, env(safe-area-inset-right))
                   max(0.5rem, env(safe-area-inset-bottom)) max(0.5rem, env(safe-area-inset-left)); }
  .full .chart { flex: 1; min-height: 0; touch-action: none; }
  .full .fs { top: max(0.5rem, env(safe-area-inset-top)); right: max(0.5rem, env(safe-area-inset-right)); }
  .full-title { font-weight: 600; padding: 0.2rem 2.5rem 0.4rem 0.3rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
