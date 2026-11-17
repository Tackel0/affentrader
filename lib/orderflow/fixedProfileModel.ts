import type { OHLCV } from "@luxalgo/vela";
import { volumeValueArea } from "./volumeProfileModel";
import { rangePriceGrid } from "./rangePriceGrid";
import { priceStep } from "./math";
import { findVolumeNodes, type VolumeNode } from "./volumeNodes";

export interface FixedProfileOptions { rows: number; valueAreaPct: number; developing: boolean }
export interface EstimatedProfile {
  rows: Array<{ price: number; up: number; down: number }>;
  rowH: number; min: number; maxTotal: number; poc: number; vaFrom: number; vaTo: number;
  edges: number[]; centers: number[];
  nodes?: VolumeNode[];
}
interface DevelopingPoint { time: number; price: number }
export interface FixedProfileResult {
  profile: EstimatedProfile; developingPoc: DevelopingPoint[]; developingVaHigh: DevelopingPoint[]; developingVaLow: DevelopingPoint[];
  bars: number; rejected: number; total: number;
  executions?: number; buys?: number; sells?: number; delta?: number; firstTrade?: number; lastTrade?: number; simulated?: boolean;
}
export const MAX_FIXED_BARS = 50000, MAX_DEVELOPING_BARS = 5000;
const fields = ["time", "open", "high", "low", "close", "volume"] as const;
const valid = (bar: OHLCV) => [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume ?? 0].every(Number.isFinite) &&
  Math.abs(bar.time) < 8640000000000000 && bar.high >= Math.max(bar.open, bar.close, bar.low) && bar.low <= Math.min(bar.open, bar.close) && (bar.volume ?? 0) >= 0;
/** Uniform high/low-range allocation is an OHLCV estimate, not aggressor volume.
 * Difference arrays allocate interior rows in O(1) per bar; boundary fractions
 * partition each bar's quantity instead of copying it onto every OHLC location. */
export function estimateFixedProfile(bars: readonly OHLCV[], count: number, rows: number, percent: number): EstimatedProfile | null {
  let min = Infinity, max = -Infinity, total = 0;
  for (let i = 0; i < count; i++) if ((bars[i].volume ?? 0) > 0) {
    min = Math.min(min, bars[i].low); max = Math.max(max, bars[i].high); total += bars[i].volume!;
  }
  if (!Number.isFinite(total)) throw new Error("Fixed profile quantity exceeds supported precision.");
  if (!(total > 0)) return null;
  const n = max > min ? rows : 1;
  if (max === min) {
    const step = priceStep(Math.abs(min)); const half = step / 2 || step;
    const center = min; min = center - half; max = center + half;
  }
  const grid = rangePriceGrid(min, max, n), step = (max - min) / n;
  if (!(step > 0) || !Number.isFinite(step)) throw new Error("Profile price rows cannot be distinguished. Reduce Rows or change the range.");
  const up = new Float64Array(n + 1), down = new Float64Array(n + 1), upDiff = new Float64Array(n + 1), downDiff = new Float64Array(n + 1);
  for (let i = 0; i < count; i++) {
    const bar = bars[i], volume = bar.volume ?? 0; if (!(volume > 0)) continue;
    const target = bar.close >= bar.open ? up : down, diff = bar.close >= bar.open ? upDiff : downDiff;
    const { first, last, firstFraction, fullFraction } = grid.allocation(bar.low, bar.high);
    if (first === last || bar.high === bar.low) { target[first] += volume; continue; }
    const firstAmount = volume * firstFraction;
    const interior = Math.max(0, last - first - 1), full = volume * fullFraction;
    target[first] += firstAmount; target[last] += Math.max(0, volume - firstAmount - full * interior);
    if (interior) { diff[first + 1] += full; diff[last] -= full; }
  }
  let upRunning = 0, downRunning = 0;
  const epsilon = total * Number.EPSILON * 64;
  const profileRows = Array.from({ length: n }, (_, index) => {
    upRunning += upDiff[index]; downRunning += downDiff[index];
    const buy = up[index] + upRunning, sell = down[index] + downRunning;
    if (![buy, sell].every(Number.isFinite) || buy < -epsilon || sell < -epsilon) throw new Error("Fixed profile allocation exceeds supported precision.");
    return { price: grid.edges[index], up: Math.max(0, buy), down: Math.max(0, sell) };
  });
  if (profileRows.some((row, index) => index > 0 && row.price <= profileRows[index - 1].price))
    throw new Error("Fixed profile price rows cannot be distinguished. Reduce Rows or change the range.");
  const area = volumeValueArea(profileRows.map(row => ({ price: row.price, buy: row.up, sell: row.down, total: row.up + row.down })), Math.max(1, percent));
  if (!area || Math.abs(area.total - total) > Math.max(epsilon * 16, total * 1e-10)) throw new Error("Fixed profile volume allocation lost supported precision.");
  return { rows: profileRows, edges: grid.edges, centers: grid.centers, rowH: step, min, maxTotal: profileRows[area.poc].up + profileRows[area.poc].down,
    poc: area.poc, vaFrom: percent === 0 ? area.poc : area.low, vaTo: percent === 0 ? area.poc : area.high,
    nodes: findVolumeNodes(profileRows) };
}
interface Snapshot { poc: number; high: number; low: number }
/** Only changed suffixes are recalculated. Each historical developing point uses
 * its own prefix price range; a future high/low cannot move an earlier grid. */
