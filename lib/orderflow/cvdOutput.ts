import type { SeriesSpec } from "@luxalgo/vela";
import type { DeltaCandle } from "./cvdModel";
import type { CvdPreferences } from "./cvdSettings";
export function cvdSeries(bars: DeltaCandle[], style: CvdPreferences): SeriesSpec[] {
  const identity = { id: "cvd", title: style.calculation === "Bar delta" ? "Bar delta" : "CVD", paneId: "" };
  const series: SeriesSpec[] = [style.plot === "Candles" ? { ...identity, kind: "candle", bars,
    style: { up: style.upColor, down: style.downColor, wickUp: style.wickUpColor, wickDown: style.wickDownColor, borderUp: style.borderUpColor, borderDown: style.borderDownColor } }
    : { ...identity, kind: style.plot === "Histogram" ? "histogram" : style.plot === "Area" ? "area" : "line", points: bars.map(bar => ({ time: bar.time, value: Number.isFinite(bar.close) ? bar.close : null,
      ...(style.calculation === "Bar delta" && style.plot === "Histogram" ? { color: bar.close >= 0 ? style.upColor : style.downColor } : {}) })),
      style: { color: style.color, width: style.lineWidth, lineStyle: "solid", ...(["Histogram", "Area"].includes(style.plot) ? { base: 0 } : {}) } }];
  if (style.plot === "Candles") {
    series[0].display = { dataWindow: false };
    for (const field of ["open", "high", "low", "close"] as const) series.push({ id: `cvd-${field}`, title: `${identity.title} ${field.charAt(0).toUpperCase()}${field.slice(1)}`, paneId: "", kind: "line",
      display: { pane: false, priceScale: false, legend: false, dataWindow: true },
      points: bars.map(bar => ({ time: bar.time, value: Number.isFinite(bar[field]) ? bar[field] : null })), style: { color: style.color, width: 1, lineStyle: "solid" } });
  }
  return series;
}
/** Empty series removal leaves stale native renderer buffers in pinned Vela0.9.0.
 * Explicit missing slots overwrite old data, including candle readout aliases. */
export function emptyCvdSeries(bars: readonly { time: number }[], style: CvdPreferences): SeriesSpec[] {
  return cvdSeries(bars.map(bar => ({ time: bar.time, open: NaN, high: NaN, low: NaN, close: NaN, volume: 0 })), style);
}
