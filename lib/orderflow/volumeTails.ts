import type { InputSchema, InputValue, OHLCV } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { nextBucket, parseInterval } from "@/lib/market/intervals";
import { resolveVolumeProfile, volumeProfileInputs, volumeProfileInputVisible } from "./volumeProfileSettings";
import { ExecutionRangeTree } from "./executionRangeTree";
import { rangeExecutions } from "./executionRangeProfile";
import { tpoTradingCalendar, validHHMM, type TpoTradingClock } from "./tpoTradingHours";
import type { MarketSessionCalendar } from "@/lib/market/sessionWindows";

export type TailsKind = "visible" | "rolling" | "session";
export const tailsIds: Record<TailsKind, string> = { visible: "af-visible-tails", rolling: "af-rolling-tails", session: "af-session-tails" };
export const tailsTitles: Record<TailsKind, string> = { visible: "Visible Range Volume Tails", rolling: "Rolling Volume Tails", session: "Session Volume Tails" };
export interface TailsSettings extends TpoTradingClock {
  threshold: number; resolution: number; bars: number; session: "Day" | "Week" | "Month";
  supplyColor: string; demandColor: string; equilibriumColor: string;
  supplyArea: boolean; demandArea: boolean; equilibriumArea: boolean;
  supplyAverage: boolean; demandAverage: boolean; equilibriumAverage: boolean;
  supplyWeighted: boolean; demandWeighted: boolean; equilibriumWeighted: boolean;
}
export const defaultTails = (): TailsSettings => ({ threshold: 10, resolution: 50, bars: 100, session: "Day",
  tradingHours: "Full day", customStart: 0, customEnd: 0,
  sessionZone: "UTC", sessionStartMinutes: 0, sessionMinutes: 1440, weekdaysOnly: false,
  supplyColor: "#f23645", demandColor: "#089981", equilibriumColor: "#787b86",
  supplyArea: true, demandArea: true, equilibriumArea: false,
  supplyAverage: true, demandAverage: true, equilibriumAverage: true,
  supplyWeighted: false, demandWeighted: false, equilibriumWeighted: false });
const flags = ["supplyArea", "demandArea", "equilibriumArea", "supplyAverage", "demandAverage", "equilibriumAverage", "supplyWeighted", "demandWeighted", "equilibriumWeighted"] as const;
const colors = ["supplyColor", "demandColor", "equilibriumColor"] as const;
export function resolveTails(values: Record<string, unknown>): TailsSettings {
  const result = defaultTails(), calendar = resolveVolumeProfile(values);
  for (const key of ["sessionZone", "sessionStartMinutes", "sessionMinutes", "weekdaysOnly", "tradingHours", "customStart", "customEnd"] as const) Object.assign(result, { [key]: calendar[key] });
  for (const [key, min, max] of [["threshold", .1, 100], ["resolution", 2, 500], ["bars", 1, 50000]] as const) {
    const v = values[key]; if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || key !== "threshold" && !Number.isInteger(v)) throw new Error(`Invalid Volume Tails ${key}.`);
    result[key] = v;
  }
  if (values.session !== undefined) {
    if (!["Day", "Week", "Month"].includes(String(values.session))) throw new Error("Choose Day, Week or Month for Volume Tails.");
    result.session = values.session as TailsSettings["session"];
  }
  if (result.session === "Day" && result.tradingHours === "Custom" && (!validHHMM(result.customStart) || !validHHMM(result.customEnd)))
    throw new Error("Custom hours must be valid UTC HHMM times (0000–2400).");
  for (const key of flags) if (values[key] !== undefined) {
    if (typeof values[key] !== "boolean") throw new Error(`Invalid Volume Tails ${key}.`); result[key] = values[key];
  }
  for (const key of colors) if (values[key] !== undefined) {
    if (typeof values[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(values[key])) throw new Error(`Invalid Volume Tails ${key}.`); result[key] = values[key];
  }
  return result;
}
export function tailsInputs(kind: TailsKind): InputSchema[] {
  const d = defaultTails(), input = (key: keyof TailsSettings, title: string, type: InputSchema["type"], extra: Partial<InputSchema> = {}): InputSchema => ({ key, title, type, defval: d[key] as InputValue, ...extra });
  return [input("threshold", "Threshold %", "float", { min: .1, max: 100 }), input("resolution", "Resolution", "int", { min: 2, max: 500 }),
    ...(kind === "rolling" ? [input("bars", "Bars", "int", { min: 1, max: 50000 })] : []),
    ...(kind === "session" ? [input("session", "Session", "string", { options: ["Day", "Week", "Month"] }),
      ...volumeProfileInputs().filter(i => ["tradingHours", "customStart", "customEnd", "sessionZone", "sessionStartMinutes", "sessionMinutes", "weekdaysOnly"].includes(i.key))] : []),
    ...(["supply", "demand", "equilibrium"] as const).flatMap(side => {
      const name = side.charAt(0).toUpperCase() + side.slice(1);
      return [input(`${side}Color`, `${name} color`, "color", { tab: "Style" }), input(`${side}Area`, `${name} area`, "bool", { tab: "Style" }),
        input(`${side}Average`, `${name} average`, "bool", { tab: "Style" }), input(`${side}Weighted`, `${name} weighted average`, "bool", { tab: "Style" })];
    })];
}
export const tailsInputVisible = (key: string, values: Record<string, unknown>) => volumeProfileInputVisible(key, { ...values, sessionPeriod: values.session ?? "Day" });

export interface VolumeTail { low: number; high: number; average: number; weighted: number; volume: number; reached: boolean; bins: number }
export interface VolumeTails { supply: VolumeTail | null; demand: VolumeTail | null; equilibrium: { low: number; high: number; midpoint: number; average: number; weighted: number } | null;
  total: number; target: number; observations: number; simulated: boolean; min: number; max: number }
