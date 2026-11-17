import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { MarketService } from "@/lib/market/service";
import { useChartStore } from "@/stores/useChartStore";

const symbol = "KRK:BTC/USD";
const timeframe = "1m";
const key = `${symbol}:${timeframe}`;
const nativeSocket = globalThis.WebSocket;
const sockets: WebSocket[] = [];
const state = useChartStore.getState;
const service = new MarketService();
const closes: number[] = [];

async function waitFor(description: string, ready: () => boolean, timeout: number) {
  const deadline = Date.now() + timeout;
  while (!ready()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await delay(250);
  }
}

globalThis.WebSocket = class extends nativeSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    if (new URL(url).hostname === "ws.kraken.com") sockets.push(this);
  }
};

try {
  state().set({ symbol, timeframe, quotes: {}, candleRecoveries: {} });
  service.onClose((market, interval, bar) => {
    if (market === symbol && interval === timeframe) closes.push(bar.time);
  });
  service.start([symbol], "auto");
  await waitFor("public Kraken trades", () => sockets[0]?.readyState === WebSocket.OPEN && state().feedStatus === "live", 15_000);
  const initial = await service.history(symbol, timeframe);
  assert.ok(initial.length, "Initial history is empty");

  const interrupted = Math.floor(Date.now() / 60_000) * 60_000;
  sockets[0].close();
  await waitFor("recovery to start", () => Boolean(state().candleRecoveries[key]), 10_000);
  await waitFor("a replacement connection", () => sockets.length > 1 && sockets.at(-1)?.readyState === WebSocket.OPEN, 15_000);
  await waitFor("the closed-candle repair", () => !state().candleRecoveries[key], 95_000);

  const recovered = await service.history(symbol, timeframe);
  const candle = recovered.find(bar => bar.time === interrupted);
  assert.ok(candle && candle.volume > 0, "Repaired candle is missing or empty");
  const response = await fetch("https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1", { signal: AbortSignal.timeout(8_000) });
  assert.ok(response.ok);
  const payload: { error: string[]; result: Record<string, (string | number)[][] | number> } = await response.json();
  assert.deepEqual(payload.error, []);
  const rows = Object.values(payload.result).find(Array.isArray);
  const expected = rows?.slice(0, -1).find(row => Number(row[0]) * 1_000 === interrupted);
  assert.ok(expected, "Independent response lacks the closed candle");
  assert.deepEqual([candle.open, candle.high, candle.low, candle.close, candle.volume], [1, 2, 3, 4, 6].map(index => Number(expected[index])));
  assert.ok(!closes.includes(interrupted), "The repaired candle dispatched a live close");
  console.log(JSON.stringify({ interrupted: new Date(interrupted), connections: sockets.length, matchedOhlcv: true, historicalCloses: 0 }));
} finally {
  service.stop();
  globalThis.WebSocket = nativeSocket;
}
