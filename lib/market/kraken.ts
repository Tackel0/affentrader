import type { OHLCV, OrderBook, Tick } from "@/types/trading";

import { aggregateBars } from "./aggregation";
import { bucketStart, nextBucket, planSource } from "./intervals";
import { KrakenBook, parseKrakenBookMessage } from "./krakenBook";
import { parseWireObject, wireDecimal, wireObject } from "./marketWire";

export function parseKrakenTrade(raw: unknown): Tick | null {
  if (!raw || typeof raw !== "object") return null;
  const { symbol, side, price, qty, trade_id, timestamp } = raw as Record<string, unknown>;
  if (typeof symbol !== "string" || !/^[A-Z0-9]+\/[A-Z0-9]+$/.test(symbol)
    || (side !== "buy" && side !== "sell")
    || typeof price !== "number" || !Number.isFinite(price) || price <= 0
    || typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0
    || typeof trade_id !== "number" || !Number.isSafeInteger(trade_id) || trade_id < 0
    || typeof timestamp !== "string") return null;
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time) || time <= 0) return null;
  const market = `KRK:${symbol}`;
  return { id: `${market}:${trade_id}`, symbol: market, time, price, quantity: qty, side, simulated: false, seq: trade_id, tradeCount: 1 };
}

interface KrakenTicker {
  symbol: string;
  last: number;
  change: number;
  high: number;
  low: number;
  volume: number;
  time: number;
}

export function subscribeKrakenTrades(
  symbols: readonly string[],
  receive: (tick: Tick) => void,
  onDisconnect: () => void,
  receiveBook?: (book: OrderBook) => void,
  bookPairs: readonly string[] = symbols,
  receiveTicker?: (ticker: KrakenTicker) => void,
  onTradeSubscribed?: (symbol: string, time: number) => void,
): () => void {
  const pairs = new Set(symbols);
  const tradePairs = receiveTicker ? bookPairs : [...pairs];
  const awaitingTradeAck = new Set(tradePairs);
  const books = new Map(bookPairs.map(pair => [pair, new KrakenBook(pair)]));
  const socket = new WebSocket("wss://ws.kraken.com/v2");
  let active = true, opened = false, lastTraffic = Date.now();
  const watchdog = setInterval(() => {
    if (active && Date.now() - lastTraffic >= (opened ? 30000 : 15000)) socket.close();
  }, 5000);
  socket.onopen = () => {
    if (!active) return;
    opened = true;
    lastTraffic = Date.now();
    if (tradePairs.length) socket.send(JSON.stringify({ method: "subscribe",
      params: { channel: "trade", symbol: tradePairs, snapshot: false } }));
    if (active && receiveTicker) socket.send(JSON.stringify({ method: "subscribe", params: { channel: "ticker", symbol: [...pairs], snapshot: true } }));
    if (active && receiveBook && books.size) socket.send(JSON.stringify({ method: "subscribe", params: { channel: "book", symbol: [...books.keys()], depth: 10, snapshot: true } }));
  };
  socket.onmessage = ({ data }) => {
    if (!active || typeof data !== "string") return;
    const message = parseWireObject(data);
    if (!message) return;
    const now = Date.now();
    if (message.channel === "heartbeat") { lastTraffic = now; return; }
    if (message.method === "subscribe" && message.success === true) {
      const result = wireObject(message.result);
      if (result?.channel === "trade" && typeof result.symbol === "string" && awaitingTradeAck.delete(result.symbol)) {
        const acknowledgedAt = typeof message.time_out === "string" ? Date.parse(message.time_out) : NaN;
        lastTraffic = now;
        onTradeSubscribed?.(`KRK:${result.symbol}`, acknowledgedAt > 0 ? acknowledgedAt : now);
      }
      return;
    }
    const snapshotOrUpdate = message.type === "snapshot" || message.type === "update";
    if (message.channel === "ticker" && snapshotOrUpdate && receiveTicker && Array.isArray(message.data)) {
      for (const raw of message.data) {
        const row = wireObject(raw);
        if (!active || !row || typeof row.symbol !== "string" || !pairs.has(row.symbol)) continue;
        const { last, high, low, volume, change, timestamp } = row;
        const time = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
        if (typeof last !== "number" || typeof high !== "number" || typeof low !== "number" ||
          typeof volume !== "number" || typeof change !== "number" || ![last, high, low, volume, change, time].every(Number.isFinite) ||
          time <= 0 || last <= 0 || low <= 0 || high < low || volume < 0 || !Number.isFinite(last - change) || last - change <= 0) continue;
        lastTraffic = now;
        receiveTicker({ symbol: `KRK:${row.symbol}`, last, change, high, low, volume, time });
      }
      return;
    }
    if (message.channel === "book" && receiveBook && (message.type === "snapshot" || message.type === "update")) {
      try {
        const precise = parseKrakenBookMessage(data) as { data: { symbol: string }[] };
        for (const item of precise.data) {
          if (!active) break;
          const book = books.get(item.symbol)?.apply(message.type, item, now);
          if (book) { lastTraffic = now; receiveBook(book); }
        }
      } catch { socket.close(); }
      return;
    }
    if (message.channel !== "trade" || message.type !== "update" || !Array.isArray(message.data)) return;
    for (const item of message.data) {
      const tick = parseKrakenTrade(item);
      if (active && tick && pairs.has(tick.symbol.slice(4))) { lastTraffic = now; receive(tick); }
    }
  };
  socket.onerror = () => { if (active) socket.close(); };
  const cleanup = () => {
    active = false;
    clearInterval(watchdog);
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
  };
  socket.onclose = () => {
    if (!active) return;
    cleanup();
    onDisconnect();
  };
  return () => {
    if (!active) return;
    cleanup();
    socket.close();
  };
}