export class FixedProfileCache {
  private previous: OHLCV[] = [];
  private signature = "";
  private developing: Array<Snapshot | null> = [];
  private result: FixedProfileResult | null = null;
  read(source: readonly OHLCV[], options: FixedProfileOptions): FixedProfileResult | null {
    if (source.length > MAX_FIXED_BARS) throw new Error("Fixed profile exceeds 50,000 loaded bars. Shorten the selected range.");
    if (!Number.isInteger(options.rows) || options.rows < 1 || options.rows > 500 || !Number.isFinite(options.valueAreaPct) || options.valueAreaPct < 0 || options.valueAreaPct > 100)
      throw new Error("Fixed profile requires Rows 1–500 and Value Area 0–100.");
    if (options.developing && source.length > MAX_DEVELOPING_BARS) throw new Error("Developing profiles exceed 5,000 bars. Shorten the range or turn off Developing POC and Developing VA.");
    const bars = source.filter(valid), rejected = source.length - bars.length;
    if (bars.some((bar, index) => index > 0 && bar.time <= bars[index - 1].time)) throw new Error("Fixed profile bars must have unique ascending timestamps.");
    const signature = JSON.stringify(options); let common = 0;
    if (signature === this.signature) while (common < Math.min(bars.length, this.previous.length) && fields.every(field => (bars[common][field] ?? 0) === (this.previous[common][field] ?? 0))) common++;
    if (signature === this.signature && common === bars.length && common === this.previous.length && (this.result?.rejected ?? 0) === rejected) return this.result;
    const developing = this.developing.slice(0, common);
    let profile: EstimatedProfile | null = null;
    if (options.developing) {
      for (let i = common; i < bars.length; i++) {
        profile = estimateFixedProfile(bars, i + 1, options.rows, options.valueAreaPct);
        developing[i] = profile ? { poc: profile.centers[profile.poc],
          high: profile.edges[profile.vaTo + 1], low: profile.edges[profile.vaFrom] } : null;
      }
    }
    if (!profile) profile = estimateFixedProfile(bars, bars.length, options.rows, options.valueAreaPct);
    const points = (field: keyof Snapshot) => developing.flatMap((snapshot, index) => snapshot ? [{ time: bars[index].time, price: snapshot[field] }] : []);
    this.result = profile ? { profile, developingPoc: options.developing ? points("poc") : [],
      developingVaHigh: options.developing ? points("high") : [], developingVaLow: options.developing ? points("low") : [], bars: bars.length, rejected,
      total: profile.rows.reduce((sum, row) => sum + row.up + row.down, 0) } : null;
    this.signature = signature; this.developing = developing;
    this.previous = bars.map(bar => ({ ...bar })); return this.result;
  }
}
