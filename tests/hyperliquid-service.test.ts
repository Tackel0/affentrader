import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OHLCV } from "@luxalgo/vela";

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const asset = { coin: "BTC", symbol: "HL:BTC", dex: "", name: "BTC", dexName: "Hyperliquid", maxLeverage: 40, szDecimals: 5, mark: 100, previousDay: 95, volume: 1000, baseVolume: 12, openInterest: 1, funding: 0 };
const trade = (tid: number, side: "B" | "A" = "B", px = "100.5") => ({ coin: "BTC", side, px, sz: "0.5", time: 1_700_000_000_000 + tid, tid });
const nativeCandle = (time: number, count = 1, volume = 1) => ({ s: "BTC", i: "1m", t: time, T: time + 59999,
  o: "100", h: "110", l: "90", c: "105", v: String(volume), n: count });

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  const memory = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("kind=assets")) return new Response(JSON.stringify({ assets: [asset] }), { status: 200 });
      return new Response("{}", { status: 404 });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function setup() {
  const { MarketService } = await import("@/lib/market/service");
  const { useChartStore } = await import("@/stores/useChartStore");
  const service = new MarketService();
  useChartStore.getState().set({ symbol: "HL:BTC" });
  service.start(["HL:BTC"], "auto");
  const socket = () => FakeSocket.instances.at(-1)!;
  return { service, store: useChartStore, socket };
}