export interface TailWindow { start: number; end: number; trades: Tick[] }
export interface TailDrawing extends VolumeTails { start: number; end: number }

/** Each side targets a share of COMBINED volume, consuming whole price bins.
 * The crossing bin is included in full; no within-bin execution order is inferred. */
export function tailsFromBins(edges: readonly number[], centers: readonly number[], buys: readonly number[], sells: readonly number[], threshold: number): Omit<VolumeTails, "observations" | "simulated"> {
  if (!buys.length || buys.length !== sells.length || centers.length !== buys.length || edges.length !== buys.length + 1 ||
    !Number.isFinite(threshold) || threshold < .1 || threshold > 100 ||
    edges.some((v, i) => !Number.isFinite(v) || i > 0 && v <= edges[i - 1]) ||
    centers.some((v, i) => !Number.isFinite(v) || v < edges[i] || v > edges[i + 1]) ||
    [...buys, ...sells].some(v => !Number.isFinite(v) || v < 0)) throw new Error("Invalid Volume Tails price bins.");
  const total = buys.reduce((a, b) => a + b, 0) + sells.reduce((a, b) => a + b, 0), target = total * (threshold / 100);
  if (!Number.isFinite(total)) throw new Error("Volume Tails quantity exceeds supported precision.");
  if (total > 0 && !(target > 0)) throw new Error("Volume Tails threshold exceeds supported quantity precision.");
  const tail = (amounts: readonly number[], supply: boolean): VolumeTail | null => {
    const sideTotal = amounts.reduce((a, b) => a + b, 0); if (!(sideTotal > 0)) return null;
    let volume = 0, weighted = 0, index = supply ? amounts.length - 1 : 0, bins = 0;
    for (; index >= 0 && index < amounts.length; index += supply ? -1 : 1) {
      const old = volume; volume += amounts[index]; bins++;
      // Stable online weighted mean avoids price*volume overflow.
      if (amounts[index] > 0) weighted = old ? weighted + (centers[index] - weighted) * (amounts[index] / volume) : centers[index];
      if (volume >= target || bins === amounts.length) break;
    }
    const low = supply ? edges[index] : edges[0], high = supply ? edges.at(-1)! : edges[index + 1];
    return { low, high, average: low + (high - low) / 2, weighted, volume, reached: volume >= target, bins };
  };
  const supply = tail(sells, true), demand = tail(buys, false);
  const midpoint = supply && demand ? demand.high + (supply.low - demand.high) / 2 : 0;
  const equilibrium = supply && demand ? { low: Math.min(demand.high, supply.low), high: Math.max(demand.high, supply.low), midpoint,
    average: demand.average + (supply.average - demand.average) / 2, weighted: demand.weighted + (supply.weighted - demand.weighted) / 2 } : null;
  return { supply, demand, equilibrium, total, target, min: edges[0], max: edges.at(-1)! };
}

export function buildVolumeTails(trades: readonly Tick[], style: TailsSettings): VolumeTails | null {
  if (!trades.length) return null;
  const tree = new ExecutionRangeTree(trades); trades.forEach(t => tree.add(t)); const profile = tree.profile(style.resolution, 70);
  if (!profile) return null;
  return { ...tailsFromBins(profile.edges, profile.centers, profile.rows.map(r => r.up), profile.rows.map(r => r.down), style.threshold), observations: trades.length, simulated: trades[0].simulated };
}

/** Restrict every range to loaded, revealed bars and exclusive last-bar endings.
 * Session windows filter executions by their actual timestamp, including boundaries
 * within a chart candle; week/month sessions use UTC and ignore day-hour controls. */
export function selectTailWindows(input: readonly Tick[], bars: readonly OHLCV[], timeframe: string, kind: TailsKind, style: TailsSettings,
  symbol: string, visible: { from: number; to: number }, through?: number, sourceCalendar?: MarketSessionCalendar): TailWindow[] {
  const interval = parseInterval(timeframe); if (!interval || interval.unit === "T") throw new Error("Volume Tails require time-based candles.");
  if (bars.length > 50000) throw new Error("Volume Tails exceed 50,000 loaded bars.");
  if (!Number.isFinite(visible.from) || !Number.isFinite(visible.to) || visible.from > visible.to) throw new Error("Invalid Volume Tails visible range.");
  const revealed = through === undefined ? bars : bars.filter(b => nextBucket(timeframe, b.time) <= through);
  const selected = kind === "visible" ? revealed.slice(Math.max(0, Math.floor(visible.from)), Math.max(0, Math.min(revealed.length, Math.ceil(visible.to) + 1)))
    : kind === "rolling" ? revealed.slice(-style.bars) : revealed;
  if (!selected.length) return [];
  const trades = rangeExecutions(input, selected, timeframe);
  if (trades.some(t => t.symbol !== symbol)) throw new Error("Volume Tails cannot use another market's executions.");
  if (kind !== "session") return [{ start: selected[0].time, end: nextBucket(timeframe, selected.at(-1)!.time), trades }];
  const calendar = tpoTradingCalendar({ ...style, sessionPeriod: style.session }, symbol, sourceCalendar), groups = new Map<number, TailWindow>();
  for (const trade of trades) {
    const window = calendar.at(trade.time);
    if (!window) continue;
    const entry = groups.get(window.start) ?? { start: Math.max(selected[0].time, window.start), end: Math.min(nextBucket(timeframe, selected.at(-1)!.time), window.end), trades: [] };
    entry.trades.push(trade); groups.set(window.start, entry);
  }
  return [...groups.values()].sort((a, b) => a.start - b.start);
}