const krakenIntervals: Readonly<Record<string, number>> = {
  "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1D": 1440,
};

export const KRAKEN_NATIVES = Object.entries(krakenIntervals).map(([id, minutes]) => ({ id, api: String(minutes), ms: minutes * 60000 }));

export async function loadKrakenClosedBars(pair: string, timeframe: string, fetcher: typeof fetch = fetch): Promise<OHLCV[]> {
  const plan = planSource(timeframe, KRAKEN_NATIVES);
  if (!plan) return [];
  const url = new URL("https://api.kraken.com/0/public/OHLC");
  url.search = new URLSearchParams({ pair: pair.replace("/", ""), interval: plan.api }).toString();
  const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Kraken history returned HTTP ${response.status}.`);
  const { error, result } = await response.json();
  if (!Array.isArray(error) || error.length || !result || typeof result !== "object") {
    throw new Error("Kraken did not return candle history.");
  }
  const rows = Object.values(result).find(Array.isArray);
  if (!rows) throw new Error("Kraken candle history is missing its rows.");
  let previousTime = -Infinity;
  const closed = rows.slice(0, -1).map((row): OHLCV => {
    if (!Array.isArray(row) || row.length !== 8) throw new Error("Kraken returned a malformed candle.");
    const [time, open, high, low, close, volume] = [row[0], row[1], row[2], row[3], row[4], row[6]].map(wireDecimal);
    if (!Number.isSafeInteger(time * 1000) || time <= 0 || ![open, high, low, close, volume].every(Number.isFinite)
      || low <= 0 || high < Math.max(open, close) || low > Math.min(open, close) || volume < 0
      || time * 1000 <= previousTime || bucketStart(plan.nativeId, time * 1000) !== time * 1000) throw new Error("Kraken returned invalid or unordered candles.");
    previousTime = time * 1000;
    return { time: previousTime, open, high, low, close, volume };
  });
  if (!plan.resample || !closed.length) return closed;
  const first = closed[0].time, through = closed.at(-1)!.time + plan.nativeMs;
  return aggregateBars(closed, timeframe).filter(bar => bar.time >= first && nextBucket(timeframe, bar.time) <= through);
}

export async function loadKrakenTradingIncrements(pair: string, fetcher: typeof fetch = fetch) {
  const url = new URL("https://api.kraken.com/0/public/AssetPairs");
  url.search = new URLSearchParams({ pair: pair.replace("/", ""), assetVersion: "1" }).toString();
  const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Kraken pair metadata returned HTTP ${response.status}.`);
  const payload = await response.json();
  const row = payload?.result?.[pair];
  const tickSize = Number(row?.tick_size), decimals = row?.lot_decimals;
  if (!Array.isArray(payload?.error) || payload.error.length || !Number.isFinite(tickSize) || tickSize <= 0
    || !Number.isInteger(decimals) || decimals < 0 || decimals > 16) throw new Error("Kraken trading increments are unavailable.");
  return { tickSize, quantityStep: Number(`1e-${decimals}`) };
}

export async function loadKrakenRecentTrades(pair: string, count: number, fetcher: typeof fetch = fetch): Promise<(Tick & { seq: number })[]> {
  const url = new URL("https://api.kraken.com/0/public/Trades");
  url.search = new URLSearchParams({ pair: pair.replace("/", ""), assetVersion: "1",
    count: String(Math.max(1, Math.min(1000, Math.floor(count)))) }).toString();
  const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Kraken trade history returned HTTP ${response.status}.`);
  const payload = await response.json(), rows = payload?.result?.[pair];
  if (!Array.isArray(payload?.error) || payload.error.length || !Array.isArray(rows))
    throw new Error("Kraken trade history is unavailable.");
  const trades = new Map<number, Tick & { seq: number }>();
  for (const row of rows) {
    if (!Array.isArray(row) || (row[3] !== "b" && row[3] !== "s") || !Number.isSafeInteger(row[6]) || row[6] < 0) continue;
    const price = Number(row[0]), quantity = Number(row[1]), time = Math.floor(Number(row[2]) * 1000), seq = row[6];
    if (![price, quantity, time].every(value => Number.isFinite(value) && value > 0) || !Number.isSafeInteger(time)) continue;
    const symbol = `KRK:${pair}`;
    trades.set(seq, { id: `${symbol}:${seq}`, symbol, time, price, quantity, side: row[3] === "b" ? "buy" : "sell", simulated: false, seq, tradeCount: 1 });
  }
  return [...trades.values()].sort((a, b) => a.seq - b.seq);
}