describe("Hyperliquid feed", () => {
  it("probes two silent chart channels and reconnects only when REST proves newer traded data", async () => {
    vi.setSystemTime(1_800_000_001_000);
    const { service, socket } = await setup(), prior = fetch;
    const fetcher = vi.fn((url: string, init?: RequestInit) => String(url).includes("kind=candles")
      ? Promise.resolve(Response.json({ candles: [nativeCandle(1_799_999_940_000), nativeCandle(1_800_000_000_000, 2, 2)] })) : prior(url, init));
    vi.stubGlobal("fetch", fetcher); service.subscribe("HL:BTC", "1m", () => {}); const current = socket(); current.open();
    current.receive({ channel: "candle", data: nativeCandle(1_800_000_000_000) });
    try {
      for (let i = 0; i < 50 && current.readyState === 1; i++) { current.receive({ channel: "allMids", data: { mids: { BTC: "100" } } }); await vi.advanceTimersByTimeAsync(1000); }
      expect(fetcher.mock.calls.some(([url]) => String(url).includes("kind=candles"))).toBe(true); expect(current.readyState).toBe(3);
    } finally { service.stop(); }
  });
  it("keeps unchanged quiet-market snapshots connected and bounds repeated REST checks", async () => {
    vi.setSystemTime(1_800_000_001_000);
    const { service, socket } = await setup(), prior = fetch;
    const fetcher = vi.fn((url: string, init?: RequestInit) => String(url).includes("kind=candles")
      ? Promise.resolve(Response.json({ candles: [nativeCandle(1_799_999_940_000), nativeCandle(1_800_000_000_000)] })) : prior(url, init));
    vi.stubGlobal("fetch", fetcher); service.subscribe("HL:BTC", "1m", () => {}); const current = socket(); current.open();
    current.receive({ channel: "candle", data: nativeCandle(1_800_000_000_000) });
    try {
      for (let i = 0; i < 90; i++) { current.receive({ channel: "allMids", data: { mids: { BTC: "100" } } }); await vi.advanceTimersByTimeAsync(1000); }
      expect(current.readyState).toBe(1); expect(fetcher.mock.calls.filter(([url]) => String(url).includes("kind=candles"))).toHaveLength(1);
    } finally { service.stop(); }
  });
  it("does not let an in-flight quiet probe close a stream that recovered before the HTTP response", async () => {
    vi.setSystemTime(1_800_000_001_000);
    const { service, socket } = await setup(), prior = fetch; let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => String(url).includes("kind=candles")
      ? new Promise<Response>(resolve => { finish = resolve; }) : prior(url, init)));
    service.subscribe("HL:BTC", "1m", () => {}); const current = socket(); current.open(); current.receive({ channel: "candle", data: nativeCandle(1_800_000_000_000) });
    try {
      for (let i = 0; i < 47; i++) { current.receive({ channel: "allMids", data: { mids: { BTC: "100" } } }); await vi.advanceTimersByTimeAsync(1000); }
      expect(finish).toBeTypeOf("function"); current.receive({ channel: "candle", data: nativeCandle(1_800_000_000_000, 2, 2) });
      finish(Response.json({ candles: [nativeCandle(1_799_999_940_000), nativeCandle(1_800_000_000_000, 3, 3)] }));
      await vi.advanceTimersByTimeAsync(5); expect(current.readyState).toBe(1);
    } finally { service.stop(); }
  });
  it("fences late quiet-probe responses after a replacement socket takes ownership", async () => {
    vi.setSystemTime(1_800_000_001_000);
    const { service, socket } = await setup(), prior = fetch; let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => String(url).includes("kind=candles")
      ? new Promise<Response>(resolve => { finish = resolve; }) : prior(url, init)));
    service.subscribe("HL:BTC", "1m", () => {}); const original = socket(); original.open(); original.receive({ channel: "candle", data: nativeCandle(1_800_000_000_000) });
    try {
      for (let i = 0; i < 47; i++) { original.receive({ channel: "allMids", data: { mids: { BTC: "100" } } }); await vi.advanceTimersByTimeAsync(1000); }
      expect(finish).toBeTypeOf("function"); original.close(); await vi.advanceTimersByTimeAsync(2000); const replacement = socket(); replacement.open();
      finish(Response.json({ candles: [nativeCandle(1_799_999_940_000), nativeCandle(1_800_000_000_000, 3, 3)] }));
      await vi.advanceTimersByTimeAsync(5); expect(replacement.readyState).toBe(1); expect(socket()).toBe(replacement);
    } finally { service.stop(); }
  });
  it("reconnects a selectively silent candle channel while mids and fresh classified trades keep arriving", async () => {
    vi.setSystemTime(1_800_000_001_000);
    const { service, store, socket } = await setup(); service.subscribe("HL:BTC", "1m", () => {});
    const current = socket(); current.open();
    try {
      for (let i = 0; i < 35 && current.readyState === 1; i++) {
        current.receive({ channel: "allMids", data: { mids: { BTC: "100" } } });
        current.receive({ channel: "trades", data: [{ ...trade(100 + i), time: Date.now() }] });
        await vi.advanceTimersByTimeAsync(1000);
      }
      expect(current.readyState).toBe(3); expect(store.getState().feedStatus).toBe("reconnecting");
      await vi.advanceTimersByTimeAsync(2000); expect(socket()).not.toBe(current);
      socket().open(); expect(socket().sent.some(raw => JSON.parse(raw).subscription?.type === "candle")).toBe(true);
    } finally { service.stop(); }
  });
  it("reconnects missing classified trades when accepted current candle counts keep increasing", async () => {
    vi.setSystemTime(1_800_000_001_000);
    const { service, socket } = await setup(); service.subscribe("HL:BTC", "1m", () => {});
    const current = socket(); current.open();
    try {
      for (let i = 1; i < 36 && current.readyState === 1; i++) {
        current.receive({ channel: "allMids", data: { mids: { BTC: "100" } } });
        current.receive({ channel: "candle", data: nativeCandle(Math.floor(Date.now() / 60000) * 60000, i, i) });
        await vi.advanceTimersByTimeAsync(1000);
      }
      expect(current.readyState).toBe(3);
    } finally { service.stop(); }
  });
  it("does not reconnect a quiet market solely because the shared socket continues to publish mids", async () => {
    vi.setSystemTime(1_800_000_001_000);
    const { service, socket } = await setup(); service.subscribe("HL:BTC", "1m", () => {});
    const current = socket(); current.open(); current.receive({ channel: "candle", data: nativeCandle(1_800_000_000_000) });
    try {
      for (let i = 0; i < 90; i++) { current.receive({ channel: "allMids", data: { mids: { BTC: "100" } } }); await vi.advanceTimersByTimeAsync(1000); }
      expect(current.readyState).toBe(1); expect(socket()).toBe(current);
    } finally { service.stop(); }
  });
  it("keeps trade delivery and later queued bursts running when quote/trade consumers throw", async () => {
    const { service, store, socket } = await setup(), errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const received: number[] = [], quoted: number[] = [];
    service.onQuote(value => { if (value.priceBasis === "trade") throw new Error("quote consumer failed"); });
    service.onQuote(value => { if (value.priceBasis === "trade") quoted.push(value.price); });
    service.onTick(() => { throw new Error("trade consumer failed"); });
    service.onTick(value => received.push(value.price));
    try {
      socket().open();
      socket().receive({ channel: "trades", data: Array.from({ length: 17 }, (_, i) => trade(i + 1, "B", String(101 + i))) });
      await vi.advanceTimersByTimeAsync(40);
      expect(received).toEqual(Array.from({ length: 17 }, (_, i) => 101 + i));
      for (const price of received) expect(quoted).toContain(price);
      socket().receive({ channel: "trades", data: [trade(18, "B", "118")] });
      await vi.advanceTimersByTimeAsync(10);
      expect(received.at(-1)).toBe(118); expect(store.getState().quotes["HL:BTC"].price).toBe(118);
      expect(service.tradesFor("HL:BTC")).toHaveLength(18); expect(errors).toHaveBeenCalledTimes(2);
    } finally { service.stop(); errors.mockRestore(); }
  });
  it("does not let an old queued drain erase a replacement generation's trades", async () => {
    const { service, store, socket } = await setup(), received: number[] = [];
    service.onTick(value => received.push(value.price)); socket().open();
    socket().receive({ channel: "trades", data: [trade(1, "B", "101")] });
    service.stop(); service.start(["HL:BTC"], "auto"); socket().open();
    socket().receive({ channel: "trades", data: [trade(2, "B", "202")] });
    try {
      await vi.advanceTimersByTimeAsync(20);
      expect(received).toEqual([202]); expect(store.getState().quotes["HL:BTC"].price).toBe(202);
      expect(service.tradesFor("HL:BTC").map(tick => tick.price)).toEqual([202]);
    } finally { service.stop(); }
  });
  it("isolates native candle, close and book consumers without withholding healthy consumers or store updates", async () => {
    const { service, store, socket } = await setup(), errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const bars = vi.fn(), closes = vi.fn(), books = vi.fn(), at = Math.floor(Date.now() / 60000) * 60000;
    service.subscribe("HL:BTC", "1m", () => { throw new Error("bar consumer failed"); }); service.subscribe("HL:BTC", "1m", bars);
    service.onClose(() => { throw new Error("close consumer failed"); }); service.onClose(closes);
    service.onBook(() => { throw new Error("book consumer failed"); }); service.onBook(books);
    try {
      socket().open();
      for (let i = 0; i < 3; i++) socket().receive({ channel: "candle", data: nativeCandle(at + i * 60000) });
      for (let i = 0; i < 2; i++) socket().receive({ channel: "l2Book", data: { coin: "BTC", time: at + i, levels: [[{ px: "99", sz: "1" }], [{ px: "101", sz: "1" }]] } });
      expect(bars).toHaveBeenCalledTimes(3); expect(closes).toHaveBeenCalledTimes(2); expect(books).toHaveBeenCalledTimes(2);
      expect(service.barsFor("HL:BTC", "1m").at(-1)?.time).toBe(at + 120000);
      expect(store.getState().orderBook?.time).toBe(at + 1); expect(errors).toHaveBeenCalledTimes(3);
    } finally { service.stop(); errors.mockRestore(); }
  });
  it("continues derived bars and closes after a consumer fails, and reports a later distinct failure after recovery", async () => {
    const { service, socket } = await setup(), errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let broken = true;
    const received = vi.fn(), closes = vi.fn(), ticks = vi.fn();
    service.subscribe("HL:BTC", "1s", () => { if (broken) throw new Error("derived bar failed"); }); service.subscribe("HL:BTC", "1s", received);
    service.onClose(closes); service.onTick(ticks);
    const at = Math.floor(Date.now() / 1000) * 1000;
    try {
      socket().open();
      socket().receive({ channel: "trades", data: [1, 2, 3].map(i => ({ ...trade(i), time: at + i * 1000 })) });
      await vi.advanceTimersByTimeAsync(20);
      expect(received).toHaveBeenCalledTimes(3); expect(ticks).toHaveBeenCalledTimes(3);
      expect(closes.mock.calls.filter(call => call[1] === "1s")).toHaveLength(2); expect(errors).toHaveBeenCalledTimes(1);
      broken = false; socket().receive({ channel: "trades", data: [{ ...trade(4), time: at + 4000 }] }); await vi.advanceTimersByTimeAsync(10);
      broken = true; socket().receive({ channel: "trades", data: [{ ...trade(5), time: at + 5000 }] }); await vi.advanceTimersByTimeAsync(10);
      expect(received).toHaveBeenCalledTimes(5); expect(ticks).toHaveBeenCalledTimes(5); expect(errors).toHaveBeenCalledTimes(2);
    } finally { service.stop(); errors.mockRestore(); }
  });
  it("abandons the old batch and old tick writes when a quote consumer replaces the source during notification", async () => {
    const { service, store, socket } = await setup(), received: number[] = [];
    service.onTick(value => received.push(value.price));
    const detach = service.onQuote(value => {
      if (value.priceBasis !== "trade") return;
      detach(); service.stop(); service.start(["HL:BTC"], "auto"); socket().open();
      socket().receive({ channel: "trades", data: [trade(100, "B", "202")] });
    });
    try {
      socket().open(); socket().receive({ channel: "trades", data: Array.from({ length: 8 }, (_, i) => trade(i + 1, "B", String(101 + i))) });
      await vi.advanceTimersByTimeAsync(30);
      expect(received).toEqual([202]); expect(store.getState().quotes["HL:BTC"].price).toBe(202);
      expect(service.tradesFor("HL:BTC").map(value => value.price)).toEqual([202]);
    } finally { service.stop(); }
  });
  it("does not let a late repair from a replaced socket poison a freshly resumed same-bucket series", async () => {
    const { service, store, socket } = await setup();
    const now = Math.floor(Date.now() / 60000) * 60000;
    service.subscribe("HL:BTC", "1m", () => {}); socket().open();
    socket().receive({ channel: "candle", data: nativeCandle(now, 10, 10) });
    let finish!: (response: Response) => void;
    const priorFetch = fetch;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => String(url).includes("kind=candles")
      ? new Promise<Response>(resolve => { finish = resolve; }) : priorFetch(url, init)));
    const repair = service.velaFeed.loadRange!({ symbol: "HL:BTC", timeframe: "1m" }, { from: now });
    const rejected = expect(repair).rejects.toThrow("connection changed");
    socket().close(); await vi.advanceTimersByTimeAsync(2000); socket().open();
    socket().receive({ channel: "candle", data: nativeCandle(now, 11, 11) });
    expect(store.getState().candleRecoveries["HL:BTC:1m"]).toBeUndefined();
    finish(new Response(JSON.stringify({ candles: [nativeCandle(now - 60000), nativeCandle(now)] })));
    await rejected;
    expect(store.getState().candleRecoveries["HL:BTC:1m"]).toBeUndefined();
    expect(service.barsFor("HL:BTC", "1m").at(-1)?.volume).toBe(11);
    service.stop();
  });
  it("starts a replacement-socket repair without waiting for an old request and ignores its late failure", async () => {
    // Stay inside one minute while advancing the reconnect timer: crossing a
    // real-clock minute would request an extra REST page the two-response fixture never resolves.
    vi.setSystemTime(Date.UTC(2026, 10, 4, 12, 0, 10));
    const { service, store, socket } = await setup();
    const now = Math.floor(Date.now() / 60000) * 60000, anchor = now - 120000;
    service.subscribe("HL:BTC", "1m", () => {}); socket().open();
    socket().receive({ channel: "candle", data: nativeCandle(anchor, 10, 10) });
    const finishes: Array<(response: Response) => void> = [], priorFetch = fetch;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => String(url).includes("kind=candles")
      ? new Promise<Response>(resolve => { finishes.push(resolve); }) : priorFetch(url, init)));
    socket().receive({ channel: "candle", data: nativeCandle(now) });
    expect(finishes).toHaveLength(1);
    socket().close(); await vi.advanceTimersByTimeAsync(2000); socket().open();
    socket().receive({ channel: "candle", data: nativeCandle(now, 2, 2) });
    expect(finishes).toHaveLength(2);
    const repaired = service.velaFeed.loadRange!({ symbol: "HL:BTC", timeframe: "1m" }, { from: anchor });
    finishes[0](new Response(JSON.stringify({ candles: [nativeCandle(anchor - 60000), nativeCandle(anchor), nativeCandle(anchor + 60000), nativeCandle(now)] })));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().candleRecoveries["HL:BTC:1m"].status).toBe("loading");
    const joined = service.velaFeed.loadRange!({ symbol: "HL:BTC", timeframe: "1m" }, { from: anchor });
    expect(finishes).toHaveLength(2);
    finishes[1](new Response(JSON.stringify({ candles: [nativeCandle(anchor - 60000), nativeCandle(anchor, 11, 11), nativeCandle(anchor + 60000), nativeCandle(now, 2, 2)] })));
    await Promise.all([repaired, joined]);
    expect(store.getState().candleRecoveries["HL:BTC:1m"]).toBeUndefined();
    expect(service.barsFor("HL:BTC", "1m")).toHaveLength(4);
    expect(service.barsFor("HL:BTC", "1m").at(-1)?.volume).toBe(2);
    service.stop();
  });
  it("retains native historical pages for older Replay without replacing current snapshots or firing signals", async () => {
    const { service, store, socket } = await setup();
    store.getState().set({ timeframe: "1m" });
    const now = Math.floor(Date.now() / 60000) * 60000;
    socket().open(); service.subscribe("HL:BTC", "1m", () => {});
    socket().receive({ channel: "candle", data: nativeCandle(now, 10, 10) });
    const onTick = vi.fn(), onClose = vi.fn(); service.onTick(onTick); service.onClose(onClose);
    const originalFetch = fetch;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => String(url).includes("kind=candles")
      ? Promise.resolve(new Response(JSON.stringify({ candles: [nativeCandle(now - 120000), nativeCandle(now - 60000), nativeCandle(now)] }))) : originalFetch(url, init)));
    const page = await service.velaFeed.loadRange!({ symbol: "HL:BTC", timeframe: "1m" }, { to: now, limit: 3 });
    expect(page).toHaveLength(3);
    expect(service.barsFor("HL:BTC", "1m")).toHaveLength(3);
    expect(service.barsFor("HL:BTC", "1m").at(-1)!.volume).toBe(10);
    expect(store.getState().candles).toHaveLength(3);
    expect(onTick).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    service.stop();
  });
  it("does not retain an old page after the feed generation changes", async () => {
    const { service, socket } = await setup();
    const now = Math.floor(Date.now() / 60000) * 60000;
    socket().open(); service.subscribe("HL:BTC", "1m", () => {});
    socket().receive({ channel: "candle", data: nativeCandle(now) });
    let finish!: (response: Response) => void;
    const originalFetch = fetch;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => String(url).includes("kind=candles")
      ? new Promise<Response>(resolve => { finish = resolve; }) : originalFetch(url, init)));
    const pending = service.velaFeed.loadRange!({ symbol: "HL:BTC", timeframe: "1m" }, { to: now - 60000, limit: 1 });
    service.stop(); service.start(["HL:ETH"], "auto");
    finish(new Response(JSON.stringify({ candles: [nativeCandle(now - 60000)] })));
    await pending;
    expect(service.barsFor("HL:BTC", "1m")).toEqual([]);
    service.stop();
  });
  it("batches quote-only trades without turning them into chart or execution ticks", async () => {
    const { MarketService } = await import("@/lib/market/service");
    const { useChartStore } = await import("@/stores/useChartStore");
    const service = new MarketService();
    service.start([], "auto", ["HL:BTC"]);
    await vi.advanceTimersByTimeAsync(100);
    const socket = FakeSocket.instances.at(-1)!;
    socket.open();
    const tick = vi.fn(), publication = vi.fn();
    const offTick = service.onTick(tick);
    const offStore = useChartStore.subscribe((state, old) => { if (state.quotes !== old.quotes) publication(); });
    socket.receive({ channel: "trades", data: [trade(3, "B", "104"), trade(1, "B", "102"), trade(2, "B", "103")] });
    expect(useChartStore.getState().quotes["HL:BTC"]).toMatchObject({ price: 104, priceBasis: "trade", time: trade(3).time, history: [104], volume: 12 });
    expect(publication).toHaveBeenCalledTimes(1);
    const before = useChartStore.getState().quotes["HL:BTC"];
    socket.receive({ channel: "allMids", data: { mids: { BTC: "110" } } });
    await vi.advanceTimersByTimeAsync(100);
    expect(useChartStore.getState().quotes["HL:BTC"]).toMatchObject({ price: 104, time: trade(3).time });
    expect(useChartStore.getState().quotes["HL:BTC"].history).toBe(before.history);
    expect(tick).not.toHaveBeenCalled();
    expect(service.tradesFor("HL:BTC")).toEqual([]);
    expect(service.barsFor("HL:BTC", "1m")).toEqual([]);
    offTick(); offStore(); service.stop();
  });
  it("does not publish an old quote batch after a synchronous store consumer replaces the feed", async () => {
    const { MarketService } = await import("@/lib/market/service");
    const { useChartStore } = await import("@/stores/useChartStore");
    const service = new MarketService();
    service.start([], "auto", ["HL:BTC"]);
    await vi.advanceTimersByTimeAsync(100);
    const original = FakeSocket.instances.at(-1)!; original.open();
    const quotes: number[] = [];
    service.onQuote(value => { if (value.priceBasis === "trade") quotes.push(value.price); });
    const detach = useChartStore.subscribe((state, old) => {
      if (state.quotes === old.quotes || state.quotes["HL:BTC"]?.price !== 104) return;
      detach(); service.stop(); service.start([], "auto", ["HL:BTC"]);
    });
    try {
      original.receive({ channel: "trades", data: [trade(3, "B", "104")] });
      expect(quotes).toEqual([]);
      await vi.advanceTimersByTimeAsync(100);
      const replacement = FakeSocket.instances.at(-1)!; replacement.open();
      replacement.receive({ channel: "trades", data: [trade(4, "B", "202")] });
      expect(quotes).toEqual([202]);
    } finally { detach(); service.stop(); }
  });
  it("does not deliver an old chart trade quote after a synchronous store consumer replaces the feed", async () => {
    const { service, store, socket } = await setup();
    const quotes: number[] = [], ticks: number[] = [];
    service.onQuote(value => { if (value.priceBasis === "trade") quotes.push(value.price); });
    service.onTick(value => ticks.push(value.price)); socket().open();
    const detach = store.subscribe((state, old) => {
      if (state.quotes === old.quotes || state.quotes["HL:BTC"]?.price !== 104) return;
      detach(); service.stop(); service.start(["HL:BTC"], "auto");
    });
    try {
      socket().receive({ channel: "trades", data: [trade(3, "B", "104")] });
      await vi.advanceTimersByTimeAsync(20);
      expect(quotes).toEqual([]); expect(ticks).toEqual([]);
      socket().open(); socket().receive({ channel: "trades", data: [trade(4, "B", "202")] });
      await vi.advanceTimersByTimeAsync(20);
      expect(quotes).toEqual([202]); expect(ticks).toEqual([202]);
      expect(store.getState().quotes["HL:BTC"].price).toBe(202);
    } finally { detach(); service.stop(); }
  });
  it("refreshes quote priority without replacing chart history or reconnecting for mere reordering", async () => {
    const { service, socket } = await setup();
    const now = Math.floor(Date.now() / 60000) * 60000;
    service.subscribe("HL:BTC", "1m", () => {});
    socket().open(); socket().receive({ channel: "candle", data: nativeCandle(now) });
    service.start(["HL:BTC"], "auto", ["HL:ETH", "HL:SOL"], ["HL:SOL", "HL:ETH"]);
    const current = socket(); current.open();
    expect(service.barsFor("HL:BTC", "1m")).toHaveLength(0);
    current.receive({ channel: "candle", data: nativeCandle(now) });
    expect(service.barsFor("HL:BTC", "1m")).toHaveLength(1);
    const count = FakeSocket.instances.length;
    service.start(["HL:BTC"], "auto", ["HL:ETH", "HL:SOL"], ["HL:ETH", "HL:SOL"]);
    expect(FakeSocket.instances).toHaveLength(count);
    expect(current.sent.map(message => JSON.parse(message).subscription).filter(subscription => subscription?.type === "trades")).toEqual([
      { type: "trades", coin: "BTC" }, { type: "trades", coin: "ETH" }, { type: "trades", coin: "SOL" },
    ]);
    service.stop();
  });
  it("hands a large repair to the native range seam without replaying every bar or poisoning other subscribers", async () => {
    const { service, store, socket } = await setup();
    const now = Math.floor(Date.now() / 60000) * 60000, anchor = now - 1000 * 60000;
    let last = anchor, range: Promise<OHLCV[]> | undefined, notifications = 0, first = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      service.subscribe("HL:BTC", "1m", bar => {
        notifications++;
        if (bar.time < last) return;
        if (bar.time > last + 90000) range = service.velaFeed.loadRange!({ symbol: "HL:BTC", timeframe: "1m" }, { from: last });
        last = bar.time;
      });
      service.subscribe("HL:BTC", "1m", () => { if (first) { first = false; return; } throw new Error("Renderer consumer failed"); });
      socket().open();
      const priorFetch = fetch;
      const data = Array.from({ length: 1002 }, (_, index) => nativeCandle(anchor + (index - 1) * 60000));
      const fetcher = vi.fn((url: string, init?: RequestInit) => {
        if (!String(url).includes("kind=candles")) return priorFetch(url, init);
        const query = new URL(String(url), "http://localhost").searchParams;
        return Promise.resolve(new Response(JSON.stringify({ candles: data.filter(row => row.t >= Number(query.get("start")) && row.t <= Number(query.get("end"))) })));
      });
      vi.stubGlobal("fetch", fetcher);
      socket().receive({ channel: "candle", data: nativeCandle(anchor) });
      socket().receive({ channel: "candle", data: nativeCandle(now) });
      await vi.advanceTimersByTimeAsync(0);
      expect(range).toBeDefined();
      expect(await range).toHaveLength(1001);
      expect(notifications).toBe(3);
      expect(service.barsFor("HL:BTC", "1m")).toHaveLength(1002);
      expect(store.getState().candleRecoveries["HL:BTC:1m"]).toBeUndefined();
      expect(fetcher.mock.calls.filter(([url]) => String(url).includes("kind=candles"))).toHaveLength(2);
      expect(errors).toHaveBeenCalledTimes(2);
      await service.velaFeed.loadRange!({ symbol: "HL:BTC", timeframe: "1m" }, { from: now - 120000 });
      expect(fetcher.mock.calls.filter(([url]) => String(url).includes("kind=candles"))).toHaveLength(3);
    } finally { service.stop(); errors.mockRestore(); }
  });
  it("reconnects public data on demand without clearing chart history or changing its generation", async () => {
    const { service, store, socket } = await setup();
    const now = Math.floor(Date.now() / 60000) * 60000;
    service.subscribe("HL:BTC", "1m", () => {}); socket().open();
    socket().receive({ channel: "candle", data: nativeCandle(now, 10, 10) });
    const epoch = store.getState().feedEpoch, history = store.getState().candles;
    expect(service.reconnect()).toBe(true);
    expect(store.getState().feedEpoch).toBe(epoch);
    expect(store.getState().candles).toEqual(history);
    expect(service.barsFor("HL:BTC", "1m")).toEqual([]);
    socket().open(); socket().receive({ channel: "candle", data: nativeCandle(now, 10, 10) });
    expect(service.barsFor("HL:BTC", "1m")).toHaveLength(1);
    service.start(["HL:BTC"], "simulation");
    expect(service.reconnect()).toBe(false);
    service.stop();
  });
  it("withholds technical history across reconnect until a non-stale native snapshot arrives", async () => {
    const { service, store, socket } = await setup();
    const now = Math.floor(Date.now() / 60000) * 60000;
    service.subscribe("HL:BTC", "1m", () => {}); socket().open();
    socket().receive({ channel: "candle", data: nativeCandle(now, 10, 10) });
    expect(service.barsFor("HL:BTC", "1m")).toHaveLength(1);
    socket().close();
    expect(service.barsFor("HL:BTC", "1m")).toEqual([]);
    expect(store.getState().candleRecoveries["HL:BTC:1m"].status).toBe("refreshing");
    await vi.advanceTimersByTimeAsync(2000); socket().open();
    socket().receive({ channel: "candle", data: nativeCandle(now, 9, 9) });
    expect(service.barsFor("HL:BTC", "1m")).toEqual([]);
    socket().receive({ channel: "candle", data: nativeCandle(now, 10, 10) });
    expect(service.barsFor("HL:BTC", "1m")).toHaveLength(1);
    expect(store.getState().candleRecoveries["HL:BTC:1m"]).toBeUndefined();
    service.stop();
  });

  it("repairs an interrupted close across one boundary without emitting that old close", async () => {
    const { service, socket } = await setup();
    const now = Math.floor(Date.now() / 60000) * 60000, previous = now - 60000;
    const closes = vi.fn(); service.onClose(closes); service.subscribe("HL:BTC", "1m", () => {});
    socket().open(); socket().receive({ channel: "candle", data: nativeCandle(previous) }); socket().close();
    const priorFetch = fetch;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => String(url).includes("kind=candles")
      ? Promise.resolve(new Response(JSON.stringify({ candles: [nativeCandle(previous - 60000), nativeCandle(previous, 3, 3), nativeCandle(now)] })))
      : priorFetch(url, init)));
    await vi.advanceTimersByTimeAsync(2000); socket().open();
    socket().receive({ channel: "candle", data: nativeCandle(now) });
    await service.velaFeed.loadRange!({ symbol: "HL:BTC", timeframe: "1m" }, { from: previous });
    expect(service.barsFor("HL:BTC", "1m").find(bar => bar.time === previous)?.volume).toBe(3);
    expect(closes).not.toHaveBeenCalled();
    service.stop();
  });

  it("does not resume technical history when the repair socket closed before its response", async () => {
    const { service, store, socket } = await setup();
    const now = Math.floor(Date.now() / 60000) * 60000, anchor = now - 180000;
    service.subscribe("HL:BTC", "1m", () => {}); socket().open();
    const priorFetch = fetch;
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => String(url).includes("kind=candles")
      ? new Promise<Response>(resolve => { finish = resolve; }) : priorFetch(url, init)));
    socket().receive({ channel: "candle", data: nativeCandle(anchor) });
    socket().receive({ channel: "candle", data: nativeCandle(now) });
    const repair = service.velaFeed.loadRange!({ symbol: "HL:BTC", timeframe: "1m" }, { from: anchor });
    socket().close();
    finish(new Response(JSON.stringify({ candles: [-1, 0, 1, 2, 3].map(i => nativeCandle(anchor + i * 60000)) })));
    await expect(repair).rejects.toThrow("connection changed");
    expect(service.barsFor("HL:BTC", "1m")).toEqual([]);
    expect(store.getState().candleRecoveries["HL:BTC:1m"].status).toBe("retrying");
    service.stop();
  });
  it("repairs missed native candles, shares the range request and does not replay alert closes", async () => {
    const { service, store, socket } = await setup();
    const now = Math.floor(Date.now() / 60000) * 60000, anchor = now - 180000;
    const delivered = vi.fn(), closes = vi.fn();
    service.subscribe("HL:BTC", "1m", delivered); service.onClose(closes);
    store.getState().set({ timeframe: "1m" }); socket().open();
    const priorFetch = fetch;
    let finish!: (response: Response) => void;
    const requests = vi.fn((url: string, init?: RequestInit) => String(url).includes("kind=candles")
      ? new Promise<Response>(resolve => { finish = resolve; }) : priorFetch(url, init));
    vi.stubGlobal("fetch", requests);
    socket().receive({ channel: "candle", data: nativeCandle(anchor) });
    socket().receive({ channel: "candle", data: nativeCandle(now, 2, 2) });
    expect(service.barsFor("HL:BTC", "1m")).toEqual([]);
    expect(store.getState().candleRecoveries["HL:BTC:1m"].status).toBe("loading");
    expect(delivered).toHaveBeenCalledTimes(1);
    const ranged = service.velaFeed.loadRange!({ symbol: "HL:BTC", timeframe: "1m" }, { from: anchor });
    const latestTwo = service.history("HL:BTC", "1m", 2);
    expect(requests.mock.calls.filter(([url]) => String(url).includes("kind=candles"))).toHaveLength(1);
    socket().receive({ channel: "candle", data: nativeCandle(now, 5, 5) });
    finish(new Response(JSON.stringify({ candles: [nativeCandle(anchor - 60000), nativeCandle(anchor, 3, 3), nativeCandle(anchor + 60000),
      nativeCandle(anchor + 120000), nativeCandle(now, 3, 3)] })));
    const recovered = await ranged;
    expect((await latestTwo).map(value => value.time)).toEqual([anchor + 120000, now]);
    expect(recovered.map(value => value.time)).toEqual([anchor, anchor + 60000, anchor + 120000, now]);
    expect(recovered.at(-1)?.volume).toBe(5);
    expect(store.getState().candleRecoveries["HL:BTC:1m"]).toBeUndefined();
    expect(service.barsFor("HL:BTC", "1m")).toHaveLength(5);
    expect(delivered.mock.calls.map(([value]) => value.time)).toEqual([anchor, anchor, now]);
    expect(closes).not.toHaveBeenCalled();
    socket().receive({ channel: "candle", data: nativeCandle(now + 60000) });
    expect(closes).toHaveBeenCalledTimes(1);
    expect(closes.mock.calls[0][2]).toMatchObject({ time: now, volume: 5 });
    service.stop();
  });

  it("forces a fresh tail request for Vela's from-only range instead of returning cached history", async () => {
    const { service, socket } = await setup();
    const now = Math.floor(Date.now() / 60000) * 60000;
    socket().open();
    const priorFetch = fetch;
    let refreshed = false;
    const requests = vi.fn((url: string, init?: RequestInit) => String(url).includes("kind=candles")
      ? Promise.resolve(new Response(JSON.stringify({ candles: Array.from({ length: 10 }, (_, index) =>
        nativeCandle(now - (9 - index) * 60000, refreshed ? 10 : 1, refreshed ? 10 : 1)) })))
      : priorFetch(url, init));
    vi.stubGlobal("fetch", requests);
    await service.history("HL:BTC", "1m", 10);
    refreshed = true;
    const range = await service.velaFeed.loadRange!({ symbol: "HL:BTC", timeframe: "1m" }, { from: now - 120000 });
    expect(requests.mock.calls.filter(([url]) => String(url).includes("kind=candles"))).toHaveLength(2);
    expect(range.map(value => value.time)).toEqual([now - 120000, now - 60000, now]);
    expect(range.at(-1)?.volume).toBe(10);
    service.stop();
  });

  it("fences a repair response from a replaced socket within the same market generation", async () => {
    const { service, store, socket } = await setup();
    const now = Math.floor(Date.now() / 60000) * 60000, anchor = now - 180000;
    const delivered = vi.fn(); service.subscribe("HL:BTC", "1m", delivered); socket().open();
    const epoch = store.getState().feedEpoch, priorFetch = fetch;
    let finish!: (response: Response) => void, delayed = true;
    const body = { candles: [-1, 0, 1, 2, 3].map(index => nativeCandle(anchor + index * 60000)) };
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => String(url).includes("kind=candles")
      ? delayed ? new Promise<Response>(resolve => { finish = resolve; }) : Promise.resolve(new Response(JSON.stringify(body)))
      : priorFetch(url, init)));
    socket().receive({ channel: "candle", data: nativeCandle(anchor) });
    socket().receive({ channel: "candle", data: nativeCandle(now) });
    const stale = service.velaFeed.loadRange!({ symbol: "HL:BTC", timeframe: "1m" }, { from: anchor });
    service.start(["HL:BTC"], "auto", ["HL:ETH"]); socket().open();
    finish(new Response(JSON.stringify(body)));
    await expect(stale).rejects.toThrow("connection changed");
    expect(store.getState().feedEpoch).toBe(epoch);
    expect(delivered).toHaveBeenCalledTimes(1);
    expect(service.barsFor("HL:BTC", "1m")).toEqual([]);
    delayed = false;
    socket().receive({ channel: "candle", data: nativeCandle(now, 5, 5) });
    await vi.advanceTimersByTimeAsync(2500);
    expect(delivered.mock.calls.at(-1)?.[0].volume).toBe(5);
    expect(store.getState().candleRecoveries["HL:BTC:1m"]).toBeUndefined();
    service.stop();
  });

  it("keeps recovery unavailable when the provider cannot return the interrupted anchor", async () => {
    const { service, store, socket } = await setup();
    const now = Math.floor(Date.now() / 60000) * 60000, anchor = now - 180000;
    service.subscribe("HL:BTC", "1m", () => {}); socket().open();
    const priorFetch = fetch;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => String(url).includes("kind=candles")
      ? Promise.resolve(new Response(JSON.stringify({ candles: [1, 2, 3].map(index => nativeCandle(anchor + index * 60000)) })))
      : priorFetch(url, init)));
    socket().receive({ channel: "candle", data: nativeCandle(anchor) });
    socket().receive({ channel: "candle", data: nativeCandle(now) });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().candleRecoveries["HL:BTC:1m"].status).toBe("unavailable");
    expect(service.barsFor("HL:BTC", "1m")).toEqual([]);
    service.stop();
  });

  it("retries a failed candle repair while withholding incomplete technical history", async () => {
    const { service, store, socket } = await setup();
    const now = Math.floor(Date.now() / 60000) * 60000, anchor = now - 180000;
    const delivered = vi.fn(), closes = vi.fn();
    service.subscribe("HL:BTC", "1m", delivered); service.onClose(closes); socket().open();
    const priorFetch = fetch;
    let failures = true;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => String(url).includes("kind=candles")
      ? Promise.resolve(failures ? new Response(JSON.stringify({ error: "Temporarily offline" }), { status: 503 })
        : new Response(JSON.stringify({ candles: [0, 1, 2, 3].map(i => nativeCandle(anchor + i * 60000)) })))
      : priorFetch(url, init)));
    socket().receive({ channel: "candle", data: nativeCandle(anchor) });
    socket().receive({ channel: "candle", data: nativeCandle(now) });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().candleRecoveries["HL:BTC:1m"].status).toBe("retrying");
    expect(service.barsFor("HL:BTC", "1m")).toEqual([]);
    expect(delivered).toHaveBeenCalledTimes(1);
    failures = false;
    await vi.advanceTimersByTimeAsync(2500);
    expect(service.barsFor("HL:BTC", "1m")).toHaveLength(4);
    expect(store.getState().candleRecoveries["HL:BTC:1m"]).toBeUndefined();
    expect(closes).not.toHaveBeenCalled();
    service.stop();
  });

  it("does not publish a completed repair into a new feed generation", async () => {
    const { service, store, socket } = await setup();
    const now = Math.floor(Date.now() / 60000) * 60000, anchor = now - 180000;
    service.subscribe("HL:BTC", "1m", () => {}); socket().open();
    const priorFetch = fetch;
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => String(url).includes("kind=candles")
      ? new Promise<Response>(resolve => { finish = resolve; }) : priorFetch(url, init)));
    socket().receive({ channel: "candle", data: nativeCandle(anchor) });
    socket().receive({ channel: "candle", data: nativeCandle(now) });
    const staleRepair = service.velaFeed.loadRange!({ symbol: "HL:BTC", timeframe: "1m" }, { from: anchor });
    service.start(["HL:BTC"], "simulation");
    finish(new Response(JSON.stringify({ candles: [-1, 0, 1, 2, 3].map(i => nativeCandle(anchor + i * 60000)) })));
    await expect(staleRepair).rejects.toThrow("connection changed");
    expect(store.getState().candles).toEqual([]);
    expect(store.getState().candleRecoveries).toEqual({});
    service.stop();
  });

  it("reports a recovery beyond venue retention without retrying forever or fabricating history", async () => {
    const { service, store, socket } = await setup();
    const now = Math.floor(Date.now() / 60000) * 60000, anchor = now - 5001 * 60000;
    service.subscribe("HL:BTC", "1m", () => {}); socket().open();
    const fetcher = vi.mocked(fetch);
    socket().receive({ channel: "candle", data: nativeCandle(anchor) });
    socket().receive({ channel: "candle", data: nativeCandle(now) });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().candleRecoveries["HL:BTC:1m"].status).toBe("unavailable");
    expect(service.barsFor("HL:BTC", "1m")).toEqual([]);
    await expect(service.history("HL:BTC", "1m", 20)).rejects.toThrow("unavailable");
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("kind=candles"))).toHaveLength(0);
    service.stop();
  });
  it("subscribes to each requested native series once and restores it after reconnect", async () => {
    const { service, socket } = await setup();
    const off = service.subscribe("HL:BTC", "1D", () => {});
    const first = socket();
    first.open();
    service.subscribe("HL:BTC", "1D", () => {})();
    expect(first.sent.map(item => JSON.parse(item).subscription).filter(item => item.type === "candle"))
      .toEqual([{ type: "candle", coin: "BTC", interval: "1d" }]);
    first.close();
    await vi.advanceTimersByTimeAsync(2000);
    socket().open();
    expect(socket().sent.map(item => JSON.parse(item).subscription).filter(item => item.type === "candle"))
      .toEqual([{ type: "candle", coin: "BTC", interval: "1d" }]);
    off(); service.stop();
  });

  it("delivers native buckets once, keeps trade volume separate and closes only confirmed bars", async () => {
    const { service, store, socket } = await setup();
    const base = Math.floor(Date.now() / 60000) * 60000;
    const bars = vi.fn(), closes = vi.fn();
    service.subscribe("HL:BTC", "1m", bars); service.onClose(closes);
    store.getState().set({ timeframe: "1m" });
    socket().open();
    const row = { s: "BTC", i: "1m", t: base, T: base + 59999, o: "100", h: "110", l: "90", c: "105", v: "20", n: 10 };
    socket().receive({ channel: "candle", data: row });
    socket().receive({ channel: "candle", data: [row, row] });
    socket().receive({ channel: "trades", data: [trade(1001)] });
    await vi.advanceTimersByTimeAsync(50);
    expect(bars).toHaveBeenCalledTimes(1);
    expect(store.getState().candles[0]).toMatchObject({ open: 100, close: 105, volume: 20 });
    expect(service.tradesFor("HL:BTC")).toHaveLength(1);
    socket().receive({ channel: "candle", data: { ...row, n: 9, v: "19" } });
    socket().receive({ channel: "candle", data: { ...row, s: "ETH" } });
    socket().receive({ channel: "candle", data: { ...row, v: "NaN" } });
    expect(bars).toHaveBeenCalledTimes(1);
    const next = { ...row, t: base + 60000, T: base + 119999, n: 1, v: "1" };
    // A batch may carry the old bucket's final revision after the new one.
    socket().receive({ channel: "candle", data: [next, { ...row, n: 11, v: "21" }] });
    socket().receive({ channel: "candle", data: next });
    expect(closes).toHaveBeenCalledTimes(1);
    expect(closes.mock.calls[0]).toMatchObject(["HL:BTC", "1m", { time: base, volume: 21 }, false]);
    expect(store.getState().candles).toHaveLength(2);
    service.stop();
  });

  it("fences a superseded socket during same-generation watchlist refresh", async () => {
    const { service, store, socket } = await setup();
    const base = Math.floor(Date.now() / 60000) * 60000;
    service.subscribe("HL:BTC", "1m", () => {});
    const previous = socket(); previous.open();
    const staleMessage = previous.onmessage!, staleClose = previous.onclose!;
    service.start(["HL:BTC"], "auto", ["HL:ETH"]);
    socket().open();
    socket().receive({ channel: "candle", data: { s: "BTC", i: "1m", t: base, T: base + 59999,
      o: "100", h: "110", l: "90", c: "105", v: "20", n: 10 } });
    staleMessage({ data: JSON.stringify({ channel: "candle", data: { s: "BTC", i: "1m", t: base, T: base + 59999,
      o: "100", h: "200", l: "90", c: "200", v: "100", n: 100 } }) });
    staleClose();
    expect(service.barsFor("HL:BTC", "1m")[0].close).toBe(105);
    expect(store.getState().feedStatus).toBe("live");
    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeSocket.instances).toHaveLength(2);
    service.stop();
  });

  it("watches heartbeat traffic and does not label a disconnected metadata poll as live", async () => {
    const { service, store, socket } = await setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().feedStatus).toBe("connecting");
    const previous = socket(); previous.open();
    await vi.advanceTimersByTimeAsync(30100);
    expect(previous.sent.some(item => JSON.parse(item).method === "ping")).toBe(true);
    previous.receive({ channel: "pong" });
    await vi.advanceTimersByTimeAsync(20000);
    expect(previous.readyState).toBe(FakeSocket.OPEN);
    await vi.advanceTimersByTimeAsync(26000);
    expect(previous.readyState).toBe(3);
    expect(store.getState().feedStatus).toBe("reconnecting");
    expect(Object.values(store.getState().quotes).every(quote => !quote.simulated)).toBe(true);
    service.stop();
  });

  it("retries a socket that never completes its connection handshake", async () => {
    const { service, socket, store } = await setup();
    const previous = socket();
    await vi.advanceTimersByTimeAsync(18000);
    expect(previous.readyState).toBe(3);
    expect(FakeSocket.instances.length).toBeGreaterThan(1);
    expect(store.getState().feedStatus).toBe("reconnecting");
    service.stop();
  });
  it("keeps full provider OHLCV when live trades precede the history response", async () => {
    const { service, store, socket } = await setup();
    const base = Math.floor(Date.now() / 60000) * 60000;
    let resolveHistory!: (response: Response) => void;
    const previousFetch = fetch;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => String(url).includes("kind=candles")
      ? new Promise<Response>(resolve => { resolveHistory = resolve; }) : previousFetch(url, init)));
    store.getState().set({ timeframe: "1m" });
    socket().open();
    const loading = service.history("HL:BTC", "1m", 2);
    socket().receive({ channel: "trades", data: [{ ...trade(100), time: base + 10000, px: "110" }] });
    await vi.advanceTimersByTimeAsync(50);
    expect(service.barsFor("HL:BTC", "1m")).toEqual([]);
    resolveHistory(new Response(JSON.stringify({ candles: [
      { t: base - 60000, T: base - 1, o: "99", h: "102", l: "98", c: "101", v: "100" },
      { t: base, T: base + 59999, o: "101", h: "120", l: "90", c: "108", v: "200" },
    ] }), { status: 200 }));
    const bars = await loading;
    expect(bars.at(-1)).toMatchObject({ open: 101, high: 120, low: 90, close: 108, volume: 200 });
    expect(store.getState().candles.at(-1)).toEqual(bars.at(-1));
    socket().receive({ channel: "trades", data: [{ ...trade(101), time: base + 20000, px: "111" }] });
    await vi.advanceTimersByTimeAsync(50);
    expect(service.barsFor("HL:BTC", "1m").at(-1)).toMatchObject({ close: 108, volume: 200 });
    socket().receive({ channel: "candle", data: { s: "BTC", i: "1m", t: base, T: base + 59999,
      o: "101", h: "120", l: "90", c: "111", v: "200.5", n: 201 } });
    expect(service.barsFor("HL:BTC", "1m").at(-1)).toMatchObject({ open: 101, high: 120, low: 90, close: 111, volume: 200.5 });
    service.stop();
  });

  it("preserves a new live bucket beyond the last returned historical candle", async () => {
    const { service, socket } = await setup();
    const base = Math.floor(Date.now() / 60000) * 60000;
    let resolveHistory!: (response: Response) => void;
    const previousFetch = fetch;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => String(url).includes("kind=candles")
      ? new Promise<Response>(resolve => { resolveHistory = resolve; }) : previousFetch(url, init)));
    socket().open();
    const loading = service.history("HL:BTC", "1m", 2);
    socket().receive({ channel: "trades", data: [{ ...trade(102), time: base + 60010, px: "112" }] });
    await vi.advanceTimersByTimeAsync(50);
    socket().receive({ channel: "candle", data: { s: "BTC", i: "1m", t: base + 60000, T: base + 119999,
      o: "112", h: "112", l: "112", c: "112", v: "0.5", n: 1 } });
    resolveHistory(new Response(JSON.stringify({ candles: [
      { t: base - 60000, T: base - 1, o: "99", h: "102", l: "98", c: "101", v: "100" },
      { t: base, T: base + 59999, o: "101", h: "120", l: "90", c: "108", v: "200" },
    ] }), { status: 200 }));
    const bars = await loading;
    expect(bars.map(bar => bar.time)).toEqual([base - 60000, base, base + 60000]);
    expect(bars.at(-1)).toMatchObject({ open: 112, close: 112, volume: .5 });
    service.stop();
  });
  it("delivers subscribed background books to paper observers without replacing the main chart book",async()=>{
    const {service,store,socket}=await setup();service.start(["HL:BTC","HL:ETH"],"auto");socket().open();const observed:string[]=[];const off=service.onBook(book=>observed.push(book.symbol));
    socket().receive({channel:"l2Book",data:{coin:"ETH",time:Date.now(),levels:[[{px:"99",sz:"1"}],[{px:"101",sz:"1"}]]}});expect(observed).toEqual(["HL:ETH"]);expect(store.getState().orderBook).toBeNull();off();
    socket().receive({channel:"l2Book",data:{coin:"BTC",time:Date.now(),levels:[[{px:"99",sz:"1"}],[{px:"101",sz:"1"}]]}});expect(observed).toHaveLength(1);expect(store.getState().orderBook?.symbol).toBe("HL:BTC");service.stop();
  });
  it("subscribes to trades and depth for every charted market", async () => {
    const { service, socket } = await setup();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(socket().url).toBe("wss://api.hyperliquid.xyz/ws");
    socket().open();
    const subscriptions = socket().sent.map((m) => JSON.parse(m).subscription.type).sort();
    expect(subscriptions).toEqual(["activeAssetCtx", "allMids", "l2Book", "trades"]);
    service.stop();
  });

  it("folds a burst of trades into bars, quotes and the tape without losing or doubling any", async () => {
    const { service, store, socket } = await setup();
    socket().open();
    const burst = Array.from({ length: 80 }, (_, i) => trade(i, i % 3 === 0 ? "A" : "B"));
    socket().receive({ channel: "trades", data: burst });
    // Replaying the same message must not duplicate trades.
    socket().receive({ channel: "trades", data: burst.slice(0, 20) });
    await vi.advanceTimersByTimeAsync(500);
    const tape = service.tradesFor("HL:BTC");
    expect(tape).toHaveLength(80);
    expect(tape.filter((t) => t.side === "sell")).toHaveLength(27);
    expect(store.getState().quotes["HL:BTC"].price).toBe(100.5);
    expect(store.getState().feedStatus).toBe("live");
    service.stop();
  });

  it("publishes the order book only for the charted market", async () => {
    const { service, store, socket } = await setup();
    socket().open();
    socket().receive({ channel: "l2Book", data: { coin: "BTC", time: 5, levels: [[{ px: "100", sz: "2" }], [{ px: "101", sz: "3" }]] } });
    expect(store.getState().orderBook).toMatchObject({ symbol: "HL:BTC", bids: [{ price: 100, quantity: 2 }], asks: [{ price: 101, quantity: 3 }] });
    store.getState().set({ orderBook: null });
    socket().receive({ channel: "l2Book", data: { coin: "ETH", time: 5, levels: [[{ px: "9", sz: "1" }], [{ px: "10", sz: "1" }]] } });
    expect(store.getState().orderBook).toBeNull();
    service.stop();
  });

  it("ignores malformed messages and keeps working", async () => {
    const { service, socket, store } = await setup();
    socket().open();
    await vi.advanceTimersByTimeAsync(0);
    socket().receive({ channel: "allMids", data: { mids: { BTC: "100" } } });
    socket().receive({ channel: "l2Book", data: { coin: "BTC", time: 5,
      levels: [[{ px: "99", sz: "1" }], [{ px: "101", sz: "1" }]] } });
    const valid = store.getState();
    socket().onmessage?.({ data: "not json" });
    socket().receive({ channel: "allMids", data: { mids: { BTC: true } } });
    socket().receive({ channel: "activeAssetCtx", data: { coin: "BTC", ctx: { markPx: [350], prevDayPx: "95" } } });
    socket().receive({ channel: "l2Book", data: { coin: "BTC", time: 6,
      levels: [[{ px: "99", sz: "1" }, { px: "bad", sz: "1" }], [{ px: "101", sz: "1" }]] } });
    expect(store.getState().quotes["HL:BTC"]).toBe(valid.quotes["HL:BTC"]);
    expect(store.getState().orderBook).toBe(valid.orderBook);
    socket().receive({ channel: "trades", data: [null, { ...trade(500), time: 1.5 }, { ...trade(500), tid: -1 }, trade(500)] });
    await vi.advanceTimersByTimeAsync(100);
    expect(service.tradesFor("HL:BTC")).toMatchObject([{ seq: 500, time: trade(500).time }]);
    service.stop();
  });

  it("reconnects when malformed data is the only traffic after a valid heartbeat", async () => {
    const { service, socket } = await setup();
    const original = socket(); original.open();
    await vi.advanceTimersByTimeAsync(30_000);
    original.receive({ channel: "pong" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(original.readyState).toBe(FakeSocket.OPEN);
    for (let i = 0; i < 17; i++) {
      original.receive({ channel: "allMids", data: { mids: { BTC: true } } });
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(original.readyState).toBe(3);
    service.stop();
  });

  it("pings to keep the connection alive", async () => {
    const { service, socket } = await setup();
    socket().open();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(socket().sent.some((m) => JSON.parse(m).method === "ping")).toBe(true);
    service.stop();
  });

  it("reconnects with backoff after a dropped socket and resubscribes", async () => {
    const { service, socket } = await setup();
    socket().open();
    socket().close();
    expect(FakeSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeSocket.instances).toHaveLength(2);
    socket().open();
    expect(socket().sent).toHaveLength(4);
    // A second drop waits longer than the first.
    socket().close();
    await vi.advanceTimersByTimeAsync(900);
    expect(FakeSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(FakeSocket.instances).toHaveLength(3);
    service.stop();
  });

  it("stops reconnecting once the service is stopped", async () => {
    const { service, socket } = await setup();
    socket().open();
    service.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("polls quotes for markets that are only on a watchlist", async () => {
    const { MarketService } = await import("@/lib/market/service");
    const { useChartStore } = await import("@/stores/useChartStore");
    const service = new MarketService();
    service.start(["BTCUSDT"], "auto", ["HL:BTC"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(useChartStore.getState().quotes["HL:BTC"]).toMatchObject({ price: 100, change: 5 });
    const socket = FakeSocket.instances.find(s => s.url.includes("hyperliquid"))!;
    socket.open();
    expect(socket.sent.map(m => JSON.parse(m).subscription)).toEqual([{ type: "allMids", dex: "" }, { type: "trades", coin: "BTC" }]);
    socket.receive({ channel: "allMids", data: { mids: { BTC: "103", ETH: "999" } } });
    expect(useChartStore.getState().quotes["HL:BTC"]).toMatchObject({ price: 103, volume: 12, metrics: { volume: { base: 12, quote: 1000 } } });
    expect(useChartStore.getState().quotes["HL:ETH"]).toBeUndefined();
    service.stop();
  });

  it("keeps reported volumes separate and does not add the trade tape to a 24h snapshot", async () => {
    const { service, store, socket } = await setup();
    await vi.advanceTimersByTimeAsync(100);
    expect(store.getState().quotes["HL:BTC"]).toMatchObject({ volume: 12, high: 0, low: 0, metrics: { volume: { base: 12, quote: 1000 }, range: { high: null, low: null, complete: false } } });
    socket().open();
    socket().receive({ channel: "trades", data: [trade(1001)] });
    await vi.advanceTimersByTimeAsync(100);
    expect(store.getState().quotes["HL:BTC"]).toMatchObject({ volume: 12, high: 0, low: 0, metrics: { volume: { base: 12, quote: 1000 } } });
    socket().receive({ channel: "activeAssetCtx", data: { coin: "BTC", ctx: { markPx: "110", prevDayPx: "95", dayBaseVlm: "14", dayNtlVlm: "1350" } } });
    expect(store.getState().quotes["HL:BTC"]).toMatchObject({ price: 100.5, priceBasis: "trade", time: trade(1001).time, volume: 14, metrics: { volume: { base: 14, quote: 1350 } } });
    socket().receive({ channel: "activeAssetCtx", data: { coin: "BTC", ctx: { markPx: "111", prevDayPx: "95", dayNtlVlm: "1360" } } });
    expect(store.getState().quotes["HL:BTC"].metrics!.volume.base).toBeNull();
    expect(store.getState().quotes["HL:BTC"].metrics!.volume.quote).toBe(1360);
    service.stop();
  });

  it("coalesces day-window requests and preserves them when context and trades refresh", async () => {
    const { service, store, socket } = await setup();
    await vi.advanceTimersByTimeAsync(100);
    const to = Math.floor(Date.now() / 60_000) * 60_000;
    const range = { high: 120, low: 90, period: "24h", from: to - 86_400_000, to, resolution: "1m", complete: true, bars: 1440, expectedBars: 1440 };
    const fetcher = vi.mocked(fetch);
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ range })));
    await Promise.all([service.requestQuoteRange("HL:BTC"), service.requestQuoteRange("HL:BTC")]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("kind=range"))).toHaveLength(1);
    expect(store.getState().quotes["HL:BTC"]).toMatchObject({ high: 120, low: 90, metrics: { range } });
    socket().open();
    socket().receive({ channel: "activeAssetCtx", data: { coin: "BTC", ctx: { markPx: "110", prevDayPx: "95", dayBaseVlm: "14", dayNtlVlm: "1350" } } });
    socket().receive({ channel: "trades", data: [trade(2001)] });
    await vi.advanceTimersByTimeAsync(100);
    expect(store.getState().quotes["HL:BTC"]).toMatchObject({ high: 120, low: 90, metrics: { range } });
    service.stop();
  });

  it("subscribes once per builder dex while keeping case-sensitive coin names", async () => {
    const { MarketService } = await import("@/lib/market/service");
    const { useChartStore } = await import("@/stores/useChartStore");
    const service = new MarketService();
    service.start([], "auto", ["HL:xyz:TSLA", "HL:xyz:GOLD", "HL:kPEPE"]);
    const socket = FakeSocket.instances.at(-1)!;
    socket.open();
    expect(socket.sent.map(m => JSON.parse(m).subscription)).toEqual([{ type: "allMids", dex: "" }, { type: "allMids", dex: "xyz" }, { type: "trades", coin: "kPEPE" }, { type: "trades", coin: "xyz:GOLD" }, { type: "trades", coin: "xyz:TSLA" }]);
    socket.receive({ channel: "allMids", data: { mids: { "xyz:TSLA": "321", kPEPE: "0.002" } } });
    expect(useChartStore.getState().quotes["HL:xyz:TSLA"].price).toBe(321);
    expect(useChartStore.getState().quotes["HL:kPEPE"].price).toBe(0.002);
    service.stop();
  });
  it("publishes a large watchlist snapshot once and skips unchanged prices", async () => {
    const { MarketService } = await import("@/lib/market/service");
    const { useChartStore } = await import("@/stores/useChartStore");
    const service = new MarketService();
    const symbols = Array.from({ length: 1000 }, (_, i) => `HL:T${i}`);
    service.start([], "auto", symbols);
    const socket = FakeSocket.instances.at(-1)!; socket.open();
    const listener = vi.fn();
    const off = useChartStore.subscribe((state, previous) => { if (state.quotes !== previous.quotes) listener(); });
    const mids = Object.fromEntries(symbols.map((symbol, i) => [symbol.slice(3), String(i + 1)]));
    socket.receive({ channel: "allMids", data: { mids } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(Object.keys(useChartStore.getState().quotes)).toHaveLength(1000);
    socket.receive({ channel: "allMids", data: { mids } });
    expect(listener).toHaveBeenCalledTimes(1);
    off(); service.stop();
  });
  it("refreshes live quote subscriptions without clearing the active chart and tape", async () => {
    const { service, store, socket } = await setup();
    socket().open(); socket().receive({ channel: "trades", data: [trade(3001)] });
    await vi.advanceTimersByTimeAsync(100);
    const epoch = store.getState().feedEpoch, tape = service.tradesFor("HL:BTC"), oldSocket = socket();
    service.start(["HL:BTC"], "auto", ["HL:xyz:TSLA"]);
    expect(oldSocket.readyState).toBe(3);
    expect(store.getState().feedEpoch).toBe(epoch);
    expect(service.tradesFor("HL:BTC")).toBe(tape);
    socket().open();
    expect(socket().sent.map(m => JSON.parse(m).subscription).filter(s => s.type === "allMids")).toEqual([{ type: "allMids", dex: "" }, { type: "allMids", dex: "xyz" }]);
    socket().receive({ channel: "allMids", data: { mids: { "xyz:TSLA": "400" } } });
    expect(store.getState().quotes["HL:xyz:TSLA"].price).toBe(400);
    service.stop();
  });
});
