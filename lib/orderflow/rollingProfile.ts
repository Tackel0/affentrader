import type { InputSchema, OHLCV } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { bucketStart, nextBucket, parseInterval } from "@/lib/market/intervals";
import { ExecutionRangeProfileCache, rangeExecutions } from "./executionRangeProfile";
import { defaultVolumeProfile, resolveVolumeProfile, volumeProfileInputs, type VolumeProfilePreferences } from "./volumeProfileSettings";
import type { VolumeProfileModel } from "./volumeProfileModel";

export interface RollingProfileSettings extends VolumeProfilePreferences { bars: number }
export const defaultRollingProfile = (): RollingProfileSettings => ({ ...defaultVolumeProfile(), bars: 100, rows: 24, widthPercent: 30, placement: "Session end" });
export function resolveRollingProfile(values: Record<string, unknown>): RollingProfileSettings {
  const defaults = defaultRollingProfile(), bars = values.bars ?? defaults.bars;
  if (typeof bars !== "number" || !Number.isInteger(bars) || bars < 1 || bars > 50000) throw new Error("Rolling profile requires Bars 1–50,000.");
  for (const key of ["showHistogram", "showPoc", "showValueArea", "showLabels"] as const)
    if (values[key] !== undefined && typeof values[key] !== "boolean") throw new Error(`Invalid rolling profile ${key}.`);
  for (const key of ["buyColor", "sellColor", "outsideBuyColor", "outsideSellColor", "pocColor", "valueLineColor"] as const)
    if (values[key] !== undefined && (typeof values[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(values[key]))) throw new Error(`Invalid rolling profile ${key}.`);
  return { ...resolveVolumeProfile({ ...defaults, ...values, sessionZone: "UTC", sessionStartMinutes: 0, sessionMinutes: 1440, weekdaysOnly: false,
    sessionPeriod: "Day", tradingHours: "Full day", customStart: 0, customEnd: 0, extendPoc:false, showDevelopingPoc:false, showDevelopingValueArea:false, rowSize: 0, placement: "Session end", volumeMode: "Buy/Sell" }), bars };
}
export function rollingProfileInputs(): InputSchema[] {
  const defaults = defaultRollingProfile();
  return [{ key: "bars", title: "Bars", type: "int", defval: 100, min: 1, max: 50000 },
    ...volumeProfileInputs().filter(i => !["showDevelopingPoc", "showDevelopingValueArea", "extendPoc", "tradingHours", "customStart", "customEnd", "sessionPeriod", "sessionZone", "sessionStartMinutes", "sessionMinutes", "weekdaysOnly", "rowSize", "placement", "volumeMode"].includes(i.key))
      .map(i => ({ ...i, title: i.key === "rows" ? "Rows" : i.title, defval: defaults[i.key as keyof RollingProfileSettings] ?? i.defval }))];
}
export function rollingProfileBars(bars: readonly OHLCV[], timeframe: string, count: number, through?: number): readonly OHLCV[] {
  const interval = parseInterval(timeframe);
  if (!interval || interval.unit === "T") throw new Error("Rolling profiles require time-based candles.");
  if (!Number.isInteger(count) || count < 1 || count > 50000 || bars.length > 50000) throw new Error("Rolling profile exceeds its 50,000-bar bound.");
  if (bars.some((b, i) => !Number.isSafeInteger(b.time) || i > 0 && b.time <= bars[i - 1].time)) throw new Error("Rolling profile bars need unique ascending timestamps.");
  if (through !== undefined && (!Number.isSafeInteger(through) || Math.abs(through) >= 8.64e15)) throw new Error("Invalid rolling Replay boundary.");
  return (through === undefined ? bars : bars.filter(b => nextBucket(timeframe, b.time) <= through)).slice(-count);
}
export interface RollingProfileSnapshot { model: VolumeProfileModel; bars: number; requested: number; from?: number; to?: number }
export class RollingProfileCache {
  private cache = new ExecutionRangeProfileCache();
  read(bars: readonly OHLCV[], trades: readonly Tick[], timeframe: string, style: RollingProfileSettings, symbol: string, through?: number): RollingProfileSnapshot {
    const selected = rollingProfileBars(bars, timeframe, style.bars, through);
    if (trades.some(t => t.symbol !== symbol)) throw new Error("Rolling profiles cannot combine markets.");
    const openings = new Set(selected.map(b => b.time));
    const observed = rangeExecutions(trades, selected, timeframe).filter(t => openings.has(bucketStart(timeframe, t.time)));
    const result = this.cache.read(selected, { rows: style.rows, valueAreaPct: style.valueAreaPercent, developing: false }, observed, timeframe);
    const from = selected[0]?.time, to = selected.length ? nextBucket(timeframe, selected.at(-1)!.time) : undefined;
    const model: VolumeProfileModel = { sessions: [], source: result?.simulated ? "simulation" : "exchange", discarded: 0,
      retained: result?.executions ?? 0, firstTrade: result?.firstTrade ?? null, lastTrade: result?.lastTrade ?? null };
    if (result && from !== undefined && to !== undefined) {
      const p = result.profile;
      const rows = p.rows.map(row => ({ price: row.price, buy: row.up, sell: row.down, total: row.up + row.down }));
      model.sessions.push({ start: from, end: to, date: new Date(from).toISOString().slice(0, 10), step: p.rowH, rows,
        rowGrid: p.centers.map((center, index) => ({ index, lower: p.edges[index], upper: p.edges[index + 1], center })),
        valueArea: { poc: p.poc, low: p.vaFrom, high: p.vaTo, total: result.total, volume: rows.slice(p.vaFrom, p.vaTo + 1).reduce((sum, row) => sum + row.total, 0) },
        firstTrade: result.firstTrade!, lastTrade: result.lastTrade!, tradeCount: result.executions! });
    }
    return { model, bars: selected.length, requested: style.bars, from, to };
  }
}
