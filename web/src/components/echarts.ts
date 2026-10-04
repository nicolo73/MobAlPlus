// Sous-ensemble d'ECharts réellement utilisé (allège le paquet)
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import langFR from "echarts/i18n/langFR-obj.js";

echarts.use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, CanvasRenderer]);
echarts.registerLocale("FR", langFR as Parameters<typeof echarts.registerLocale>[1]);

export { echarts };
