import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { MarketService } from "@/lib/market/service";
import { useChartStore } from "@/stores/useChartStore";
class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  message(data: unknown, stream = "btcusdt@aggTrade") {
    this.onmessage?.({ data: JSON.stringify({ stream, data }) });
  }
}
describe("market lifecycle and source isolation", () => {
  it("preserves loaded candles and the feed epoch when a watchlist adds quote-only symbols", async () => {
    service.start(["BTCUSDT"], "simulation");
    const loaded = await service.history("BTCUSDT", "1m", 600);
    const epoch = useChartStore.getState().feedEpoch;
    service.start(["BTCUSDT"], "simulation", ["ETHUSDT"]);
    expect(useChartStore.getState().feedEpoch).toBe(epoch);
    expect(useChartStore.getState().candles).toBe(loaded);
    expect(service.barsFor("BTCUSDT", "1m")).toHaveLength(600);
    await vi.advanceTimersByTimeAsync(1000);
    expect(useChartStore.getState().quotes.ETHUSDT.simulated).toBe(true);
  });
  it("uses Binance reported turnover and preserves the snapshot while trades arrive", () => {
    service.start(["BTCUSDT"], "auto");
    const socket = FakeSocket.instances[0]; socket.open();
    socket.message({ e: "24hrMiniTicker", s: "BTCUSDT", c: "100", o: "95", h: "110", l: "90", v: "12", q: "1000" }, "btcusdt@miniTicker");
    socket.message({ e: "aggTrade", s: "BTCUSDT", a: 123, T: Date.now(), p: "101", q: "0.5", m: false });
    expect(useChartStore.getState().quotes.BTCUSDT).toMatchObject({ price: 101, volume: 12, high: 110, low: 90, metrics: { volume: { base: 12, quote: 1000, period: "24h" } } });
  });
  it("discards malformed Binance messages without replacing valid state or consuming trade IDs", () => {
    service.start(["BTCUSDT"], "auto");
    const socket = FakeSocket.instances[0]; socket.open();
    const valid = { e: "aggTrade", s: "BTCUSDT", a: 30, T: Date.now(), p: "100", q: "2", m: false };
    const ticker = { e: "24hrMiniTicker", s: "BTCUSDT", c: "99", o: "95", h: "110", l: "90", v: "12" };
    socket.message(ticker, "btcusdt@miniTicker");
    socket.message({ bids: [["98", "1"]], asks: [["102", "2"]] }, "btcusdt@depth10");
    const before = useChartStore.getState();
    socket.onmessage?.({ data: "{" });
    socket.message(null);
    socket.message({ ...valid, p: "Infinity" });
    socket.message({ ...valid, m: "false" });
    socket.message({ ...valid, s: "ETHUSDT" });
    socket.message({ ...ticker, c: null }, "btcusdt@miniTicker");
    socket.message({ bids: [["103", "1"]], asks: [["102", "2"]] }, "btcusdt@depth10");
    expect(useChartStore.getState().chartError).toBe(before.chartError);
    expect(useChartStore.getState().quotes.BTCUSDT).toBe(before.quotes.BTCUSDT);
    expect(useChartStore.getState().orderBook).toBe(before.orderBook);
    expect(service.tradesFor("BTCUSDT")).toHaveLength(0);
    socket.message(valid);
    expect(service.tradesFor("BTCUSDT")).toMatchObject([{ seq: 30, price: 100, quantity: 2, side: "buy" }]);
  });
  it("restores selected candle state when a pane reuses cached history", async () => {
    service.start(["BTCUSDT"], "simulation");
    await service.history("BTCUSDT", "1m", 10);
    useChartStore.getState().set({ candles: [] });
    const cached = await service.history("BTCUSDT", "1m", 10);
    expect(cached).toHaveLength(10);
    expect(useChartStore.getState().candles).toHaveLength(10);
  });
  it("invalidates simulated history when an actual ticker arrives without a trade", async () => {
    service.start(["BTCUSDT"], "auto");
    await vi.advanceTimersByTimeAsync(8501);
    const before = useChartStore.getState().marketEpochs.BTCUSDT ?? 0;
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.message(
      {
        e: "24hrMiniTicker",
        s: "BTCUSDT",
        c: "90000",
        o: "89000",
        h: "91000",
        l: "88000",
        v: "100",
      },
      "btcusdt@miniTicker",
    );
    expect(useChartStore.getState().marketEpochs.BTCUSDT).toBeGreaterThan(
      before,
    );
    expect(service.tradesFor("BTCUSDT")).toEqual([]);
    expect(useChartStore.getState().quotes.BTCUSDT.history).toEqual([90000]);
    expect(await service.history("BTCUSDT", "1m", 600)).toEqual([]);
  });
  it("keeps classified trades in separate symbol streams", async () => {
    service.start(["BTCUSDT", "ETHUSDT"], "auto");
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.message({
      e: "aggTrade",
      s: "BTCUSDT",
      a: 1,
      T: Date.now(),
      p: "90000",
      q: "1",
      m: false,
    });
    socket.message(
      {
        e: "aggTrade",
        s: "ETHUSDT",
        a: 1,
        T: Date.now(),
        p: "3000",
        q: "4",
        m: true,
      },
      "ethusdt@aggTrade",
    );
    expect(service.tradesFor("BTCUSDT")).toHaveLength(1);
    expect(service.tradesFor("ETHUSDT")[0].side).toBe("sell");
    expect(service.tradesFor("SOLUSDT")).toEqual([]);
  });
  let service: MarketService;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000000);
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    FakeSocket.instances = [];
    useChartStore.setState({
      symbol: "BTCUSDT",
      timeframe: "1m",
      quotes: {},
      trades: [],
      candles: [],
      feedEpoch: 0,
    });
    service = new MarketService();
  });
  afterEach(() => {
    service.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("simulates offline and releases every timer on stop", async () => {
    service.start(["BTCUSDT"], "simulation");
    await vi.advanceTimersByTimeAsync(701);
    expect(useChartStore.getState().quotes.BTCUSDT.simulated).toBe(true);
    expect(useChartStore.getState().trades).toHaveLength(1);
    service.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(useChartStore.getState().trades).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("publishes one screen tape per frame and delivers every raw trade immediately", () => {
    let pending: FrameRequestCallback | undefined;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => { pending = callback; return 56; });
    const cancelFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    const onTrade = vi.fn();
    const off = service.onTick(onTrade);
    service.start(["BTCUSDT"], "auto");
    const socket = FakeSocket.instances[0]; socket.open();
    const trade = { e: "aggTrade", s: "BTCUSDT", T: Date.now(), p: "100", q: "2", m: false };
    try {
      for (let id = 1; id <= 100; id++) socket.message({ ...trade, a: id });
      expect(onTrade).toHaveBeenCalledTimes(100);
      expect(requestFrame).toHaveBeenCalledOnce();
      expect(useChartStore.getState().trades).toEqual([]);
      const beforeFrame = service.tradesFor("BTCUSDT");
      expect(beforeFrame.map(t => t.seq)).toEqual(Array.from({ length: 100 }, (_, index) => 100 - index));
      pending?.(0);
      expect(useChartStore.getState().trades).toBe(beforeFrame);

      socket.message({ ...trade, a: 101 });
      expect(beforeFrame[0].seq).toBe(100);
      expect(service.tradesFor("BTCUSDT")[0].seq).toBe(101);
      service.start(["BTCUSDT"], "simulation");
      expect(cancelFrame).toHaveBeenCalledWith(56);
      pending?.(0);
      expect(useChartStore.getState().trades).toEqual([]);
    } finally {
      off();
    }
  });
  it("reconnects with backoff and deduplicates trade IDs", async () => {
    service.start(["BTCUSDT"], "auto");
    const socket = FakeSocket.instances[0];
    socket.open();
    const d = {
      e: "aggTrade",
      s: "BTCUSDT",
      a: 4,
      T: Date.now(),
      p: "100",
      q: "2",
      m: false,
    };
    socket.message(d);
    socket.message(d);
    expect(useChartStore.getState().trades).toHaveLength(1);
    expect(useChartStore.getState().trades[0].side).toBe("buy");
    socket.close();
    await vi.advanceTimersByTimeAsync(1600);
    expect(FakeSocket.instances).toHaveLength(2);
  });
  it("clears simulated order flow when actual exchange trades arrive", async () => {
    service.start(["BTCUSDT"], "auto");
    await vi.advanceTimersByTimeAsync(8501);
    const epoch = useChartStore.getState().feedEpoch;
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.message({
      e: "aggTrade",
      s: "BTCUSDT",
      a: 5,
      T: Date.now(),
      p: "90000",
      q: "1",
      m: true,
    });
    const state = useChartStore.getState();
    expect(state.trades).toHaveLength(1);
    expect(state.trades[0].simulated).toBe(false);
    expect(state.feedEpoch).toBeGreaterThan(epoch);
    expect(state.quotes.BTCUSDT.price).toBe(90000);
    expect(state.feedStatus).toBe("live");
  });
  it("waits for the connection grace period before generating fallback data", async () => {
    service.start(["BTCUSDT"], "auto");
    await vi.advanceTimersByTimeAsync(7000);
    expect(useChartStore.getState().trades).toEqual([]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(useChartStore.getState().quotes.BTCUSDT.simulated).toBe(true);
  });
  it("does not invent trades for a quiet symbol while the exchange socket is healthy", async () => {
    service.start(["BTCUSDT", "ETHUSDT"], "auto");
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.message({
      e: "aggTrade",
      s: "BTCUSDT",
      a: 1,
      T: Date.now(),
      p: "90000",
      q: "1",
      m: false,
    });
    for (let i = 0; i < 15; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      socket.message({ bids: [], asks: [] }, "ethusdt@depth10");
    }
    expect(useChartStore.getState().trades).toHaveLength(1);
    expect(useChartStore.getState().quotes.BTCUSDT.simulated).toBe(false);
  });
  it("uses collected actual bars when historical REST is unavailable", async () => {
    service.start(["BTCUSDT"], "auto");
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.message({
      e: "aggTrade",
      s: "BTCUSDT",
      a: 6,
      T: Date.now(),
      p: "90000",
      q: "1",
      m: false,
    });
    const bars = await service.history("BTCUSDT", "1m", 600);
    expect(bars).toHaveLength(1);
    expect(bars[0].close).toBe(90000);
  });
  it("subscribes to all seven intervals and emits a closed candle once", async () => {
    service.start(["BTCUSDT"], "simulation");
    const close = vi.fn();
    const bars = vi.fn();
    service.onClose(close);
    const off = service.subscribe("BTCUSDT", "1s", bars);
    await vi.advanceTimersByTimeAsync(2101);
    expect(bars).toHaveBeenCalledTimes(3);
    expect(close.mock.calls.filter((c) => c[1] === "1s")).toHaveLength(2);
    off();
    await vi.advanceTimersByTimeAsync(700);
    expect(bars).toHaveBeenCalledTimes(3);
  });
});
