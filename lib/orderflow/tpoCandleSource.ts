import type { OHLCV } from "@luxalgo/vela";
import { providerOf, tickerOf } from "@/lib/symbolId";
import { intervalMs, isTickInterval, nextBucket } from "@/lib/market/intervals";
import { loadYahooBars, type YahooLoad, type YahooLoadRequest } from "@/lib/market/yahooClient";
import type { MarketSessionCalendar } from "@/lib/market/sessionWindows";
import type { TpoPreferences } from "./tpoSettings";
import { validHHMM } from "./tpoTradingHours";

export type TpoTape = "regular" | "extended";
export function tpoExplicitTape(symbol: string, style: Pick<TpoPreferences, "sessionPeriod" | "tradingHours">): TpoTape | undefined {
  if (providerOf(symbol) !== "yahoo" || (style.sessionPeriod ?? "Day") !== "Day" || !style.tradingHours || style.tradingHours === "Full day") return;
  return style.tradingHours === "Regular hours (RTH)" ? "regular" : "extended";
}
export interface TpoCandleSnapshot { bars: readonly OHLCV[]; calendar?: MarketSessionCalendar; basis: string }
export interface TpoCandleQuery { symbol: string; timeframe: string; from: number; to: number; tape: TpoTape; adjustDividends: boolean; epoch: string }
/** Shared immutable REST snapshots. Fetching never changes chart bars, calendars,
 * close listeners, trade archives or alert observation state. */
export class TpoCandlePool {
  private entries = new Map<string, { at: number; promise: Promise<TpoCandleSnapshot> }>();
  constructor(private loader: (request: YahooLoadRequest) => Promise<YahooLoad> = loadYahooBars) {}
  load(query: TpoCandleQuery): Promise<TpoCandleSnapshot> {
    const key = JSON.stringify(query), cached = this.entries.get(key);
    if (cached && Date.now() - cached.at < 15000) return cached.promise;
    const duration = intervalMs(query.timeframe);
    if (!Number.isFinite(query.from) || !Number.isFinite(query.to) || query.to <= query.from || duration < 60000 || isTickInterval(query.timeframe))
      return Promise.reject(new Error("Explicit TPO sessions require a valid history window and bars of 1m or longer."));
    const entry = { at: Infinity, promise: undefined as unknown as Promise<TpoCandleSnapshot> };
    entry.promise = this.loader({ ticker: tickerOf(query.symbol), timeframe: query.timeframe,
      count: Math.min(20000, Math.ceil((query.to - query.from) / duration) + 2), end: query.to, start: query.from,
      extended: query.tape === "extended", adjustDividends: query.adjustDividends }).then(loaded => {
      const windows = loaded.meta?.sessions;
      entry.at = Date.now();
      const calendar = windows ? { ...windows, mode: query.tape, revision: JSON.stringify([query.tape, windows]) } : undefined;
      if (!loaded.bars.length) throw new Error("No source candles are available for this explicit TPO session.");
      return { bars: loaded.bars.filter(bar => bar.time >= query.from && bar.time <= query.to), calendar,
        basis: `Independent delayed Yahoo ${query.tape === "extended" ? "extended-hours" : "regular-hours"} OHLCV history; chart candles unchanged` };
    }).catch(error => { if (this.entries.get(key) === entry) this.entries.delete(key); throw error; });
    this.entries.set(key, entry);
    if (this.entries.size > 16) this.entries.delete(this.entries.keys().next().value!);
    return entry.promise;
  }
}
export const tpoCandlePool = new TpoCandlePool();
export interface TpoSourceRequest {
  symbol: string; timeframe: string; style: TpoPreferences; bars: readonly OHLCV[];
  epoch: string; replay: boolean; through?: number | null; simulation?: boolean; adjustDividends: boolean;
}
export type TpoSourceRead = { status: "ready"; value: TpoCandleSnapshot } | { status: "loading" | "error"; message: string };
const DAY = 86400000;
/** Per-mounted-surface ownership and Replay fences over the shared snapshots. */
export class TpoCandleSource {
  private key = ""; private generation = 0; private pending = false; private due = 0;
  private value?: TpoCandleSnapshot; private error = ""; private timer?: ReturnType<typeof setTimeout>;
  private fetchedAt = 0;
  private visibleKey = ""; private visible?: TpoCandleSnapshot;
  constructor(private repaint: () => void, private pool: TpoCandlePool = tpoCandlePool) {}
  reset() { this.generation++; this.key = ""; this.value = this.visible = undefined; this.visibleKey = ""; this.pending = false; this.error = ""; this.due = this.fetchedAt = 0; clearTimeout(this.timer); this.timer = undefined; }
  read(request: TpoSourceRequest): TpoSourceRead {
    const { symbol, timeframe, bars, replay, through } = request, tape = tpoExplicitTape(symbol, request.style);
    if (!tape || request.simulation || !bars.length) {
      if (this.key) this.reset();
      return { status: "ready", value: { bars, basis: "Loaded chart OHLCV; inherited chart session" } };
    }
    if (request.style.tradingHours === "Custom" && (!validHHMM(request.style.customStart ?? 0) || !validHHMM(request.style.customEnd ?? 0))) {
      this.reset(); return { status: "error", message: "Custom hours must be valid UTC HHMM times (0000–2400)." };
    }
    if (replay && (!Number.isSafeInteger(through) || through! < 0)) {
      this.reset(); return { status: "loading", message: "Waiting for the revealed Replay candle boundary." };
    }
    const from = Math.floor(bars[0].time / DAY) * DAY - DAY;
    const to = replay ? Math.min(Date.now(), Math.floor(through! / DAY) * DAY + DAY) : Math.floor(Date.now() / 15000) * 15000;
    const key = JSON.stringify([symbol, timeframe, request.epoch, from, tape, request.adjustDividends, replay, replay ? to : "live"]);
    if (this.key !== key) { this.reset(); this.key = key; }
    if (!this.pending && (!this.value && !this.error || Date.now() >= this.due && (!replay || this.error))) {
      this.pending = true; const generation = this.generation;
      void this.pool.load({ symbol, timeframe, from, to, tape, adjustDividends: request.adjustDividends, epoch: request.epoch }).then(value => {
        if (generation !== this.generation) return;
        this.value = value; this.fetchedAt = Date.now(); this.error = ""; this.visible = undefined;
      }).catch(error => { if (generation === this.generation) { this.value = undefined; this.error = error instanceof Error ? error.message : "Explicit TPO history is unavailable."; } }).finally(() => {
        if (generation !== this.generation) return;
        this.pending = false; this.due = Date.now() + 15000;
        if (!replay || this.error) this.timer = setTimeout(() => { this.timer = undefined; this.repaint(); }, 15000);
        this.repaint();
      });
    }
    if (this.error) return { status: "error", message: this.error };
    if (!this.value || !replay && Date.now() - this.fetchedAt > 45000) return { status: "loading", message: "Loading independent TPO session candles…" };
    const last = bars.at(-1)!, visibleKey = replay ? JSON.stringify([through, last.time, last.open, last.high, last.low, last.close, last.volume]) : "live";
    if (!this.visible || visibleKey !== this.visibleKey) {
      this.visibleKey = visibleKey;
      const revealed = replay ? this.value.bars.filter(bar => nextBucket(timeframe, bar.time) <= through!) : this.value.bars;
      // A historical REST candle contains its final wick/volume. For a revealed
      // partial bucket, only the chart's actual partial OHLC may be included.
      this.visible = { ...this.value, bars: replay && last.time === through ? [...revealed, { ...last }] : revealed };
    }
    return { status: "ready", value: this.visible };
  }
}
