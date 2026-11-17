import type { OHLCV, Tick } from "@/types/trading";
import { hyperliquidSymbol } from "@/lib/symbolId";
import type { NativeSpec } from "./intervals";
import { wireDecimal, wireObject } from "./marketWire";

const DAY = 86_400_000;

/** Candle intervals Hyperliquid serves; 3d is rebuilt from days so bars align with ours. */
export const HYPERLIQUID_NATIVES: NativeSpec[] = [
  { id: "1m", api: "1m", ms: 60_000 },
  { id: "3m", api: "3m", ms: 180_000 },
  { id: "5m", api: "5m", ms: 300_000 },
  { id: "15m", api: "15m", ms: 900_000 },
  { id: "30m", api: "30m", ms: 1_800_000 },
  { id: "1h", api: "1h", ms: 3_600_000 },
  { id: "2h", api: "2h", ms: 7_200_000 },
  { id: "4h", api: "4h", ms: 14_400_000 },
  { id: "8h", api: "8h", ms: 28_800_000 },
  { id: "12h", api: "12h", ms: 43_200_000 },
  { id: "1D", api: "1d", ms: DAY },
  { id: "1W", api: "1w", ms: 7 * DAY },
  { id: "1M", api: "1M", ms: 30 * DAY },
];

/** Hyperliquid keeps only the most recent 5,000 candles of every interval. */
export const HYPERLIQUID_MAX_CANDLES = 5000;

export interface HyperliquidAsset {
  /** Hyperliquid coin name: `BTC`, `kPEPE` or `xyz:TSLA`. */
  coin: string;
  /** Application symbol id: `HL:BTC`. */
  symbol: string;
  /** Builder dex, `""` for the main exchange. */
  dex: string;
  /** Name without the dex prefix. */
  name: string;
  dexName: string;
  maxLeverage: number;
  szDecimals: number;
  /** False when the raw meta response omitted or corrupted its precision. */
  pricePrecisionKnown?: boolean;
  mark: number;
  previousDay: number;
  /** 24h notional volume in USD. */
  volume: number;
  /** Independently reported base quantity; null when the venue omits it. */
  baseVolume?: number | null;
  /** Time the context was fetched; retained when a cached snapshot is served. */
  asOf?: number;
  /** Open interest in contracts. */
  openInterest: number;
  /** Funding rate per hour. */
  funding: number;
}

const num = (value: unknown): number => {
  const n = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
};

interface RawCandle {
  t?: unknown;
  o?: unknown;
  h?: unknown;
  l?: unknown;
  c?: unknown;
  v?: unknown;
}

/** Candle rows from `candleSnapshot`; malformed or non-positive rows are dropped. */
export function parseCandles(rows: unknown): OHLCV[] {
  if (!Array.isArray(rows)) return [];
  const out: OHLCV[] = [];
  for (const row of rows as RawCandle[]) {
    const bar = {
      time: num(row?.t),
      open: num(row?.o),
      high: num(row?.h),
      low: num(row?.l),
      close: num(row?.c),
      volume: num(row?.v),
    };
    if (bar.time > 0 && bar.open > 0 && bar.high > 0 && bar.low > 0 && bar.close > 0) out.push(bar);
  }
  return out.sort((a, b) => a.time - b.time);
}

interface RawMeta {
  universe?: { name?: unknown; szDecimals?: unknown; maxLeverage?: unknown; isDelisted?: unknown }[];
}
interface RawCtx {
  markPx?: unknown;
  midPx?: unknown;
  prevDayPx?: unknown;
  dayNtlVlm?: unknown;
  dayBaseVlm?: unknown;
  openInterest?: unknown;
  funding?: unknown;
}

