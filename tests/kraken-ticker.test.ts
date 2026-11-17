import { expect, it, vi } from "vitest";
import { subscribeKrakenTrades } from "@/lib/market/kraken";
import { MarketService } from "@/lib/market/service";
import { useChartStore } from "@/stores/useChartStore";

it("keeps the latest Kraken watchlist quote when ticker events arrive out of order", () => {
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static readonly OPEN = 1;
    onmessage?: (event: { data: string }) => void;
    constructor(readonly url: string) { sockets.push(this); }
    close() {}
  }
  vi.stubGlobal("WebSocket", FakeSocket);
  const service = new MarketService(), symbol = "KRK:BTC/USD";
  const originalQuotes = useChartStore.getState().quotes;
  try {
    service.start([], "auto", [symbol]);
    const socket = sockets.find(socket => socket.url === "wss://ws.kraken.com/v2");
    expect(socket?.onmessage).toBeDefined();
    const deliver = (last: number, timestamp: string) => socket!.onmessage!({ data: JSON.stringify({
      channel: "ticker", type: "update",
      data: [{ symbol: "BTC/USD", last, timestamp, high: 120, low: 80, volume: 5, change: 10 }],
    }) });
    deliver(110, "2026-11-03T15:00:02.000Z");
    deliver(100, "2026-11-03T15:00:01.000Z");
    const quote = useChartStore.getState().quotes[symbol];
    expect(quote.price).toBe(110);
    expect(quote.time).toBe(Date.parse("2026-11-03T15:00:02.000Z"));
    expect(quote.metrics?.volume.period).toBe("24h");
  } finally {
    service.stop();
    useChartStore.getState().set({ quotes: originalQuotes });
    vi.unstubAllGlobals();
  }
});

it("reconnects only after Kraken socket traffic stops", () => {
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static readonly OPEN = 1;
    onopen?: () => void;
    onclose?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor() { sockets.push(this); }
    send() {}
    close() { this.onclose?.(); }
  }
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  const disconnect = vi.fn();
  const stop = subscribeKrakenTrades(["BTC/USD"], vi.fn(), disconnect);
  try {
    sockets[0].onopen?.();
    vi.advanceTimersByTime(25000);
    sockets[0].onmessage?.({ data: '{"channel":"heartbeat"}' });
    vi.advanceTimersByTime(25000);
    expect(disconnect).not.toHaveBeenCalled();
    for (let i = 0; i < 5; i++) {
      sockets[0].onmessage?.({ data: JSON.stringify({ channel: "trade", type: "update",
        data: [{ symbol: "BTC/USD", price: null }] }) });
      vi.advanceTimersByTime(1000);
    }
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(sockets[0].onmessage).toBeNull();

    const cancel = subscribeKrakenTrades(["BTC/USD"], vi.fn(), disconnect);
    cancel();
    expect(sockets[1].onclose).toBeNull();
    vi.advanceTimersByTime(30000);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

it("backs off Kraken reconnects and resets the delay after market data arrives", () => {
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static readonly OPEN = 1;
    onclose?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor(url: string) { if (url === "wss://ws.kraken.com/v2") sockets.push(this); }
    close() { this.onclose?.(); }
  }
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  const service = new MarketService();
  const originalQuotes = useChartStore.getState().quotes;
  try {
    service.start([], "auto", ["KRK:BTC/USD"]);
    sockets[0].close();
    vi.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1].close();
    vi.advanceTimersByTime(3999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    sockets[2].onmessage?.({ data: JSON.stringify({
      channel: "ticker", type: "snapshot", data: [
        { symbol: "BTC/USD", last: 110, high: 120, low: 80, volume: 5, change: 10, timestamp: new Date().toISOString() },
      ],
    }) });
    sockets[2].close();
    vi.advanceTimersByTime(2000);
    expect(sockets).toHaveLength(4);
    sockets[3].close();
    service.stop();
    vi.advanceTimersByTime(30000);
    expect(sockets).toHaveLength(4);
  } finally {
    service.stop();
    useChartStore.getState().set({ quotes: originalQuotes });
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

it("counts overlapping Kraken REST and WebSocket trades only once in a tick candle", async () => {
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static readonly OPEN = 1;
    onmessage?: (event: { data: string }) => void;
    constructor(url: string) { if (url === "wss://ws.kraken.com/v2") sockets.push(this); }
    close() {}
  }
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    error: [], result: { "BTC/USD": [
      ["100", "2", 1793718000, "b", "m", "", 100],
      ["101", "3", 1793718001, "s", "m", "", 101],
    ] },
  })));
  const service = new MarketService();
  const market = { symbol: "KRK:BTC/USD", timeframe: "10T" };
  const initial = useChartStore.getState();
  try {
    service.start([market.symbol], "auto");
    const seeded = await service.velaFeed.load(market);
    expect(seeded.at(-1)?.volume).toBe(5);
    const deliver = (trade_id: number, price: number, qty: number) => sockets[0].onmessage?.({ data: JSON.stringify({
      channel: "trade", type: "update", data: [{ symbol: "BTC/USD", side: "buy", trade_id, price, qty,
        timestamp: "2026-11-03T15:00:02.000Z" }],
    }) });
    deliver(101, 101, 3);
    expect(service.barsFor(market.symbol, market.timeframe).at(-1)?.volume).toBe(5);
    deliver(102, 102, 4);
    expect(service.barsFor(market.symbol, market.timeframe).at(-1)).toMatchObject({ volume: 9, close: 102 });
  } finally {
    service.stop();
    useChartStore.setState(initial);
    vi.unstubAllGlobals();
  }
});
