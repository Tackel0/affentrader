import type { OrderBook, Tick } from "@/types/trading";
import { BINANCE_SYMBOL, bybitSymbol, spotQuoteCurrency, type BybitCategory } from "@/lib/symbolId";
import { NATIVE_INTERVALS } from "./intervals";
import { parseWireObject, wireDecimal, wireObject } from "./marketWire";
import type { Row } from "./klines";

export const BYBIT_NATIVES = NATIVE_INTERVALS
  .filter(interval => !["1s", "8h"].includes(interval.id))
  .map(interval => ({ ...interval, api: interval.id.endsWith("m") ? interval.id.slice(0, -1)
    : interval.id.endsWith("h") ? String(60 * Number(interval.id.slice(0, -1))) : interval.id.slice(-1) }));

export interface BybitTicker {
  pair: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  turnover: number;
  time: number;
}

export function parseBybitTicker(raw: unknown, time: number): BybitTicker | null {
  const row = wireObject(raw);
  if (!row || typeof row.symbol !== "string" || !BINANCE_SYMBOL.test(row.symbol)
    || !["USDT", "USDC"].includes(spotQuoteCurrency(row.symbol))) return null;
  const [price, open, high, low, volume, turnover] = [
    row.lastPrice, row.prevPrice24h, row.highPrice24h, row.lowPrice24h, row.volume24h, row.turnover24h,
  ].map(wireDecimal);
  if (![price, open, high, low, volume, turnover, time].every(Number.isFinite)
    || price <= 0 || open <= 0 || low <= 0 || high < low || volume < 0 || turnover < 0 || time <= 0) return null;
  return { pair: row.symbol, price, open, high, low, volume, turnover, time };
}

export function parseBybitCandles(list: unknown): Row[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap(item => {
    if (!Array.isArray(item) || item.length < 6) return [];
    const [time, open, high, low, close, volume] = item.slice(0, 6).map(wireDecimal);
    if (![time, open, high, low, close, volume].every(Number.isFinite)
      || time <= 0 || low <= 0 || high < Math.max(open, close, low) || low > Math.min(open, close) || volume < 0) return [];
    return [[time, open, high, low, close, volume]];
  }).sort((a, b) => a[0] - b[0]);
}

export function parseBybitTrade(raw: unknown, category: BybitCategory, pair: string): Tick | null {
  const row = wireObject(raw);
  if (!row || row.s !== pair || (row.S !== "Buy" && row.S !== "Sell")
    || typeof row.i !== "string" || !row.i || row.i.length > 128) return null;
  const [price, quantity, time] = [row.p, row.v, row.T].map(wireDecimal);
  if (![price, quantity, time].every(value => Number.isFinite(value) && value > 0)) return null;
  const symbol = bybitSymbol(category, pair);
  return { id: `${symbol}:${row.i}`, symbol, time, price, quantity, side: row.S === "Buy" ? "buy" : "sell", simulated: false, tradeCount: 1 };
}

class BybitBook {
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private update = 0;

  apply(type: string, payload: Record<string, unknown>, symbol: string, time: number): OrderBook | null {
    const update = payload.u;
    if (typeof update !== "number" || !Number.isSafeInteger(update) || update < 1) return null;
    const snapshot = type === "snapshot";
    if (!snapshot && (type !== "delta" || !this.update || update <= this.update)) return null;
    const decode = (raw: unknown): [number, number][] | null => {
      if (!Array.isArray(raw) || raw.length > 50) return null;
      const levels: [number, number][] = [];
      for (const row of raw) {
        if (!Array.isArray(row) || row.length !== 2) return null;
        const price = wireDecimal(row[0]), quantity = wireDecimal(row[1]);
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity < 0) return null;
        levels.push([price, quantity]);
      }
      return levels;
    };
    const bids = decode(payload.b), asks = decode(payload.a);
    if (!bids || !asks) return null;
    const apply = (previous: Map<number, number>, levels: [number, number][], direction: number) => {
      const next = snapshot ? new Map<number, number>() : new Map(previous);
      for (const [price, quantity] of levels) {
        if (quantity) next.set(price, quantity);
        else next.delete(price);
      }
      return new Map([...next].sort(([a], [b]) => (a - b) * direction).slice(0, 50));
    };
    const nextBids = apply(this.bids, bids, -1), nextAsks = apply(this.asks, asks, 1);
    const bid = nextBids.keys().next().value, ask = nextAsks.keys().next().value;
    if (bid === undefined || ask === undefined || bid >= ask) throw new Error("Bybit order book requires a fresh snapshot");
    this.bids = nextBids;
    this.asks = nextAsks;
    this.update = update;
    return { symbol, bids: [...nextBids].map(([price, quantity]) => ({ price, quantity })),
      asks: [...nextAsks].map(([price, quantity]) => ({ price, quantity })), time, simulated: false };
  }
}