/** Merge a dex's `meta` with its asset contexts (same order) into asset records. */
export function parseAssets(meta: unknown, contexts: unknown, dex: string, dexName = ""): HyperliquidAsset[] {
  const universe = (meta as RawMeta | null)?.universe;
  if (!Array.isArray(universe) || !Array.isArray(contexts)) return [];
  const out: HyperliquidAsset[] = [];
  universe.forEach((asset, index) => {
    const ctx = (contexts as RawCtx[])[index];
    const coin = typeof asset?.name === "string" ? asset.name : "";
    if (!coin || asset.isDelisted === true || !ctx) return;
    const mark = num(ctx.markPx) || num(ctx.midPx);
    if (!(mark > 0)) return;
    out.push({
      coin,
      symbol: hyperliquidSymbol(coin),
      dex,
      name: coin.includes(":") ? coin.slice(coin.indexOf(":") + 1) : coin,
      dexName,
      maxLeverage: num(asset.maxLeverage),
      szDecimals: num(asset.szDecimals),
      pricePrecisionKnown: typeof asset.szDecimals === "number" && Number.isInteger(asset.szDecimals) && asset.szDecimals >= 0 && asset.szDecimals <= 6,
      mark,
      previousDay: num(ctx.prevDayPx) || mark,
      volume: num(ctx.dayNtlVlm),
      baseVolume: ctx.dayBaseVlm !== "" && (typeof ctx.dayBaseVlm === "string" || typeof ctx.dayBaseVlm === "number") && Number.isFinite(Number(ctx.dayBaseVlm)) && Number(ctx.dayBaseVlm) >= 0 ? Number(ctx.dayBaseVlm) : null,
      asOf: Date.now(),
      openInterest: num(ctx.openInterest),
      funding: num(ctx.funding),
    });
  });
  return out;
}

/** One WebSocket trade into the application's tick; `B` means the taker bought. */
export function parseTrade(raw: unknown): Tick | null {
  const t = wireObject(raw);
  if (!t || typeof t.coin !== "string" || !t.coin || (t.side !== "B" && t.side !== "A")) return null;
  const price = wireDecimal(t.px), quantity = wireDecimal(t.sz);
  const { time, tid: seq } = t;
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0 ||
    !validStreamTime(time) || typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) return null;
  return {
    id: `${t.coin}-${seq}`,
    symbol: hyperliquidSymbol(t.coin),
    time,
    price,
    quantity,
    side: t.side === "B" ? "buy" : "sell",
    simulated: false,
    seq,
    tradeCount: 1,
  };
}

export interface HyperliquidBook {
  coin: string;
  time: number;
  bids: { price: number; quantity: number }[];
  asks: { price: number; quantity: number }[];
}

function validStreamTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 8.64e15;
}

/** An `l2Book` message: `levels` holds bids then asks. */
export function parseBook(raw: unknown): HyperliquidBook | null {
  const book = wireObject(raw);
  if (!book || typeof book.coin !== "string" || !book.coin || !validStreamTime(book.time) ||
    !Array.isArray(book.levels) || book.levels.length !== 2) return null;
  const side = (rows: unknown, direction: 1 | -1) => {
    if (!Array.isArray(rows) || rows.length > 20) return null;
    const levels = [];
    let previous: number | undefined;
    for (const raw of rows) {
      const row = wireObject(raw);
      const price = wireDecimal(row?.px), quantity = wireDecimal(row?.sz);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity < 0 ||
        (previous !== undefined && (price - previous) * direction <= 0)) return null;
      previous = price;
      if (quantity > 0 && levels.length < 10) levels.push({ price, quantity });
    }
    return levels;
  };
  const bids = side(book.levels[0], -1), asks = side(book.levels[1], 1);
  if (!bids || !asks || (bids[0] && asks[0] && bids[0].price >= asks[0].price)) return null;
  return { coin: book.coin, time: book.time, bids, asks };
}

/** Smallest price step: Hyperliquid quotes five significant figures, at most 6 − szDecimals decimals. */
export function priceTick(price: number, szDecimals = 0): number {
  if (!(price > 0)) return 0.01;
  const magnitude = Math.floor(Math.log10(price)) + 1;
  const decimals = Math.max(0, Math.min(6 - szDecimals, 5 - magnitude));
  return 10 ** -decimals;
}

/** Dex a coin lives on, from its name. */
export function dexOfCoin(coin: string): string {
  const i = coin.indexOf(":");
  return i > 0 ? coin.slice(0, i) : "";
}
