// Sous-ensemble d'ECharts réellement utilisé (allège le paquet)
import * as echarts from "echarts/core";
import { LineChart, ScatterChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import langFR from "echarts/i18n/langFR-obj.js";

// Points et lignes de seuil des alertes : ScatterChart, MarkLineComponent ; périodes sans mesure : MarkAreaComponent
echarts.use([LineChart, ScatterChart, GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent,
  MarkAreaComponent, CanvasRenderer]);
echarts.registerLocale("FR", langFR as Parameters<typeof echarts.registerLocale>[1]);

export { echarts };