interface BybitStreamConsumers {
  trade(tick: Tick): void;
  book(book: OrderBook): void;
  ticker(symbol: string, ticker: BybitTicker): void;
  disconnected(): void;
}

export function subscribeBybit(category: BybitCategory, chartPairs: string[], quotePairs: string[], consumers: BybitStreamConsumers): () => void {
  const books = new Map(chartPairs.map(pair => [pair, new BybitBook()]));
  const tickers = new Map<string, Record<string, unknown>>();
  const quoteSet = new Set(quotePairs);
  const socket = new WebSocket(`wss://stream.bybit.com/v5/public/${category}`);
  let active = true;
  let lastTraffic = Date.now();
  const keepAlive = setInterval(() => {
    if (Date.now() - lastTraffic > 30_000) socket.close();
    else if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: "ping" }));
  }, 15_000);
  socket.onopen = () => {
    const topics = [
      ...chartPairs.flatMap(pair => [`publicTrade.${pair}`, `orderbook.50.${pair}`]),
      ...quotePairs.map(pair => `tickers.${pair}`),
    ];
    // Use small subscription batches for the spot WebSocket argument limit.
    for (let index = 0; index < topics.length; index += 10)
      socket.send(JSON.stringify({ op: "subscribe", args: topics.slice(index, index + 10) }));
  };
  socket.onmessage = ({ data }) => {
    const message = parseWireObject(data);
    if (!active || !message) return;
    lastTraffic = Date.now();
    if (message.op === "subscribe" && message.success === false) { socket.close(); return; }
    if (typeof message.topic !== "string") return;
    const channel = message.topic.slice(0, message.topic.indexOf("."));
    const pair = message.topic.slice(message.topic.lastIndexOf(".") + 1);
    const symbol = bybitSymbol(category, pair);
    if (channel === "publicTrade" && books.has(pair) && Array.isArray(message.data)) {
      for (const row of message.data) {
        const tick = parseBybitTrade(row, category, pair);
        if (tick && active) consumers.trade(tick);
      }
      return;
    }
    const payload = wireObject(message.data);
    const time = wireDecimal(message.ts);
    if (!payload || !Number.isFinite(time) || time <= 0) return;
    if (channel === "orderbook" && payload.s === pair && typeof message.type === "string") {
      try {
        const book = books.get(pair)?.apply(message.type, payload, symbol, time);
        if (book) consumers.book(book);
      } catch { socket.close(); }
    }
    if (channel === "tickers" && quoteSet.has(pair) && (payload.symbol === pair || (payload.symbol === undefined && message.type === "delta"))) {
      // Linear tickers are snapshots followed by field-level deltas.
      if (message.type !== "snapshot" && (message.type !== "delta" || !tickers.has(pair))) return;
      const merged = { ...(message.type === "delta" ? tickers.get(pair) : undefined), ...payload };
      const ticker = parseBybitTicker(merged, time);
      if (ticker) {
        tickers.set(pair, merged);
        consumers.ticker(symbol, ticker);
      }
    }
  };
  const cleanup = () => {
    active = false;
    clearInterval(keepAlive);
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
  };
  socket.onerror = () => socket.close();
  socket.onclose = () => {
    if (!active) return;
    cleanup();
    consumers.disconnected();
  };
  return () => {
    if (!active) return;
    cleanup();
    socket.close();
  };
}
