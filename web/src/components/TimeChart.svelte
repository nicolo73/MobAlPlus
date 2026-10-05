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
  import { curveData, type CurveMode } from "../lib/curve";

  export interface ChartSeries {
    id: number;
    name: string;
    color: string;
    points: Point[];
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
  }

  let { series, unit, loaded, window, onwindow, loading = false, height = 280, group, label, curve = "step" }: Props = $props();

  let el: HTMLDivElement;
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

  function option() {
    const text = cssVar("--text"), muted = cssVar("--muted"), border = cssVar("--border"), surface = cssVar("--surface");
    // Étiquettes en bout de courbe de 2 à 4 séries ; une seule série est nommée par le titre
    const endLabels = series.length >= 2 && series.length <= 4;
    return {
      animation: false,
      backgroundColor: "transparent",
      textStyle: { fontFamily: "inherit" },
      grid: { left: 8, right: endLabels ? 96 : 16, top: 12, bottom: 64, containLabel: true },
      xAxis: {
        type: "time", min: loaded[0], max: loaded[1],
        axisLine: { lineStyle: { color: border } }, axisTick: { lineStyle: { color: border } },
        axisLabel: {
          color: muted, hideOverlap: true,
          formatter: { year: "{yyyy}", month: "{MMM} {yyyy}", day: "{d} {MMM}", hour: "{HH}:{mm}", minute: "{HH}:{mm}", second: "{HH}:{mm}:{ss}" },
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value", scale: true,
        axisLabel: { color: muted, formatter: (v: number) => fmt(v) },
        splitLine: { lineStyle: { color: border, opacity: 0.6 } },
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: surface, borderColor: border, textStyle: { color: text },
        axisPointer: { type: "line", lineStyle: { color: muted, width: 1 } },
        formatter: (params: { axisValue: number; seriesName: string; color: string; value: [number, number | null] }[]) => {
          const rows = params
            .filter((p) => p.value[1] != null)
            .map((p) => `<div style="display:flex;align-items:center;gap:.5rem">
              <span style="display:inline-block;width:14px;height:2px;background:${p.color}"></span>
              <b style="min-width:4.5rem">${fmt(p.value[1]!)} ${escapeHtml(unit)}</b>
              <span style="color:${muted}">${escapeHtml(p.seriesName)}</span></div>`)
            .join("");
          return `<div style="font-size:12px;color:${muted};margin-bottom:4px">${fmtTime(params[0]?.axisValue)}</div>${rows}`;
        },
      },
      dataZoom: [
        { type: "inside", xAxisIndex: 0, filterMode: "none", startValue: window[0], endValue: window[1],
          zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false },
        { type: "slider", xAxisIndex: 0, filterMode: "none", startValue: window[0], endValue: window[1],
          height: 24, bottom: 8, borderColor: border, fillerColor: "rgba(127,127,127,0.12)",
          dataBackground: { lineStyle: { color: muted, opacity: 0.5 }, areaStyle: { opacity: 0 } },
          selectedDataBackground: { lineStyle: { color: muted }, areaStyle: { opacity: 0 } },
          handleStyle: { color: surface, borderColor: muted }, moveHandleStyle: { color: muted, opacity: 0.4 },
          textStyle: { color: muted }, labelFormatter: (v: number) =>
            new Date(v).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }),
          brushSelect: false },
      ],
      series: series.map((s) => ({
        id: String(s.id), name: s.name, type: "line",
        // Lissage monotone : pas de faux pics au-delà des valeurs mesurées
        ...(curve === "step" ? { step: "end", smooth: false } : { step: false, smooth: 0.35, smoothMonotone: "x" }),
        showSymbol: false, symbolSize: 8, sampling: undefined,
        lineStyle: { width: 2, color: s.color }, itemStyle: { color: s.color, borderColor: surface, borderWidth: 2 },
        emphasis: { focus: "series", lineStyle: { width: 2 } },
        endLabel: endLabels ? { show: true, formatter: "{a}", color: muted, fontSize: 11, width: 88, overflow: "truncate" } : { show: false },
        labelLayout: { moveOverlap: "shiftY" },
        data: curveData(s.points, curve),
      })),
    };
  }

  function render() {
    if (!chart) return;
    chart.setOption(option(), { replaceMerge: ["series"] });
    applied = [window[0], window[1]];
  }

  onMount(() => {
    let disposed = false;
    const ro = new ResizeObserver(() => chart?.resize());
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => render();
    loadLib().then(({ echarts }) => {
      if (disposed) return;
      chart = echarts.init(el, null, { locale: "FR", renderer: "canvas" });
      if (group) { chart.group = group; echarts.connect(group); }
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
      chart?.dispose();
    };
  });

  // Données ou bornes changées : nouveau rendu complet
  $effect(() => {
    void series; void loaded; void unit; void curve;
    render();
  });

  // Fenêtre changée par les boutons (et non par un glissement sur la courbe) : on la déplace
  $effect(() => {
    const [s, e] = window;
    if (!chart || (Math.abs(s - applied[0]) < 1000 && Math.abs(e - applied[1]) < 1000)) return;
    applied = [s, e];
    chart.dispatchAction({ type: "dataZoom", startValue: s, endValue: e });
  });
</script>

<div class="chart" class:loading style="height:{height}px" bind:this={el} role="img" aria-label={label}></div>

<style>
  .chart { width: 100%; transition: opacity 0.2s; touch-action: pan-y; }
  .loading { opacity: 0.55; }
</style>
