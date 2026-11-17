import type { NativeIndicatorContext, NativeIndicatorDescriptor, OHLCV } from "@luxalgo/vela";
import { validChartColor } from "@/lib/chart/appearance";
import { FixedProfileCache } from "./fixedProfileModel";
import { ExecutionRangeProfileCache } from "./executionRangeProfile";
import { BackgroundProfile } from "./backgroundProfile";
import type { RangeVolumeSource } from "./executionRangeSource";

export interface VisibleProfileSettings { rows: number; widthPct: number; valueAreaPct: number; upColor: string; downColor: string; showPoc: boolean; volumeSource: RangeVolumeSource }
export const defaultVisibleProfile = (): VisibleProfileSettings => ({ rows: 24, widthPct: 30, valueAreaPct: 70, upColor: "#2962ff", downColor: "#f23645", showPoc: true, volumeSource: "OHLCV estimate" });
export function visibleProfileSettings(values: Record<string, unknown>): VisibleProfileSettings {
  const result = defaultVisibleProfile();
  for (const [key, min, max] of [["rows", 2, 400], ["widthPct", 5, 90], ["valueAreaPct", 0, 100]] as const) {
    const value = values[key]; if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) throw new Error(`Choose ${key} between ${min} and ${max}.`);
    result[key] = value;
  }
  for (const key of ["upColor", "downColor"] as const) if (validChartColor(values[key])) result[key] = values[key];
  if (typeof values.showPoc === "boolean") result.showPoc = values.showPoc;
  if (values.volumeSource !== undefined && values.volumeSource !== "OHLCV estimate" && values.volumeSource !== "Classified executions") throw new Error("Choose an available range-profile volume source.");
  if (values.volumeSource === "Classified executions") result.volumeSource = values.volumeSource;
  return result;
}
/** Range-aware model: every selected bar is compared by value, so older candle
 * repairs with unchanged endpoints cannot reuse the native's stale memo key. */
export class VisibleProfileCache {
  private cache = new FixedProfileCache();
  readonly executions = new ExecutionRangeProfileCache();
  readonly background = new BackgroundProfile();
  select(bars: readonly OHLCV[], from: number, to: number) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) throw new Error("The visible bar range is unavailable.");
    const first = Math.max(0, Math.floor(from)), last = Math.min(bars.length - 1, Math.ceil(to));
    return first <= last ? bars.slice(first, last + 1) : [];
  }
  read(bars: readonly OHLCV[], from: number, to: number, style: VisibleProfileSettings) {
    return this.cache.read(this.select(bars, from, to), { rows: style.rows, valueAreaPct: style.valueAreaPct, developing: false });
  }
}
export function visibleProfileDescriptor(): NativeIndicatorDescriptor {
  return { type: "af-visible-profile", title: "Visible Range Volume Profile", shortTitle: "VRVP", overlay: true, paneHint: "price", multiInstance: true,
    inputsSchema: () => [
      { key: "rows", title: "Rows", type: "int", defval: 24, min: 2, max: 400, step: 1 },
      { key: "widthPct", title: "Width %", type: "int", defval: 30, min: 5, max: 90, step: 1 },
      { key: "upColor", title: "Up color", type: "color", defval: "#2962ff" },
      { key: "downColor", title: "Down color", type: "color", defval: "#f23645" },
      { key: "showPoc", title: "Point of control", type: "bool", defval: true },
      { key: "valueAreaPct", title: "Value area %", type: "int", defval: 70, min: 0, max: 100, step: 1 },
      { key: "volumeSource", title: "Volume source", type: "string", defval: "OHLCV estimate", options: ["OHLCV estimate", "Classified executions"] },
    ],
    defaultInputs: () => ({ ...defaultVisibleProfile() }), create: () => {
      let context: NativeIndicatorContext | undefined, values: Record<string, string | number | boolean> = {}, active = false;
      const publish = () => { if (active && context) context.pushData({ ...values, __afProfileId: context.id }); };
      return {
        start(ctx, inputs) { context = ctx; values = inputs; active = true; ctx.emit({}); publish(); },
        onBars() {}, onViewport() {},
        setInputs(inputs) { values = inputs; publish(); },
        suspend() { active = false; context?.pushData(null); },
        resume() { active = true; publish(); },
        stop() { context?.pushData(null); active = false; context = undefined; },
      };
    } };
}
