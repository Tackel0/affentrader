"use client";
import { binanceDepth, binanceTicker, binanceTrade } from "./binanceStream";
import { parseWireObject, wireDecimal, wireObject } from "./marketWire";
import { clearMarketSessions, registerMarketSessions } from "./sessionWindows";
import { KRAKEN_NATIVES, loadKrakenClosedBars, loadKrakenRecentTrades, loadKrakenTradingIncrements, subscribeKrakenTrades } from "./kraken";
import type { MarketDataFeed } from "@luxalgo/vela";
import type {
  FeedMode,
  OHLCV,
  OrderBook,
  Quote,
  QuoteMetrics,
  QuoteRange,
  Tick,
  Timeframe,
} from "@/types/trading";
import { getSymbol, TIMEFRAMES } from "@/lib/symbols";
import {
  aggregateTick,
  aggregateTickBars,
  barsFromTrades,
  tickCount,
  TICK_BAR_SPACING,
  type TickBarState,
} from "./aggregation";
import { generateHistory, generateTick } from "./mock";
import { bucketStart, isTickInterval, nextBucket, normalizeInterval, planSource } from "./intervals";
import { candleRecoveryPlan, mergeRecoveredCandles, RecoveryUnavailableError } from "./candleRecovery";
import { hyperliquidQuoteTradeSymbols, mergeHyperliquidQuote, type HyperliquidPriceBasis } from "./hyperliquidQuotes";
import {
  providerOf,
  registerSymbolInfo,
  symbolInfo,
  tickerOf,
} from "@/lib/symbolId";
import { loadYahooBars, yahooQuotes } from "./yahooClient";
import { loadHyperliquidAssets, loadHyperliquidBars } from "./hyperliquidClient";
import { HYPERLIQUID_NATIVES, parseBook, parseTrade, priceTick } from "./hyperliquid";
import { HyperliquidCandleSeries, parseHyperliquidCandle, type HyperliquidCandle } from "./hyperliquidCandles";
import { HyperliquidChannelHealth, hyperliquidStreamBehind } from "./hyperliquidHealth";
import { basicMetrics, nonnegative, pendingRange } from "./quoteMetrics";
import {
  browserKlinePager,
  browserTradePager,
  loadKlines,
  loadTickBars,
  loadTradeBackfill,
  MAX_HISTORY_BARS,
} from "./klines";
import { useChartStore } from "@/stores/useChartStore";
import { useAlpacaStore } from "@/stores/useAlpacaStore";
import { alpacaCredentials } from "@/stores/useAlpacaStore";
import { IexStream, iexHistoryPlan, loadIexBars } from "./alpacaClient";
import { IexCandles, mergeIexSeries } from "./iexCandles";
import type { IexBar, IexTrade } from "./alpaca";
type BarListener = (bar: OHLCV) => void;
type KrakenTickGap = {
  symbol: string;
  timeframe: Timeframe;
  from: number;
  through: number;
  liveFrom?: number;
  retryAt: number;
  unavailable: boolean;
};
type CloseListener = (
  symbol: string,
  timeframe: Timeframe,
  bar: OHLCV,
  simulated: boolean,
) => void;
/** Above this many quote-only symbols one all-market ticker stream is cheaper. */
const INDIVIDUAL_TICKER_LIMIT = 150;
export class MarketService {
  private iexStream: IexStream | null = null;
  private iexEpoch = -1;
  private iexConnection = 0;
  private iexBases = new Map<string, IexCandles>();
  private iexReady = new Set<string>();
  private sipPollAt = 0;
  private sipPoll: Promise<void> | undefined;
  private iexDelivered = new Map<string, OHLCV>();
  private iexClosed = new Map<string, number>();
  private candleListeners = new Set<(symbol: string) => void>();
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private running = false;
  private attempts = 0;
  private mode: FeedMode = "auto";
  private symbols: string[] = [];
  private quoteSymbols: string[] = [];
  private quotePriority: string[] = [];
  private live = new Map<string, number>();
  private histories = new Map<string, OHLCV[]>();
  private pending = new Map<string, Promise<OHLCV[]>>();
  private barListeners = new Map<string, Set<BarListener>>();
  private bookListeners = new Set<(book:OrderBook)=>void>();
  private tickListeners = new Set<(tick: Tick) => void>();
  private quoteListeners = new Set<(quote: Quote) => void>();
  private failedConsumers = new WeakSet<(...args: never[]) => unknown>();
  /** One faulty consumer must not prevent later consumers or future data delivery. */
  private publish<Args extends unknown[]>(channel: string, listeners: ReadonlySet<(...args: Args) => void> | undefined, ...args: Args): boolean {
    const epoch = this.generation;
    for (const listener of [...(listeners ?? [])]) {
      if (epoch !== this.generation) return false;
      if (!listeners?.has(listener)) continue;
      try { listener(...args); this.failedConsumers.delete(listener); }
      catch (error) {
        if (!this.failedConsumers.has(listener)) {
          this.failedConsumers.add(listener);
          console.error(`Market ${channel} subscriber failed`, error);
        }
      }
    }
    return epoch === this.generation;
  }
  private quoteBatch: Record<string, Quote> | null = null;
  private batchedEvents: Quote[] = [];
  private batchQuotes(work: () => void) {
    const epoch = this.generation;
    this.quoteBatch = { ...useChartStore.getState().quotes };
    this.batchedEvents = [];
    try { work(); } finally {
      const quotes = this.quoteBatch, events = this.batchedEvents;
      this.quoteBatch = null;
      this.batchedEvents = [];
      if (epoch === this.generation && events.length) {
        useChartStore.getState().set({ quotes });
        for (const quote of events) {
          // Store subscriptions run synchronously and may replace this feed.
          if (epoch !== this.generation || !this.publish("quote", this.quoteListeners, quote)) break;
        }
      }
    }
  }
  private closeListeners = new Set<CloseListener>();
  private seen = new Map<string, number>();
  private lastTraffic = 0;
  private hlLastTraffic = 0;
  private hlConnectAt = 0;
  private hlChannelHealth = new HyperliquidChannelHealth();
  private hlChannelProbes = new Map<string, Promise<void>>();
  private hlCandleSeries = new Map<string, { symbol: string; timeframe: string; api: string; series: HyperliquidCandleSeries }>();
  private hlCandleSent = new Set<string>();
  private hlGaps = new Map<string, { from: number; attempts: number; retryAt: number; unavailable: boolean }>();
  private hlRecovery = new Map<string, Promise<OHLCV[]>>();
  private hlAwaitingCandles = new Set<string>();
  private hlRepairPublication = new Map<string, { from: number; bars: OHLCV[] }>();
  private liveHistory = new Set<string>();
  private historySources = new Map<string, boolean>();
  private startedAt = 0;
  private tradesBySymbol = new Map<string, Tick[]>();
  /** Custom time intervals that are aggregated alongside the presets. */
  private extraFrames = new Set<string>();
  /** Tick intervals (`100T`) being aggregated from the trade stream. */
  private tickFrames = new Set<string>();
  private tickStates = new Map<string, TickBarState>();
  /** Lowest complete trade group kept for each tick series, for paging back. */
  private tickFirstGroup = new Map<string, number>();
  /** Ticks that arrived while a tick history request was in flight. */
  private tickBuffer = new Map<string, Tick[]>();
  private simSeq = new Map<string, number>();
  private simulationSeeds=new Map<string,number>();
  private simulationSeed(symbol:string):number {
    const known=this.simulationSeeds.get(symbol);if(known!==undefined)return known;
    let saved:unknown;
    try {saved=JSON.parse(sessionStorage.getItem("affentrader-simulation-seeds-v1")??"{}")[symbol];}catch{}
    const candidates=[useChartStore.getState().quotes[symbol]?.price,this.hlMarks.get(symbol),saved,getSymbol(symbol).seedPrice];
    const seed=candidates.find((value):value is number=>typeof value==="number"&&Number.isFinite(value)&&value>0)??1;
    this.simulationSeeds.set(symbol,seed);this.saveSimulationSeeds();return seed;
  }
  private saveSimulationSeeds(){try{sessionStorage.setItem("affentrader-simulation-seeds-v1",JSON.stringify(Object.fromEntries([...this.simulationSeeds].slice(-2048))));}catch{}}
  private syntheticHistory(symbol:string,timeframe:Timeframe,count:number,end=Date.now()){
    const ticks=isTickInterval(timeframe),bars=generateHistory(symbol,ticks?"1m":timeframe,count,end,this.simulationSeed(symbol));
    const anchor=Math.floor(end/TICK_BAR_SPACING)*TICK_BAR_SPACING;
    return ticks?bars.map((bar,i)=>({...bar,time:anchor-(bars.length-1-i)*TICK_BAR_SPACING})):bars;
  }
  private krakenTickSizes = new Map<string, number>();
  private krakenTickThrough = new Map<string, number>();
  private krakenTickGaps = new Map<string, KrakenTickGap>();
  private krakenSilentTickClose = new Map<string, number>();
  private krakenRecent = new Map<string, Promise<Awaited<ReturnType<typeof loadKrakenRecentTrades>>>>();
  private krakenClosedThrough = new Map<string, number>();
  private krakenConnection = 0;
  private krakenLiveFrom = new Map<string, number>();
  private krakenGaps = new Map<string, { symbol: string; timeframe: string; from: number; target: number; retryAt: number; attempts: number; unavailable: boolean }>();
  private krakenRecovery = new Map<string, Promise<OHLCV[]>>();
  private stopKraken?: () => void;
  private krakenFailures = 0;
  private krakenRetry?: ReturnType<typeof setTimeout>;
  private yahooTimer: ReturnType<typeof setInterval> | null = null;
  private yahooSeen = new Map<string, string>();
  private hlSocket: WebSocket | null = null;
  private hlRetry: ReturnType<typeof setTimeout> | null = null;
  private hlPing: ReturnType<typeof setInterval> | null = null;
  private hlQuoteTimer: ReturnType<typeof setInterval> | null = null;
  private hlAttempts = 0;
  /** Price-tick size per Hyperliquid market, for chart axes. */
  private hlSzDecimals = new Map<string, number>();
  private hlMarks = new Map<string, number>();
  private rangeRequests = new Map<string, Promise<void>>();
  private rangeRequestedAt = new Map<string, number>();
  /** Fetch a verified day window only for markets whose range is being used. */
  async requestQuoteRange(symbol: string): Promise<void> {
    if (this.mode === "simulation" || providerOf(symbol) !== "hyperliquid") return;
    const pending = this.rangeRequests.get(symbol);
    if (pending) return pending;
    const now = Date.now(), epoch = this.generation;
    if (now - (this.rangeRequestedAt.get(symbol) ?? 0) < 60_000) return;
    this.rangeRequestedAt.set(symbol, now);
    const task = (async () => {
      try {
        const response = await fetch(`/api/hyperliquid?kind=range&coin=${encodeURIComponent(tickerOf(symbol))}`, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) return;
        const { range } = await response.json() as { range: QuoteRange };
        if (epoch !== this.generation || !range || range.resolution !== "1m" || !Number.isFinite(range.to)) return;
        const quote = useChartStore.getState().quotes[symbol];
        if (!quote?.metrics || quote.simulated || range.to < quote.metrics.range.to && quote.metrics.range.resolution === "1m") return;
        const next = { ...quote, high: range.high ?? 0, low: range.low ?? 0, metrics: { ...quote.metrics, range } };
        useChartStore.getState().set({ quotes: { ...useChartStore.getState().quotes, [symbol]: next } });
        this.publish("quote", this.quoteListeners, next);
      } catch {
        // Leave unavailable ranges unavailable; the next refresh retries.
      }
    })();
    this.rangeRequests.set(symbol, task);
    try { await task; } finally { this.rangeRequests.delete(symbol); }
  }
  /** Trades waiting to be folded in; a burst is spread over macrotasks so the UI can render in between. */
  private hlQueue: Tick[] = [];
  private hlDraining = false;
  private hlDrainTimer: ReturnType<typeof setTimeout> | undefined;
  private scheduleHyperliquidDrain(epoch: number) {
    this.hlDrainTimer = setTimeout(() => {
      this.hlDrainTimer = undefined;
      this.drainHyperliquid(epoch);
    }, 0);
  }
  private drainHyperliquid = (epoch: number) => {
    if (epoch !== this.generation || !this.running) return;
    const queue = this.hlQueue;
    try {
      for (const tick of queue.splice(0, 6)) {
        if (epoch !== this.generation || !this.running) break;
        try { this.accept(tick); } catch (error) { console.error("Hyperliquid trade processing failed", error); }
      }
    } finally {
      if (epoch === this.generation && queue === this.hlQueue && this.running) {
        if (queue.length) this.scheduleHyperliquidDrain(epoch);
        else this.hlDraining = false;
      }
    }
  };
  tradesFor(symbol: string): Tick[] {
    return this.tradesBySymbol.get(symbol) ?? this.tradesBySymbol.get(stripVenue(symbol)) ?? [];
  }
  private frames(): string[] {
    return [...TIMEFRAMES, ...this.extraFrames];
  }
  /** Register an interval so ticks start folding into it. */
  private track(timeframe: Timeframe) {
    if (isTickInterval(timeframe)) this.tickFrames.add(timeframe);
    else if (!TIMEFRAMES.includes(timeframe)) this.extraFrames.add(timeframe);
  }
  start(symbols: string[], mode: FeedMode, quoteSymbols: string[] = [], quotePriority: string[] = quoteSymbols) {
    const nextSymbols = [...new Set(symbols)].sort();
    const nextQuotes = [...new Set(quoteSymbols)].filter(symbol => !nextSymbols.includes(symbol)).sort();
    const nextPriority = [...new Set(quotePriority)].filter(symbol => nextQuotes.includes(symbol)).slice(0, 150).sort();
    if (this.running && this.mode === mode && this.iexEpoch === useAlpacaStore.getState().epoch && JSON.stringify(this.symbols) === JSON.stringify(nextSymbols)) {
      if (JSON.stringify(this.quoteSymbols) !== JSON.stringify(nextQuotes) || JSON.stringify(this.quotePriority) !== JSON.stringify(nextPriority)) {
        this.quoteSymbols = nextQuotes;
        this.quotePriority = nextPriority;
        if (mode === "auto") this.refreshQuoteSubscriptions();
      }
      return;
    }
    const priorQuotes=useChartStore.getState().quotes;
    this.stop();
    if (mode === "simulation") clearMarketSessions();
    this.running = true;
    this.mode = mode;
    this.iexEpoch = useAlpacaStore.getState().epoch;
    this.symbols = nextSymbols;
    this.quoteSymbols = nextQuotes;
    this.quotePriority = nextPriority;
    this.live.clear();
    this.histories.clear();
    this.hlCandleSeries.clear();
    this.hlCandleSent.clear();
    this.liveHistory.clear();
    this.historySources.clear();
    this.pending.clear();
    this.seen.clear();
    this.tradesBySymbol.clear();
    this.tickStates.clear();
    this.tickFirstGroup.clear();
    this.tickBuffer.clear();
    this.simSeq.clear();
    this.simulationSeeds.clear();
    if(mode==="simulation"){
      for(const symbol of [...nextSymbols,...nextQuotes]){
        const seed=priorQuotes[symbol]?.price??this.hlMarks.get(symbol);
        if(typeof seed==="number"&&Number.isFinite(seed)&&seed>0)this.simulationSeeds.set(symbol,seed);
        else this.simulationSeed(symbol);
      }
      this.saveSimulationSeeds();
    }
    this.rangeRequestedAt.clear();
    this.startedAt = Date.now();
    useChartStore.getState().set({
      quotes: {},
      trades: [],
      candles: [],
      orderBook: null,
      feedEpoch: useChartStore.getState().feedEpoch + 1,
      marketEpochs: {},
      dataSources: {},
      candleRecoveries: {},
      feedStatus: mode === "simulation" ? "simulation" : "connecting",
    });
    const epoch = this.generation;
    if (mode === "simulation" && useAlpacaStore.getState().enabled) useAlpacaStore.setState({ status: "disconnected", message: "Simulation mode is active; the IEX stream is inactive.", symbols: [], omitted: [] });
    this.timer = setInterval(() => {
      const now = Date.now();
      if (this.krakenLiveFrom.size) for (const [key, gap] of this.krakenGaps) {
        if (this.krakenRecovery.size >= 2) break;
        if (this.krakenLiveFrom.has(gap.symbol) && !gap.unavailable && gap.retryAt <= now && !this.krakenRecovery.has(key))
          void this.recoverKraken(key).catch(() => {});
      }
      if (this.krakenLiveFrom.size) for (const [key, gap] of this.krakenTickGaps) {
        if (this.krakenRecovery.size >= 2) break;
        if (gap.liveFrom !== undefined && !gap.unavailable && gap.retryAt <= now && !this.krakenRecovery.has(key))
          void this.recoverKrakenTicks(key, gap).catch(() => {});
      }
      if (mode === "auto" && now >= this.sipPollAt) {
        this.sipPollAt = now + 60000;
        this.refreshSipChart();
      }
      if (mode === "auto" && this.hlSocket?.readyState === WebSocket.OPEN) {
        if (this.hlChannelHealth.check(now)) {
          // A healthy unrelated stream/pong must not mask a broken chart channel.
          // Existing onclose handling suspends native series and performs fenced REST repair.
          this.hlSocket.close();
        }
        else for (const [key, gap] of this.hlGaps) {
          if (this.hlRecovery.size >= 2) break;
          const entry = this.hlCandleSeries.get(key);
          if (entry && !gap.unavailable && gap.retryAt <= now && !this.hlRecovery.has(key))
            void this.recoverHyperliquid(entry.symbol, entry.timeframe, gap.from).catch(() => {});
        }
        if (this.hlSocket?.readyState === WebSocket.OPEN) for (const key of this.hlChannelHealth.quietCandidates(now)) {
          if (this.hlChannelProbes.size >= 2) break;
          if (!this.hlChannelProbes.has(key) && !this.hlGaps.has(key) && !this.hlRecovery.has(key)) void this.probeHyperliquidChannel(key);
        }
      }
      const connected =
        this.socket?.readyState === WebSocket.OPEN &&
        now - this.lastTraffic < 18000;
      for (const symbol of this.symbols)
        if (
          (mode === "simulation" ||providerOf(symbol) === "binance" &&
            (!connected &&
              now - this.startedAt >= 8000 &&
              now - (this.live.get(symbol) ?? 0) > 10000))
        ) {
          const quote = useChartStore.getState().quotes[symbol];
          this.accept(
            generateTick(
              symbol,
              quote?.price ?? this.simulationSeed(symbol),
              now,
            ),
          );
        }
      for (const symbol of this.quoteSymbols)
        if (
          (mode === "simulation" ||providerOf(symbol) === "binance" &&
            (!connected &&
              now - this.startedAt >= 8000 &&
              now - (this.live.get(symbol) ?? 0) > 10000))
        )
          this.simulateQuote(symbol, now);
      if (
        mode === "auto" &&
        now - this.lastTraffic > 18000 &&
        this.socket?.readyState === WebSocket.OPEN
      )
        this.socket.close();
      if (mode === "auto" && this.hlSocket && (
        this.hlSocket.readyState === WebSocket.OPEN && now - this.hlLastTraffic > 45_000
        || this.hlSocket.readyState === 0 && now - this.hlConnectAt > 15_000
      )) this.hlSocket.close();
      if (
        mode === "auto" &&
        providerOf(useChartStore.getState().symbol)==="binance" &&
        !connected &&
        now - this.startedAt >= 8000 &&
        now - (this.live.get(useChartStore.getState().symbol) ?? 0) > 10000
      )
        useChartStore.getState().set({ feedStatus: "simulation" });
    }, 700);
    if (mode === "auto") {
      this.connect(epoch);
      void this.fetchQuotes(epoch);
      this.startYahoo(epoch);
      this.startHyperliquid(epoch);
      this.startKraken(epoch);
      this.startIex(epoch);
    }
  }
  stop() {
    this.krakenConnection++;
    this.krakenLiveFrom.clear();
    this.krakenGaps.clear();
    this.krakenRecovery.clear();
    this.krakenClosedThrough.clear();
    this.krakenTickThrough.clear();
    this.krakenTickGaps.clear();
    this.krakenSilentTickClose.clear();
    this.krakenRecent.clear();
    this.krakenFailures = 0;
    this.stopKraken?.(); this.stopKraken = undefined;
    clearTimeout(this.krakenRetry); this.krakenRetry = undefined;
    this.sipPoll = undefined;
    this.sipPollAt = 0;
    this.iexStream?.stop(); this.iexStream = null; this.iexBases.clear(); this.iexReady.clear(); this.iexDelivered.clear(); this.iexClosed.clear();
    this.running = false;
    this.generation++;
    this.hlQueue = [];
    this.hlDraining = false;
    clearTimeout(this.hlDrainTimer);
    this.hlDrainTimer = undefined;
    this.hlGaps.clear();
    this.hlRecovery.clear();
    this.hlChannelProbes.clear();
    this.hlAwaitingCandles.clear();
    this.hlRepairPublication.clear();
    if (this.retry) clearTimeout(this.retry);
    if (this.timer) clearInterval(this.timer);
    if (this.yahooTimer) clearInterval(this.yahooTimer);
    if (this.hlRetry) clearTimeout(this.hlRetry);
    if (this.hlPing) clearInterval(this.hlPing);
    if (this.hlQuoteTimer) clearInterval(this.hlQuoteTimer);
    this.retry = null;
    this.timer = null;
    this.yahooTimer = null;
    this.hlRetry = this.hlPing = this.hlQuoteTimer = null;
    this.hlAttempts = 0;
    this.yahooSeen.clear();
    if (this.hlSocket) {
      this.hlSocket.onclose = null;
      this.hlSocket.close();
    }
    this.hlSocket = null;
    this.hlChannelHealth.reset();
    this.hlCandleSent.clear();
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
    }
    this.socket = null;
  }
  /** Quote-only edits preserve chart history, trades, drawings and alert state. */
  private refreshQuoteSubscriptions() {
    if (this.hlSocket) this.suspendHyperliquidCandles();
    for (const socket of [this.socket, this.hlSocket]) if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.close();
    }
    this.socket = null;
    this.hlSocket = null;
    if (this.retry) clearTimeout(this.retry);
    if (this.hlRetry) clearTimeout(this.hlRetry);
    if (this.hlPing) clearInterval(this.hlPing);
    if (this.hlQuoteTimer) clearInterval(this.hlQuoteTimer);
    if (this.yahooTimer) clearInterval(this.yahooTimer);
    this.connect(this.generation);
    void this.fetchQuotes(this.generation);
    this.startYahoo(this.generation);
    this.startHyperliquid(this.generation);
    this.startKraken(this.generation);
    if (this.iexStream) this.iexStream.setSymbols(this.iexSymbols());
    else this.startIex(this.generation);
  }
  private iexSymbols() {
    const active = useChartStore.getState().symbol;
    return [...new Set([active, ...this.symbols, ...this.quotePriority, ...this.quoteSymbols])].filter(symbol => symbol.startsWith("IEX:"));
  }
  private invalidateIex() {
    this.iexConnection++;
    for (const key of this.pending.keys()) if (key.startsWith("iex:")) this.pending.delete(key);
    this.iexReady.clear(); this.iexBases.clear(); this.iexDelivered.clear(); this.iexClosed.clear();
    for (const symbol of this.symbols.filter(symbol => providerOf(symbol) === "alpaca")) this.resetSource(symbol);
  }
  private startIex(epoch: number) {
    const symbols = this.iexSymbols();
    if (!symbols.length || this.iexStream || !useAlpacaStore.getState().enabled || this.mode !== "auto") return;
    this.iexStream = new IexStream({ credentials: alpacaCredentials,
      trade: trade => { if (epoch === this.generation) this.acceptIexTrade(trade); },
      bar: bar => { if (epoch === this.generation) this.acceptIexBar(bar); },
      subscription: (symbols, omitted) => { if (epoch === this.generation) useAlpacaStore.setState({ symbols, omitted }); },
      status: (status, message) => {
        if (epoch !== this.generation) return;
        useAlpacaStore.setState({ status, message });
        if (useChartStore.getState().symbol.startsWith("IEX:")) {
          const nextFeedStatus = status === "authenticated" ? "live" : status === "reconnecting" || status === "error" ? "reconnecting" : "connecting";
          if (useChartStore.getState().feedStatus !== nextFeedStatus) {
            useChartStore.getState().set({ feedStatus: nextFeedStatus });
          }
        }
      },
      gap: () => { if (epoch === this.generation) this.invalidateIex(); },
    });
    this.iexStream.setSymbols(symbols); this.iexStream.start();
  }
  private acceptIexTrade(trade: IexTrade) {
    const previous = useChartStore.getState().quotes[trade.symbol];
    if (previous && trade.time < previous.time) return;
    const open = previous ? previous.price - previous.change : trade.price;
    const high = Math.max(previous?.high ?? trade.price, trade.price), low = Math.min(previous?.low ?? trade.price, trade.price);
    this.quote(trade.symbol, trade.price, open, high, low, 0, false,
      basicMetrics(trade.symbol, null, null, high, low, "observed"), { basis: "trade", time: trade.time });
  }
  private iexBase(symbol: string, daily: boolean) {
    const key = `${symbol}:${daily ? "daily" : "minute"}`;
    let base = this.iexBases.get(key); if (!base) { base = new IexCandles(); this.iexBases.set(key, base); } return base;
  }
  private acceptIexBar(value: IexBar) {
    const base = this.iexBase(value.symbol, value.daily); base.put(value.bar);
    const epoch = this.generation;
    for (const key of this.iexReady) {
      if (!key.startsWith(`${value.symbol}:`)) continue;
      const timeframe = key.slice(value.symbol.length + 1), plan = iexHistoryPlan(timeframe, 1);
      if (plan.daily !== value.daily) continue;
      const bars = mergeIexSeries(this.histories.get(key) ?? [], base.bars(timeframe)), last = bars.at(-1); if (!last) continue;
      this.histories.set(key, bars); this.historySources.set(key, false);
      this.iexDelivered.set(key, { ...last });
      if (!this.publish("bar", this.barListeners.get(key), last) || epoch !== this.generation) return;
      // Provider bar corrections update studies but never replay an earlier close signal.
      const watermark = value.bar.time + (value.daily ? 0 : 60_000);
      const closed = bars.findLast(bar => nextBucket(timeframe, bar.time) <= watermark);
      if (!value.correction && closed && closed.time > (this.iexClosed.get(key) ?? -Infinity)) {
        this.iexClosed.set(key, closed.time);
        if (!this.publish("close", this.closeListeners, value.symbol, timeframe, closed, false)) return;
      }
      const state = useChartStore.getState();
      if (state.symbol === value.symbol && state.timeframe === timeframe) state.set({ candles: bars });
    }
    if (epoch === this.generation && [...this.iexReady].some(key => key.startsWith(`${value.symbol}:`))) this.publish("candle", this.candleListeners, value.symbol);
  }
  private async iexHistory(symbol: string, timeframe: string, count: number, end?: number): Promise<OHLCV[]> {
    const plan = iexHistoryPlan(timeframe, count), key = `${symbol}:${timeframe}`, requestKey = `iex:${key}:${count}:${end ?? ""}`;
    if (!useAlpacaStore.getState().enabled) { alpacaCredentials(); }
    const cached = this.histories.get(key);
    if (end === undefined && this.iexReady.has(key) && cached && cached.length >= count) return cached.slice(-count);
    const prior = this.pending.get(requestKey); if (prior) return prior;
    const epoch = this.generation, connection = this.iexConnection, session = useAlpacaStore.getState().epoch, base = this.iexBase(symbol, plan.daily), revision = base.revision;
    const task = (async () => {
      const result = await loadIexBars(symbol, timeframe, count, end);
      if (epoch !== this.generation || connection !== this.iexConnection || session !== useAlpacaStore.getState().epoch) throw new Error("The IEX connection changed during history loading.");
      if (end !== undefined) return result.bars;
      base.seed(result.base, revision); const bars = mergeIexSeries(this.histories.get(key) ?? [], base.bars(timeframe));
      this.histories.set(key, bars); this.historySources.set(key, false); this.iexReady.add(key);
      if (bars.length) this.iexDelivered.set(key, { ...bars.at(-1)! });
      const closed = bars.findLast(bar => nextBucket(timeframe, bar.time) <= Date.now());
      if (closed) this.iexClosed.set(key, closed.time);
      const state = useChartStore.getState();
      state.set({ dataSources: { ...state.dataSources, [key]: "exchange" }, ...(state.symbol === symbol && state.timeframe === timeframe ? { candles: bars } : {}) });
      return bars.slice(-count);
    })();
    this.pending.set(requestKey, task);
    try { return await task; } finally { if (this.pending.get(requestKey) === task) this.pending.delete(requestKey); }
  }
  private refreshSipChart() {
    const { symbol, timeframe } = useChartStore.getState();
    const key = `${symbol}:${timeframe}`;
    const session = useAlpacaStore.getState();
    if (!symbol.startsWith("SIP:") || !session.enabled || this.sipPoll || !this.iexReady.has(key) || !this.barListeners.get(key)?.size) return;
    const epoch = this.generation, connection = this.iexConnection;
    const plan = iexHistoryPlan(timeframe, 2);
    const task = (async () => {
      const result = await loadIexBars(symbol, timeframe, 2);
      const state = useChartStore.getState();
      if (epoch !== this.generation || connection !== this.iexConnection || session.epoch !== useAlpacaStore.getState().epoch ||
        state.symbol !== symbol || state.timeframe !== timeframe || !this.barListeners.get(key)?.size) return;
      const previous = this.histories.get(key) ?? [];
      const last = previous.at(-1);
      const base = this.iexBase(symbol, plan.daily);
      base.merge(result.base);
      const updates = base.bars(timeframe).filter(bar => !last || bar.time > last.time || bar.time === last.time &&
        (bar.open !== last.open || bar.high !== last.high || bar.low !== last.low || bar.close !== last.close || bar.volume !== last.volume));
      if (!updates.length) return;
      const bars = mergeIexSeries(previous, updates);
      this.histories.set(key, bars);
      state.set({ candles: bars });
      for (const bar of updates) {
        if (epoch !== this.generation || !this.publish("bar", this.barListeners.get(key), bar)) return;
      }
      // Delayed history refreshes only notify chart subscribers.
    })().catch(() => {}).finally(() => { if (this.sipPoll === task) this.sipPoll = undefined; });
    this.sipPoll = task;
  }
  private simulateQuote(symbol: string, now: number) {
    const previous = useChartStore.getState().quotes[symbol];
    const base = previous?.price ?? this.simulationSeed(symbol);
    const tick = generateTick(symbol, base, now);
    this.quote(
      symbol,
      tick.price,
      previous ? previous.price - previous.change : base,
      Math.max(previous?.high ?? tick.price, tick.price),
      Math.min(previous?.low ?? tick.price, tick.price),
      previous?.volume ?? 0,
      true,
    );
  }
  private startKraken(epoch: number) {
    if (!this.running || this.mode !== "auto" || epoch !== this.generation) return;
    this.suspendKrakenCandles();
    const connection = ++this.krakenConnection;
    this.krakenLiveFrom.clear();
    this.krakenRecovery.clear();
    this.krakenRecent.clear();
    const valid = () => this.running && epoch === this.generation && connection === this.krakenConnection;
    this.stopKraken?.();
    this.stopKraken = undefined;
    clearTimeout(this.krakenRetry);
    this.krakenRetry = undefined;
    const charted = new Set(this.symbols.filter(symbol => providerOf(symbol) === "kraken"));
    const pairs = [...new Set([...charted, ...this.quotePriority, ...this.quoteSymbols])]
      .filter(symbol => providerOf(symbol) === "kraken").slice(0, Math.max(charted.size, 150)).map(tickerOf);
    if (!pairs.length) return;
    this.stopKraken = subscribeKrakenTrades(pairs, tick => {
      if (!valid() || this.seen.has(tick.id)) return;
      this.krakenFailures = 0;
      this.seen.set(tick.id, tick.time);
      if (this.seen.size > 10000) this.seen.delete(this.seen.keys().next().value!);
      const state = useChartStore.getState();
      if (tick.symbol === state.symbol && state.feedStatus !== "live") state.set({ feedStatus: "live" });
      this.accept(tick);
    }, () => {
      if (!valid()) return;
      this.krakenLiveFrom.clear();
      this.krakenConnection++;
      this.krakenRecovery.clear();
      this.krakenRecent.clear();
      this.suspendKrakenCandles();
      if (providerOf(useChartStore.getState().symbol) === "kraken")
        useChartStore.getState().set({ orderBook: null, feedStatus: "reconnecting" });
      const delay = Math.min(30000, 2000 * 2 ** this.krakenFailures);
      this.krakenFailures = Math.min(this.krakenFailures + 1, 4);
      this.krakenRetry = setTimeout(() => this.startKraken(epoch), delay);
    }, book => {
      if (!valid() || !this.publish("book", this.bookListeners, book)) return;
      this.krakenFailures = 0;
      const state = useChartStore.getState();
      if (state.symbol === book.symbol) state.set({ orderBook: book });
    }, [...charted].map(tickerOf), ticker => {
      if (!valid()) return;
      this.krakenFailures = 0;
      this.quote(ticker.symbol, ticker.last, ticker.last - ticker.change, ticker.high, ticker.low, ticker.volume, false,
        basicMetrics(ticker.symbol, ticker.volume, null, ticker.high, ticker.low, "24h", ticker.time), { basis: "trade", time: ticker.time });
    }, (symbol, acknowledgedAt) => {
      if (!valid() || !charted.has(symbol)) return;
      this.krakenLiveFrom.set(symbol, acknowledgedAt);
      for (const [key, gap] of this.krakenGaps) {
        if (gap.symbol !== symbol) continue;
        gap.target = bucketStart(gap.timeframe, acknowledgedAt);
        gap.retryAt = 0;
        if (this.krakenRecovery.size < 2 && !gap.unavailable) void this.recoverKraken(key).catch(() => {});
      }
    });
  }

  private suspendKrakenCandles() {
    for (const symbol of this.symbols.filter(symbol => providerOf(symbol) === "kraken")) for (const timeframe of this.tickFrames) {
      const key = `${symbol}:${timeframe}`;
      this.tickBuffer.delete(key);
      const from = this.tickStates.get(key)?.bars.at(-1)?.time;
      const through = this.krakenTickThrough.get(key);
      if (from === undefined || through === undefined) continue;
      this.krakenTickGaps.set(key, { symbol, timeframe, from, through, retryAt: 0, unavailable: false });
      this.recoveryStatus(key, { status: "refreshing", from });
    }
    for (const symbol of this.symbols.filter(symbol => providerOf(symbol) === "kraken")) for (const timeframe of this.frames()) {
      const key = `${symbol}:${timeframe}`, last = this.histories.get(key)?.at(-1);
      if (!last) continue;
      const state = useChartStore.getState();
      if (!this.liveHistory.has(key) && !this.barListeners.get(key)?.size
        && !(state.symbol === symbol && state.timeframe === timeframe)) continue;
      if (!this.krakenGaps.has(key)) this.krakenGaps.set(key, {
        symbol, timeframe, from: last.time, target: last.time, retryAt: 0, attempts: 0, unavailable: false,
      });
      this.recoveryStatus(key, { status: "refreshing", from: this.krakenGaps.get(key)!.from });
    }
  }

  private recentKrakenTrades(symbol: string) {
    const pending = this.krakenRecent.get(symbol);
    if (pending) return pending;
    const task = loadKrakenRecentTrades(tickerOf(symbol), 1000).finally(() => {
      if (this.krakenRecent.get(symbol) === task) this.krakenRecent.delete(symbol);
    });
    this.krakenRecent.set(symbol, task);
    return task;
  }

  private recoverKrakenTicks(key: string, gap: KrakenTickGap): Promise<OHLCV[]> {
    const pending = this.krakenRecovery.get(key);
    if (pending) return pending;
    const liveFrom = gap.liveFrom;
    if (gap.unavailable || liveFrom === undefined || !this.krakenLiveFrom.has(gap.symbol))
      return Promise.reject(new RecoveryUnavailableError("Kraken tick candle recovery is not available."));

    const valid = () => this.running && this.krakenTickGaps.get(key) === gap;
    const task = (async () => {
      try {
        this.recoveryStatus(key, { status: "loading", from: gap.from });
        const recent = await this.recentKrakenTrades(gap.symbol);
        if (!valid()) throw new Error("The Kraken connection changed during tick candle recovery.");
        const live = this.tradesFor(gap.symbol).filter(tick => (tick.seq ?? -1) >= liveFrom);
        const oldest = recent[0], newest = recent.at(-1);
        if (oldest && oldest.seq > gap.through)
          throw new RecoveryUnavailableError("Kraken's recent trades no longer cover the interrupted tick candle. Reload the chart to start from available history.");
        const known = new Set(recent.map(trade => trade.seq));
        if (!newest || !known.has(gap.through) || !live.some(trade => known.has(trade.seq!)))
          throw new Error("Waiting for Kraken trade history to overlap the reconnected stream.");

        // Retain earlier tick bars and fold the corrected tail on its existing synthetic time axis.
        const current = this.tickStates.get(key)!;
        let tail: TickBarState = { bars: current.bars.slice(-1), group: current.group };
        const additions = recent.filter(trade => trade.seq > gap.through).concat(
          live.filter((trade): trade is Tick & { seq: number } => trade.seq !== undefined && trade.seq > newest.seq)
            .sort((a, b) => a.seq - b.seq),
        );
        const perBar = tickCount(gap.timeframe);
        for (const trade of additions) tail = aggregateTickBars(tail, trade, perBar, MAX_HISTORY_BARS).state;
        const bars = [...current.bars.slice(0, -1), ...tail.bars].slice(-MAX_HISTORY_BARS);
        this.tickStates.set(key, { bars, group: tail.group });
        this.krakenTickThrough.set(key, additions.at(-1)?.seq ?? gap.through);
        if (tail.group !== null) this.krakenSilentTickClose.set(key, tail.group);
        this.krakenTickGaps.delete(key);
        this.liveHistory.add(key);
        const connection = this.krakenConnection;
        this.recoveryStatus(key, null);
        if (!this.running || this.krakenConnection !== connection) return bars;
        const state = useChartStore.getState();
        if (state.symbol === gap.symbol && state.timeframe === gap.timeframe) state.set({ candles: bars });
        if (!this.running || this.krakenConnection !== connection) return bars;
        this.hlRepairPublication.set(key, { from: tail.bars[0].time, bars });
        try { this.publish("bar", this.barListeners.get(key), bars.at(-1)!); }
        finally { this.hlRepairPublication.delete(key); }
        return bars;
      } catch (error) {
        if (valid()) {
          gap.unavailable = error instanceof RecoveryUnavailableError;
          gap.retryAt = Date.now() + 3000;
          this.recoveryStatus(key, { status: gap.unavailable ? "unavailable" : "retrying", from: gap.from,
            message: error instanceof Error ? error.message : String(error) });
        }
        throw error;
      }
    })().finally(() => { if (this.krakenRecovery.get(key) === task) this.krakenRecovery.delete(key); });
    this.krakenRecovery.set(key, task);
    return task;
  }

  private recoverKraken(key: string): Promise<OHLCV[]> {
    const pending = this.krakenRecovery.get(key);
    if (pending) return pending;
    const gap = this.krakenGaps.get(key);
    if (!gap || !this.krakenLiveFrom.has(gap.symbol) || gap.unavailable) return Promise.reject(new RecoveryUnavailableError("Kraken candle recovery is not available."));
    const epoch = this.generation, connection = this.krakenConnection;
    const valid = () => this.running && epoch === this.generation && connection === this.krakenConnection;
    let task!: Promise<OHLCV[]>;
    task = (async () => {
      try {
        this.recoveryStatus(key, { status: "loading", from: gap.from });
        if (!planSource(gap.timeframe, KRAKEN_NATIVES))
          throw new RecoveryUnavailableError("Kraken does not provide historical candles for this interval. Reload the chart to restart live aggregation.");
        const closed = await loadKrakenClosedBars(tickerOf(gap.symbol), gap.timeframe);
        if (!valid()) throw new Error("The Kraken connection changed during candle recovery.");
        const last = closed.at(-1);
        if (!last || last.time < gap.target) throw new Error("Waiting for Kraken to close the interrupted candle window.");
        // The REST snapshot owns the closed recovery window. A locally folded
        // bucket absent from that window must not survive as a complete candle.
        const current = (this.histories.get(key) ?? []).filter(bar => bar.time < gap.from || bar.time > last.time);
        const bars = mergeRecoveredCandles(current, closed, gap.from, MAX_HISTORY_BARS);
        this.histories.set(key, bars);
        this.krakenClosedThrough.set(key, nextBucket(gap.timeframe, last.time));
        this.historySources.set(key, false);
        this.liveHistory.add(key);
        this.krakenGaps.delete(key);
        this.recoveryStatus(key, null);
        if (!valid()) return bars;
        const state = useChartStore.getState();
        if (state.symbol === gap.symbol && state.timeframe === gap.timeframe) state.set({ candles: bars });
        // Vela reads the complete corrected window through loadRange. Never emit
        // historical close/trade events: those would trigger live alarms/recording.
        this.hlRepairPublication.set(key, { from: gap.from, bars });
        try {
          const anchor = bars.find(bar => bar.time === gap.from), latest = bars.at(-1);
          for (const bar of anchor && latest && anchor.time !== latest.time ? [anchor, latest] : latest ? [latest] : []) {
            if (!valid() || !this.publish("bar", this.barListeners.get(key), { ...bar })) break;
          }
        } finally { this.hlRepairPublication.delete(key); }
        return bars;
      } catch (error) {
        if (valid() && this.krakenGaps.get(key) === gap) {
          gap.attempts++;
          gap.retryAt = Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(gap.attempts, 5));
          gap.unavailable = error instanceof RecoveryUnavailableError;
          this.recoveryStatus(key, { status: gap.unavailable ? "unavailable" : "retrying", from: gap.from,
            message: error instanceof Error ? error.message : String(error) });
        }
        throw error;
      }
    })().finally(() => { if (this.krakenRecovery.get(key) === task) this.krakenRecovery.delete(key); });
    this.krakenRecovery.set(key, task);
    return task;
  }

  private connect(epoch: number) {
    if (epoch !== this.generation) return;
    const exchange = this.symbols.filter((s) => providerOf(s) === "binance");
    const quoteOnly = this.quoteSymbols.filter((s) => providerOf(s) === "binance");
    const individual = quoteOnly.length <= INDIVIDUAL_TICKER_LIMIT;
    const streams = [
      ...exchange.flatMap((s) => [
        `${s.toLowerCase()}@aggTrade`,
        `${s.toLowerCase()}@miniTicker`,
        `${s.toLowerCase()}@depth10`,
      ]),
      ...(individual
        ? quoteOnly.map((s) => `${s.toLowerCase()}@miniTicker`)
        : ["!miniTicker@arr"]),
    ];
    if (!streams.length) return;
    const socket = new WebSocket(
      `wss://data-stream.binance.vision/stream?streams=${streams.join("/")}`,
    );
    this.socket = socket;
    socket.onopen = () => {
      if (epoch !== this.generation) return;
      this.attempts = 0;
      this.lastTraffic = Date.now();
      if (
        useChartStore.getState().quotes[useChartStore.getState().symbol]
          ?.simulated === false &&
        useChartStore.getState().feedStatus !== "live"
      )
        useChartStore.getState().set({ feedStatus: "live" });
    };
    const subscribed = new Set(streams);
    const isCurrent = () => epoch === this.generation && socket === this.socket;
    socket.onmessage = ({ data: raw }) => {
      if (!isCurrent()) return;
      const message = parseWireObject(raw);
      if (!message || typeof message.stream !== "string" || !subscribed.has(message.stream)) return;
      const { stream, data } = message;
      const now = Date.now();
      if (stream === "!miniTicker@arr") {
        if (!Array.isArray(data)) return;
        this.batchQuotes(() => {
          let validTraffic = false;
          for (const item of data) {
            if (!isCurrent()) break;
            const row = wireObject(item);
            const wanted = typeof row?.s === "string" && (this.symbols.includes(row.s) || this.quoteSymbols.includes(row.s));
            if (!wanted && validTraffic) continue;
            const quote = binanceTicker(row);
            if (!quote) continue;
            if (!validTraffic) { this.lastTraffic = now; validTraffic = true; }
            if (wanted) this.miniTicker(quote, now);
          }
        });
        return;
      }

      const row = wireObject(data);
      if (!row) return;
      const symbol = stream.slice(0, stream.indexOf("@")).toUpperCase();
      if (stream.endsWith("@aggTrade")) {
        const tick = binanceTrade(row, symbol);
        if (!tick) return;
        this.lastTraffic = now;
        if (this.seen.has(tick.id)) return;
        this.seen.set(tick.id, tick.time);
        if (this.seen.size > 10000) this.seen.delete(this.seen.keys().next().value!);
        this.live.set(symbol, now);
        const state = useChartStore.getState();
        if (symbol === state.symbol && state.feedStatus !== "live") state.set({ feedStatus: "live" });
        if (isCurrent()) this.accept(tick);
      } else if (stream.endsWith("@miniTicker")) {
        const quote = binanceTicker(row);
        if (!quote || quote.symbol !== symbol) return;
        this.lastTraffic = now;
        this.miniTicker(quote, now);
      } else {
        const depth = binanceDepth(row);
        if (!depth) return;
        this.lastTraffic = now;
        const book = { symbol, ...depth, time: now, simulated: false };
        if (!this.publish("book", this.bookListeners, book)) return;
        if (isCurrent() && symbol === useChartStore.getState().symbol) useChartStore.getState().set({ orderBook: book });
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (epoch !== this.generation) return;
      useChartStore.getState().set({ feedStatus: "reconnecting" });
      this.retry = setTimeout(
        () => this.connect(epoch),
        Math.min(30000, 1000 * 2 ** this.attempts++) + Math.random() * 500,
      );
    };
  }
  private hyperliquidSymbols(): string[] {
    return this.symbols.filter((s) => providerOf(s) === "hyperliquid");
  }
  /**
   * Dex-wide mids stream watchlist prices; charted markets also stream contexts,
   * classified trades and depth. A cached registry supplies metadata and the
   * watchlist's independently reported 24h volume snapshots.
   */
  private startHyperliquid(epoch: number) {
    const wanted = () =>
      new Set([...this.symbols, ...this.quoteSymbols].filter((s) => providerOf(s) === "hyperliquid"));
    if (!wanted().size) return;
    const poll = async () => {
      try {
        const assets = await loadHyperliquidAssets();
        if (epoch !== this.generation) return;
        const set = wanted();
        this.batchQuotes(() => {
          for (const asset of assets) {
            this.hlSzDecimals.set(asset.symbol, asset.szDecimals);
            if (!this.live.has(asset.symbol)) this.hlMarks.set(asset.symbol, asset.mark);
            if (!set.has(asset.symbol)) continue;
            registerSymbolInfo({
              symbol: asset.symbol,
              name: `${asset.name} perpetual`,
              exchange: asset.dex ? `Hyperliquid · ${asset.dexName}` : "Hyperliquid",
              currency: "USD",
              type: "future",
              delayed: false,
            });
            const previous = useChartStore.getState().quotes[asset.symbol];
            const metrics = basicMetrics(asset.symbol, asset.baseVolume ?? null, asset.volume, 0, 0, "24h", asset.asOf ?? Date.now());
            metrics.range = previous?.metrics?.range.resolution === "1m" ? previous.metrics.range : pendingRange();
            this.quote(
              asset.symbol,
              asset.mark,
              asset.previousDay,
              metrics.range.high ?? 0,
              metrics.range.low ?? 0,
              asset.baseVolume ?? 0,
              false,
              previous?.metrics && previous.metrics.volume.asOf > metrics.volume.asOf ? previous.metrics : metrics,
              { basis: "mark", time: asset.asOf ?? Date.now(), referencePrice: asset.previousDay, metadataTime: asset.asOf ?? Date.now() },
            );
          }
        });
        const store = useChartStore.getState();
        if (providerOf(store.symbol) === "hyperliquid" && set.has(store.symbol)
          && this.hlSocket?.readyState === WebSocket.OPEN && store.feedStatus !== "live") store.set({ feedStatus: "live" });
      } catch {
        /* the next poll retries */
      }
    };
    void poll();
    this.hlQuoteTimer = setInterval(() => void poll(), 60_000);
    this.connectHyperliquid(epoch);
  }
  private connectHyperliquid(epoch: number) {
    if (epoch !== this.generation) return;
    const coins = this.hyperliquidSymbols().map(tickerOf);
    const wanted = new Set([...this.symbols, ...this.quoteSymbols].filter(s => providerOf(s) === "hyperliquid"));
    if (!wanted.size) return;
    const dexes = new Set([...wanted].map(s => { const coin = tickerOf(s); return coin.includes(":") ? coin.split(":")[0] : ""; }));
    const quoteTradeSymbols = new Set(hyperliquidQuoteTradeSymbols(this.hyperliquidSymbols(), this.quoteSymbols,
      this.quotePriority, dexes.size, this.hlCandleSeries.size));
    const socket = new WebSocket("wss://api.hyperliquid.xyz/ws");
    this.hlSocket = socket;
    // Pending repairs belong to their captured socket. A replacement must be
    // able to repair immediately; old completions are fenced by socket identity.
    this.hlRecovery.clear();
    this.hlChannelProbes.clear();
    this.hlConnectAt = Date.now();
    this.hlCandleSent.clear();
    socket.onopen = () => {
      if (epoch !== this.generation || socket !== this.hlSocket) return;
      this.hlLastTraffic = Date.now();
      this.hlAttempts = 0;
      this.hlChannelHealth.reset();
      for (const dex of dexes) socket.send(JSON.stringify({ method: "subscribe", subscription: { type: "allMids", dex } }));
      for (const coin of coins) {
        socket.send(JSON.stringify({ method: "subscribe", subscription: { type: "activeAssetCtx", coin } }));
        socket.send(JSON.stringify({ method: "subscribe", subscription: { type: "trades", coin } }));
        socket.send(JSON.stringify({ method: "subscribe", subscription: { type: "l2Book", coin } }));
      }
      for (const key of this.hlCandleSeries.keys()) this.sendHyperliquidCandle(key);
      for (const symbol of quoteTradeSymbols) socket.send(JSON.stringify({ method: "subscribe", subscription: { type: "trades", coin: tickerOf(symbol) } }));
      if (this.hlPing) clearInterval(this.hlPing);
      // The server drops idle connections after about a minute.
      this.hlPing = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ method: "ping" }));
      }, 30_000);
    };
    socket.onmessage = (event) => {
      if (epoch !== this.generation || socket !== this.hlSocket) return;
      const message = parseWireObject(event.data);
      if (!message) return;
      const now = Date.now();
      if (message.channel === "pong") { this.hlLastTraffic = now; return; }
      try {
        if (message.channel === "candle") {
          const candles = (Array.isArray(message.data) ? message.data : [message.data])
            .flatMap(raw => { const candle = parseHyperliquidCandle(raw); return candle ? [candle] : []; })
            .sort((a, b) => a.bar.time - b.bar.time || a.count - b.count);
          if (candles.length) this.hlLastTraffic = now;
          for (const candle of candles) this.acceptHyperliquidCandle(candle);
        } else if (message.channel === "allMids") {
          const mids = wireObject(wireObject(message.data)?.mids);
          if (!mids) return;
          this.batchQuotes(() => {
            for (const [coin, raw] of Object.entries(mids)) {
              const symbol = `HL:${coin}`, price = wireDecimal(raw);
              if (!coin || !Number.isFinite(price) || price <= 0) continue;
              this.hlLastTraffic = now;
              if (!wanted.has(symbol)) continue;
              this.live.set(symbol, now);
              const midState = useChartStore.getState();
              if (symbol === midState.symbol && midState.feedStatus !== "live") midState.set({ feedStatus: "live" });
              const previous = midState.quotes[symbol];
              if (previous?.simulated === false && previous.priceBasis === "mid" && previous.price === price) continue;
              const metrics = previous?.simulated === false && previous.metrics ? previous.metrics : basicMetrics(symbol, null, null, 0, 0, "24h");
              if (!previous?.metrics) metrics.range = pendingRange();
              this.quote(symbol, price, previous ? previous.price - previous.change : price, metrics.range.high ?? 0, metrics.range.low ?? 0, metrics.volume.base ?? 0, false, metrics,
                { basis: "mid", time: now });
            }
          });
        } else if (message.channel === "activeAssetCtx") {
          const data = wireObject(message.data);
          if (typeof data?.coin !== "string") return;
          const symbol = `HL:${data.coin}`, ctx = wireObject(data.ctx);
          if (wanted.has(symbol) && ctx) {
            const price = wireDecimal(ctx.markPx), open = wireDecimal(ctx.prevDayPx);
            if (price > 0 && Number.isFinite(price) && open > 0 && Number.isFinite(open)) {
              this.hlLastTraffic = now;
              const previous = useChartStore.getState().quotes[symbol];
              const metrics = basicMetrics(symbol, nonnegative(ctx.dayBaseVlm), nonnegative(ctx.dayNtlVlm), 0, 0, "24h");
              metrics.range = previous?.metrics?.range.resolution === "1m" ? previous.metrics.range : pendingRange();
              this.hlMarks.set(symbol, price);
              this.live.set(symbol, now);
              this.quote(symbol, price, open, metrics.range.high ?? 0, metrics.range.low ?? 0, metrics.volume.base ?? 0, false, metrics,
                { basis: "mark", time: now, referencePrice: open });
            }
          }
        } else if (message.channel === "trades" && Array.isArray(message.data)) {
          const quoteTrades = new Map<string, Tick>();
          for (const raw of message.data) {
            const tick = parseTrade(raw);
            if (!tick) continue;
            if (quoteTradeSymbols.has(tick.symbol)) {
              this.hlLastTraffic = now;
              const previous = quoteTrades.get(tick.symbol);
              if (!previous || tick.time >= previous.time) quoteTrades.set(tick.symbol, tick);
              continue;
            }
            if (!coins.includes(tickerOf(tick.symbol))) continue;
            this.hlLastTraffic = now;
            if (this.seen.has(tick.id)) continue;
            this.hlChannelHealth.trade(tick.symbol, tick.time, Date.now());
            this.seen.set(tick.id, tick.time);
            if (this.seen.size > 10000) this.seen.delete(this.seen.keys().next().value!);
            this.live.set(tick.symbol, Date.now());
            const tradeState = useChartStore.getState();
            if (tick.symbol === tradeState.symbol && tradeState.feedStatus !== "live") tradeState.set({ feedStatus: "live" });
            this.hlQueue.push(tick);
          }
          if (quoteTrades.size) this.batchQuotes(() => {
            for (const tick of quoteTrades.values()) this.quote(tick.symbol, tick.price, 0, 0, 0, 0, false,
              undefined, { basis: "trade", time: tick.time });
          });
          if (this.hlQueue.length > 5000) this.hlQueue.splice(0, this.hlQueue.length - 5000);
          if (!this.hlDraining && this.hlQueue.length) {
            this.hlDraining = true;
            this.scheduleHyperliquidDrain(epoch);
          }
        } else if (message.channel === "l2Book") {
          const book = parseBook(message.data);
          const symbol = book ? `HL:${book.coin}` : "";
          if(book&&coins.includes(book.coin)){
            this.hlLastTraffic = now;
            const snapshot:OrderBook={symbol,bids:book.bids,asks:book.asks,time:book.time,simulated:false};
            if (!this.publish("book", this.bookListeners, snapshot)) return;
            if(symbol===useChartStore.getState().symbol)useChartStore.getState().set({orderBook:snapshot});
          }
        }
      } catch (error) {
        console.error("Hyperliquid message rejected", error);
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (epoch !== this.generation || socket !== this.hlSocket) return;
      if (this.hlPing) clearInterval(this.hlPing);
      this.suspendHyperliquidCandles();
      if (providerOf(useChartStore.getState().symbol) === "hyperliquid") useChartStore.getState().set({ feedStatus: "reconnecting" });
      this.hlRetry = setTimeout(
        () => this.connectHyperliquid(epoch),
        Math.min(30000, 1000 * 2 ** this.hlAttempts++) + Math.random() * 500,
      );
    };
  }
  private async learnHyperliquid() {
    try {
      for (const asset of await loadHyperliquidAssets()) {
        this.hlSzDecimals.set(asset.symbol, asset.szDecimals);
        this.hlMarks.set(asset.symbol, asset.mark);
      }
    } catch {
      /* the quote poll tries again */
    }
  }
  private probeHyperliquidChannel(key: string): Promise<void> {
    const entry = this.hlCandleSeries.get(key), socket = this.hlSocket, epoch = this.generation;
    if (!entry || socket?.readyState !== WebSocket.OPEN) return Promise.resolve();
    this.hlChannelHealth.probing(key, Date.now());
    let task!: Promise<void>;
    task = (async () => {
      try {
        const observed = await loadHyperliquidBars({ coin: tickerOf(entry.symbol), timeframe: entry.timeframe, count: 2 });
        if (!this.running || epoch !== this.generation || socket !== this.hlSocket || socket.readyState !== WebSocket.OPEN || !this.hlChannelHealth.isQuiet(key, Date.now())) return;
        if (hyperliquidStreamBehind(this.histories.get(key)?.at(-1), observed, Date.now())) socket.close();
      } catch {
        // A failed/limited REST request is not evidence that the stream is broken.
        // The per-channel cooldown bounds retries; normal socket heartbeat checks remain active.
      }
    })().finally(() => { if (this.hlChannelProbes.get(key) === task) this.hlChannelProbes.delete(key); });
    this.hlChannelProbes.set(key, task); return task;
  }
  private sendHyperliquidCandle(key: string) {
    const entry = this.hlCandleSeries.get(key), socket = this.hlSocket;
    if (!entry || this.hlCandleSent.has(key) || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ method: "subscribe", subscription: {
      type: "candle", coin: tickerOf(entry.symbol), interval: entry.api,
    } }));
    this.hlCandleSent.add(key);
    this.hlChannelHealth.watch(key, entry.symbol, entry.timeframe, Date.now());
  }
  private nativeHyperliquidCandles(symbol: string, timeframe: string) {
    if (this.mode !== "auto" || providerOf(symbol) !== "hyperliquid" || !this.symbols.includes(symbol)) return undefined;
    const native = HYPERLIQUID_NATIVES.find(item => item.id === timeframe);
    if (!native) return undefined;
    const key = `${symbol}:${timeframe}`;
    let entry = this.hlCandleSeries.get(key);
    if (!entry) {
      entry = { symbol, timeframe, api: native.api, series: new HyperliquidCandleSeries() };
      this.hlCandleSeries.set(key, entry);
    }
    this.sendHyperliquidCandle(key);
    return entry.series;
  }
  private acceptHyperliquidCandle(candle: HyperliquidCandle) {
    const key = `${candle.symbol}:${candle.timeframe}`, entry = this.hlCandleSeries.get(key);
    if (!entry) return;
    const previous = this.histories.get(key)?.at(-1);
    const awaiting = this.hlAwaitingCandles.has(key);
    const result = entry.series.accept(this.histories.get(key) ?? [], candle, MAX_HISTORY_BARS);
    if (result.accepted && (!previous || candle.bar.time >= previous.time))
      this.hlChannelHealth.candle(key, candle.bar.time, candle.count, Date.now());
    if (result.accepted && previous && (candle.bar.time > nextBucket(candle.timeframe, previous.time)
      || awaiting && candle.bar.time > previous.time) && !this.hlGaps.has(key)) {
      this.hlGaps.set(key, { from: previous.time, attempts: 0, retryAt: 0, unavailable: false });
      this.recoveryStatus(key, { status: "loading", from: previous.time });
    }
    const gap = this.hlGaps.get(key);
    if (result.accepted && (!previous || candle.bar.time >= previous.time)) {
      this.hlAwaitingCandles.delete(key);
      if (!gap) this.recoveryStatus(key, null);
    }
    if (!result.changed) {
      if (gap && !gap.unavailable && gap.retryAt <= Date.now() && this.hlRecovery.size < 2) void this.recoverHyperliquid(candle.symbol, candle.timeframe, gap.from).catch(() => {});
      return;
    }
    this.histories.set(key, result.bars);
    this.historySources.set(key, false);
    this.live.set(candle.symbol, Date.now());
    const state = useChartStore.getState();
    state.set({ dataSources: { ...state.dataSources, [key]: "exchange" },
      ...(state.symbol === candle.symbol ? { feedStatus: "live" as const } : {}),
      ...(state.symbol === candle.symbol && state.timeframe === candle.timeframe ? { candles: result.bars } : {}),
    });
    if (gap) {
      if (!gap.unavailable && gap.retryAt <= Date.now() && this.hlRecovery.size < 2) void this.recoverHyperliquid(candle.symbol, candle.timeframe, gap.from).catch(() => {});
    } else {
      if (result.latest && !this.publish("bar", this.barListeners.get(key), candle.bar)) return;
      if (result.closed) this.publish("close", this.closeListeners, candle.symbol, candle.timeframe, result.closed, false);
    }
  }
  private recoveryStatus(key: string, recovery: import("@/types/trading").CandleRecovery | null) {
    const state = useChartStore.getState(), next = { ...state.candleRecoveries };
    const current = state.candleRecoveries[key];
    if (!recovery && !current || recovery && current?.status === recovery.status
      && current.from === recovery.from && current.message === recovery.message) return;
    if (recovery) next[key] = recovery;
    else delete next[key];
    state.set({ candleRecoveries: next });
  }
  private suspendHyperliquidCandles() {
    for (const key of this.hlCandleSeries.keys()) {
      const last = this.histories.get(key)?.at(-1);
      if (!last) continue;
      this.hlAwaitingCandles.add(key);
      if (!this.hlGaps.has(key)) this.recoveryStatus(key, { status: "refreshing", from: last.time });
    }
  }
  private recoverHyperliquid(symbol: string, timeframe: string, from: number): Promise<OHLCV[]> {
    const key = `${symbol}:${timeframe}`, pending = this.hlRecovery.get(key);
    if (pending) return pending;
    const gap = this.hlGaps.get(key);
    if (gap?.unavailable) return Promise.reject(new RecoveryUnavailableError("Interrupted candle history is unavailable. Reload the chart."));
    const epoch = this.generation, socket = this.hlSocket;
    const valid = () => this.running && epoch === this.generation && socket === this.hlSocket
      && socket?.readyState === WebSocket.OPEN;
    let task!: Promise<OHLCV[]>;
    task = (async () => {
      try {
        const plan = candleRecoveryPlan(timeframe, Math.min(from, gap?.from ?? from), Date.now());
        this.recoveryStatus(key, { status: "loading", from: plan.anchor });
        if (plan.capped) throw new RecoveryUnavailableError("The interrupted window exceeds the provider's 5,000-candle limit. Reload the chart to use available history.");
        const fetched = await loadHyperliquidBars({ coin: tickerOf(symbol), timeframe, count: plan.count });
        if (!valid()) throw new Error("The market connection changed during candle recovery.");
        const entry = this.hlCandleSeries.get(key);
        if (!entry) throw new Error("The requested candle series changed during recovery.");
        const merged = mergeRecoveredCandles(this.histories.get(key) ?? [], fetched, plan.anchor, MAX_HISTORY_BARS);
        const bars = entry.series.mergeHistory(merged, MAX_HISTORY_BARS);
        this.histories.set(key, bars);
        this.liveHistory.add(key);
        this.hlGaps.delete(key);
        this.hlAwaitingCandles.delete(key);
        this.recoveryStatus(key, null);
        const state = useChartStore.getState();
        if (state.symbol === symbol && state.timeframe === timeframe) state.set({ candles: bars });
        // Correct the old forming bucket, then publish the newest one. Vela's
        // native gap healer reads the complete repair below and recalculates
        // indicators once, instead of replaying thousands of live ticks.
        const listeners = [...(this.barListeners.get(key) ?? [])];
        const anchor = bars.find(bar => bar.time === plan.anchor), latest = bars.at(-1);
        const updates = anchor && latest && anchor.time !== latest.time ? [anchor, latest] : latest ? [latest] : [];
        this.hlRepairPublication.set(key, { from: plan.anchor, bars });
        try {
          for (const bar of updates) for (const listener of listeners) {
            if (!valid()) return bars;
            if (!this.barListeners.get(key)?.has(listener)) continue;
            try { listener({ ...bar }); } catch (error) { console.error("Chart recovery subscriber failed", error); }
          }
        } finally { this.hlRepairPublication.delete(key); }
        return bars;
      } catch (error) {
        if (epoch === this.generation && this.running && socket === this.hlSocket) {
          const previousGap = this.hlGaps.get(key), attempts = (previousGap?.attempts ?? 0) + 1;
          const unavailable = error instanceof RecoveryUnavailableError;
          this.hlGaps.set(key, { from: Math.min(from, previousGap?.from ?? from), attempts,
            retryAt: Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5)), unavailable });
          this.recoveryStatus(key, { status: unavailable ? "unavailable" : "retrying", from,
            message: error instanceof Error ? error.message : String(error) });
        }
        throw error;
      }
    })().finally(() => { if (this.hlRecovery.get(key) === task) this.hlRecovery.delete(key); });
    this.hlRecovery.set(key, task);
    return task;
  }
  /** Candles of a Hyperliquid market; there is no simulated fallback. */
  private async hyperliquidHistory(
    symbol: string,
    timeframe: Timeframe,
    count: number,
    end?: number,
  ): Promise<OHLCV[]> {
    const key = `${symbol}:${timeframe}`;
    const nativeCandles = !end ? this.nativeHyperliquidCandles(symbol, timeframe) : undefined;
    const requestKey = `${key}:${count}:${end ?? ""}`;
    const epoch = this.generation;
    const existing = this.histories.get(key);
    if (!end && existing && existing.length >= count && this.liveHistory.has(key)) {
      const state = useChartStore.getState();
      if (state.symbol === symbol && state.timeframe === timeframe) state.set({ candles: existing });
      return existing.slice(-count);
    }
    const pending = this.pending.get(requestKey);
    if (pending) return pending;
    const task = (async () => {
      let bars: OHLCV[] = [];
      if (this.mode !== "simulation")
        try {
          // Market metadata (tick size) is cached alongside the candles; its failure is not fatal.
          const meta = this.hlMarks.has(symbol) ? Promise.resolve() : this.learnHyperliquid();
          [bars] = await Promise.all([loadHyperliquidBars({ coin: tickerOf(symbol), timeframe, count, end }), meta]);
          if (epoch === this.generation && bars.length) this.liveHistory.add(key);
        } catch (error) {
          if (!end)
            useChartStore
              .getState()
              .toast(`${tickerOf(symbol)} data unavailable`, error instanceof Error ? error.message : String(error), "error");
        }
      if (epoch !== this.generation) return bars;
      if (!end) {
        const tail = this.histories.get(key) ?? [];
        const merged = new Map(bars.map((b) => [b.time, b]));
        // The provider snapshot owns overlapping buckets. A locally started
        // partial candle must not erase the full opening price and volume.
        for (const b of tail) if (b.time > (bars.at(-1)?.time ?? -Infinity)) merged.set(b.time, b);
        bars = [...merged.values()].sort((a, b) => a.time - b.time).slice(-MAX_HISTORY_BARS);
        if (nativeCandles) bars = nativeCandles.mergeHistory(bars, MAX_HISTORY_BARS);
        this.histories.set(key, bars);
        this.historySources.set(key, false);
        const state = useChartStore.getState();
        state.set({ dataSources: { ...state.dataSources, [key]: "exchange" } });
        if (symbol === state.symbol && timeframe === state.timeframe) state.set({ candles: bars });
      }
      return bars;
    })();
    this.pending.set(requestKey, task);
    try {
      return await task;
    } finally {
      this.pending.delete(requestKey);
    }
  }
  /** Poll Yahoo Finance for stocks, forex and indices (no push feed). */
  private startYahoo(epoch: number) {
    const yahoo = () =>
      [...this.symbols, ...this.quoteSymbols].filter((s) => providerOf(s) === "yahoo");
    if (!yahoo().length) return;
    const poll = async () => {
      const symbols = yahoo().slice(0, 120);
      try {
        const quotes = await yahooQuotes(symbols.map(tickerOf));
        if (epoch !== this.generation) return;
        for (const symbol of symbols) {
          const q = quotes[tickerOf(symbol)];
          if (!q || !(q.price > 0)) continue;
          const previous = useChartStore.getState().quotes[symbol];
          this.live.set(symbol, Date.now());
          this.quote(
            symbol,
            q.price,
            q.previousClose > 0 ? q.previousClose : q.price,
            Math.max(q.high, q.price),
            Math.min(q.low, q.price),
            previous?.volume ?? 0,
            false,
          );
          const stamp = `${q.price}:${q.time}`;
          if (this.symbols.includes(symbol) && this.yahooSeen.get(symbol) !== stamp) {
            this.yahooSeen.set(symbol, stamp);
            this.acceptYahoo(symbol, q.price, q.time > 0 ? q.time : Date.now());
          }
        }
        const store = useChartStore.getState();
        if (providerOf(store.symbol) === "yahoo" && quotes[tickerOf(store.symbol)] && store.feedStatus !== "live")
          store.set({ feedStatus: "live" });
      } catch {
        /* the next poll retries */
      }
    };
    void poll();
    this.yahooTimer = setInterval(() => void poll(), 10_000);
  }
  /** Fold a polled price into every aggregated interval of a non-crypto symbol. */
  private acceptYahoo(symbol: string, price: number, time: number) {
    const epoch = this.generation;
    const tick: Tick = {
      id: `yf-${symbol}-${time}`,
      symbol,
      time,
      price,
      quantity: 0,
      side: "buy",
      simulated: false,
    };
    const state = useChartStore.getState();
    const frames = this.frames();
    if (frames.some((tf) => state.dataSources[`${symbol}:${tf}`] !== "exchange"))
      state.set({
        dataSources: {
          ...state.dataSources,
          ...Object.fromEntries(frames.map((tf) => [`${symbol}:${tf}`, "exchange"])),
        },
      });
    for (const timeframe of frames) {
      const key = `${symbol}:${timeframe}`;
      const next = aggregateTick(this.histories.get(key) ?? [], tick, timeframe, MAX_HISTORY_BARS);
      this.histories.set(key, next.bars);
      this.historySources.set(key, false);
      const bar = next.bars.at(-1);
      if (bar && !this.publish("bar", this.barListeners.get(key), bar)) return;
      if (next.closed)
        if (!this.publish("close", this.closeListeners, symbol, timeframe, next.closed, false)) return;
      if (epoch !== this.generation) return;
      if (symbol === state.symbol && timeframe === state.timeframe)
        useChartStore.getState().set({ candles: next.bars });
    }
    this.publish("trade", this.tickListeners, tick);
  }
  /** Drop cached non-crypto history so charts reload with new session or adjustment settings. */
  refreshYahoo() {
    const symbols = new Set(
      [...this.histories.keys()].map((k) => k.slice(0, k.lastIndexOf(":"))).filter((s) => providerOf(s) === "yahoo"),
    );
    for (const symbol of symbols) this.resetSource(symbol);
  }
  private async yahooHistory(
    symbol: string,
    timeframe: Timeframe,
    count: number,
    end?: number,
  ): Promise<OHLCV[]> {
    const key = `${symbol}:${timeframe}`;
    const requestKey = `${key}:${count}:${end ?? ""}`;
    const epoch = this.generation;
    const existing = this.histories.get(key);
    if (!end && existing && existing.length >= count && this.liveHistory.has(key)) {
      const state = useChartStore.getState();
      if (state.symbol === symbol && state.timeframe === timeframe) state.set({ candles: existing });
      return existing.slice(-count);
    }
    const pending = this.pending.get(requestKey);
    if (pending) return pending;
    const task = (async () => {
      const settings = useChartStore.getState();
      let bars: OHLCV[] = [];
      if (this.mode !== "simulation" && !isTickInterval(timeframe))
        try {
          const loaded = await loadYahooBars({
            ticker: tickerOf(symbol),
            timeframe,
            count,
            end,
            extended: settings.session === "extended",
            adjustDividends: settings.adjustDividends,
          });
          bars = loaded.bars;
          if (epoch === this.generation && loaded.meta?.sessions)
            registerMarketSessions(symbol, loaded.meta.sessions, settings.session === "extended" ? "extended" : "regular");
          if (loaded.meta)
            registerSymbolInfo({
              symbol,
              name: loaded.meta.name,
              exchange: loaded.meta.exchange,
              currency: loaded.meta.currency,
              type: loaded.meta.type,
              timezone: loaded.meta.timezone,
              delayed: loaded.meta.type !== "forex" && loaded.meta.type !== "future",
            });
          if (!end)
            useChartStore.getState().set({
              marketEvents: { ...useChartStore.getState().marketEvents, [symbol]: loaded.events },
            });
          if (epoch === this.generation && bars.length) this.liveHistory.add(key);
        } catch (error) {
          if (!end)
            useChartStore
              .getState()
              .toast(
                `${tickerOf(symbol)} data unavailable`,
                error instanceof Error ? error.message : String(error),
                "error",
              );
        }
      if (epoch !== this.generation) return bars;
      if (!end) {
        const tail = this.histories.get(key) ?? [];
        const merged = new Map(bars.map((b) => [b.time, b]));
        // Polled partial candles cannot replace a complete provider snapshot.
        for (const b of tail) if (b.time > (bars.at(-1)?.time ?? -Infinity)) merged.set(b.time, b);
        bars = [...merged.values()].sort((a, b) => a.time - b.time).slice(-MAX_HISTORY_BARS);
        this.histories.set(key, bars);
        this.historySources.set(key, false);
        const state = useChartStore.getState();
        state.set({ dataSources: { ...state.dataSources, [key]: "exchange" } });
        if (symbol === state.symbol && timeframe === state.timeframe) state.set({ candles: bars });
      }
      return bars;
    })();
    this.pending.set(requestKey, task);
    try {
      return await task;
    } finally {
      this.pending.delete(requestKey);
    }
  }
  private miniTicker({ symbol, last, open, high, low, volume, turnover }: NonNullable<ReturnType<typeof binanceTicker>>, now: number) {
    this.live.set(symbol, now);
    this.quote(symbol, last, open, high, low, volume, false, basicMetrics(symbol, volume, turnover, high, low, "24h", now));
    const state = useChartStore.getState();
    if (symbol === state.symbol && state.feedStatus !== "live") state.set({ feedStatus: "live" });
  }
  private async fetchQuotes(epoch: number) {
    try {
      const response = await fetch("/api/market?resource=ticker/24hr", {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return;
      const data = await response.json();
      if (epoch !== this.generation) return;
      for (const q of data)
        if (
          this.symbols.includes(q.symbol) ||
          this.quoteSymbols.includes(q.symbol)
        )
          this.quote(
            q.symbol,
            +q.lastPrice,
            +q.openPrice,
            +q.highPrice,
            +q.lowPrice,
            +q.volume,
            false,
            basicMetrics(q.symbol, nonnegative(q.volume), nonnegative(q.quoteVolume), +q.highPrice, +q.lowPrice, "24h"),
          );
    } catch {
      return;
    }
  }
  private sourceMismatch(symbol: string, simulated: boolean) {
    return this.frames()
      .concat([...this.tickFrames])
      .some((tf) => {
        const source = this.historySources.get(`${symbol}:${tf}`);
        return source !== undefined && source !== simulated;
      });
  }
  private quote(
    symbol: string,
    price: number,
    open: number,
    high: number,
    low: number,
    volume: number,
    simulated: boolean,
    metrics?: QuoteMetrics,
    pricing?: { basis: HyperliquidPriceBasis; time: number; referencePrice?: number; metadataTime?: number },
  ) {
    const epoch = this.generation;
    if(this.running&&this.mode==="simulation"&&!simulated)return;
    if (!Number.isFinite(price) || price <= 0) return;
    if (this.sourceMismatch(symbol, simulated)) this.resetSource(symbol);
    if (epoch !== this.generation) return;
    const state = useChartStore.getState();
    const prev = (this.quoteBatch ?? state.quotes)[symbol];
    if (providerOf(symbol) === "kraken" && !simulated && prev?.priceBasis === "trade" && !prev.simulated && pricing && pricing.time < prev.time) return;
    const quote: Quote | undefined = providerOf(symbol) === "hyperliquid" && !simulated
      ? mergeHyperliquidQuote(prev, { symbol, price, basis: pricing?.basis ?? "mark", time: pricing?.time ?? Date.now(),
        referencePrice: pricing?.referencePrice, metadataTime: pricing?.metadataTime, metrics }) : {
      symbol,
      price,
      previous: prev && prev.simulated === simulated ? prev.price : price,
      change: price - open,
      changePercent: open ? ((price - open) / open) * 100 : 0,
      high: metrics ? metrics.range.high ?? 0 : high,
      low: metrics ? metrics.range.low ?? 0 : low,
      volume: metrics ? metrics.volume.base ?? 0 : volume,
      history: [
        ...(prev?.simulated === simulated ? prev.history : []),
        price,
      ].slice(-48),
      time: pricing?.time ?? Date.now(),
      simulated,
      ...(pricing ? { priceBasis: pricing.basis } : {}),
      metrics: metrics ?? basicMetrics(symbol, providerOf(symbol) === "yahoo" && !simulated ? null : volume, null, high, low, simulated ? "simulation" : providerOf(symbol) === "yahoo" ? "session" : "observed"),
    };
    if (!quote) return;
    const markLive =
      !simulated &&
      symbol === state.symbol &&
      state.feedStatus !== "live" &&
      (providerOf(symbol) === "hyperliquid" ? this.hlSocket : providerOf(symbol) === "binance" ? this.socket : null)?.readyState === WebSocket.OPEN;
    if (this.quoteBatch) {
      this.quoteBatch[symbol] = quote;
      this.batchedEvents.push(quote);
      if (markLive) state.set({ feedStatus: "live" });
    } else {
      state.set({
        quotes: { ...state.quotes, [symbol]: quote },
        ...(markLive ? { feedStatus: "live" as const } : {}),
      });
      if (epoch !== this.generation) return;
      if (!this.publish("quote", this.quoteListeners, quote)) return;
    }
  }
  private accept(input: Tick) {
    const epoch = this.generation;
    if(this.running&&this.mode==="simulation"&&!input.simulated)return;
    const provider = providerOf(input.symbol);
    let tick = input;
    if (tick.seq === undefined) {
      const seq = (this.simSeq.get(tick.symbol) ?? 0) + 1;
      this.simSeq.set(tick.symbol, seq);
      tick = { ...tick, seq };
    }
    Object.freeze(tick);
    const state = useChartStore.getState();
    const previous = state.quotes[tick.symbol];
    const transitioned =
      (previous && previous.simulated !== tick.simulated) ||
      this.sourceMismatch(tick.symbol, tick.simulated);
    if (transitioned) {
      this.resetSource(tick.symbol);
    }
    const open =
      previous && !transitioned ? previous.price - previous.change : tick.price;
    const snapshot = !transitioned && !tick.simulated && previous?.metrics && ["24h", "session"].includes(previous.metrics.volume.period) ? previous.metrics : undefined;
    const accumulated = basicMetrics(tick.symbol,
      (previous && !transitioned ? previous.volume : 0) + tick.quantity,
      (previous && !transitioned ? previous.metrics?.volume.quote ?? 0 : 0) + tick.quantity * tick.price,
      Math.max(previous && !transitioned ? previous.high : tick.price, tick.price),
      Math.min(previous && !transitioned ? previous.low : tick.price, tick.price),
      tick.simulated ? "simulation" : "observed");
    this.quote(
      tick.symbol,
      tick.price,
      open,
      Math.max(
        previous && !transitioned ? previous.high : tick.price,
        tick.price,
      ),
      Math.min(
        previous && !transitioned ? previous.low : tick.price,
        tick.price,
      ),
      (previous && !transitioned ? previous.volume : 0) + tick.quantity,
      tick.simulated,
      snapshot ?? accumulated,
      !tick.simulated && (provider === "hyperliquid" || provider === "kraken") ? { basis: "trade", time: tick.time } : undefined,
    );
    if (epoch !== this.generation) return;
    const previousTrades = this.tradesFor(tick.symbol);
    const nextTrades = new Array<Tick>(Math.min(previousTrades.length + 1, 5000));
    nextTrades[0] = tick;
    for (let index = 1; index < nextTrades.length; index++) nextTrades[index] = previousTrades[index - 1];
    this.tradesBySymbol.set(tick.symbol, nextTrades);
    const source = tick.simulated ? "simulation" : "exchange";
    const sourceState = useChartStore.getState();
    const frames = [...this.frames(), ...this.tickFrames];
    const pendingPatch: {
      dataSources?: Record<string, "simulation" | "exchange">;
      trades?: Tick[];
      candles?: OHLCV[];
    } = {};
    if (
      frames.some(
        (tf) => sourceState.dataSources[`${tick.symbol}:${tf}`] !== source,
      )
    ) {
      pendingPatch.dataSources = {
        ...sourceState.dataSources,
        ...Object.fromEntries(
          frames.map((tf) => [`${tick.symbol}:${tf}`, source]),
        ),
      };
    }
    if (tick.symbol === sourceState.symbol) {
      pendingPatch.trades = nextTrades;
    }
    const krakenLiveFrom = this.krakenLiveFrom.get(tick.symbol);
    for (const timeframe of this.frames()) {
      const key = `${tick.symbol}:${timeframe}`;
      if (!tick.simulated && (this.hlCandleSeries.has(key) ||
        tick.time < (this.krakenClosedThrough.get(key) ?? -Infinity))) continue;
      const bars = this.histories.get(key) ?? [];
      const next = aggregateTick(bars, tick, timeframe, MAX_HISTORY_BARS);
      this.histories.set(key, next.bars);
      this.historySources.set(key, tick.simulated);
      if (!tick.simulated && this.krakenGaps.has(key)) continue;
      const bar = next.bars.at(-1);
      if (bar && !this.publish("bar", this.barListeners.get(key), bar)) {
        if (Object.keys(pendingPatch).length > 0 && epoch === this.generation) {
          useChartStore.getState().set(pendingPatch);
        }
        return;
      }
      // Unrequested Kraken intervals also aggregate trades. Only buckets observed
      // from their start may close live after a reconnect, even without REST repair.
      if (next.closed && !transitioned && (tick.simulated || next.closed.time >= (this.krakenClosedThrough.get(key) ?? -Infinity)
        && (provider !== "kraken" || (krakenLiveFrom !== undefined
          && next.closed.time >= nextBucket(timeframe, bucketStart(timeframe, krakenLiveFrom)))))) {
        if (!this.publish("close", this.closeListeners, tick.symbol, timeframe, next.closed, tick.simulated)) {
          if (Object.keys(pendingPatch).length > 0 && epoch === this.generation) {
            useChartStore.getState().set(pendingPatch);
          }
          return;
        }
      }
      if (tick.symbol === sourceState.symbol && timeframe === sourceState.timeframe) {
        pendingPatch.candles = next.bars;
      }
    }
    if (Object.keys(pendingPatch).length > 0 && epoch === this.generation) {
      useChartStore.getState().set(pendingPatch);
    }
    for (const timeframe of this.tickFrames) {
      const key = `${tick.symbol}:${timeframe}`;
      const gap = this.krakenTickGaps.get(key);
      if (gap && !tick.simulated) {
        if (this.krakenLiveFrom.has(tick.symbol) && tick.seq !== undefined && tick.seq > gap.through)
          gap.liveFrom ??= tick.seq;
        continue;
      }
      const buffered = this.tickBuffer.get(key);
      if (buffered) {
        buffered.push(tick);
        continue;
      }
      this.foldTick(key, timeframe, tick, !transitioned);
      if (epoch !== this.generation) return;
    }
    this.publish("trade", this.tickListeners, tick);
  }
  private foldTick(
    key: string,
    timeframe: Timeframe,
    tick: Tick,
    emitClose: boolean,
  ) {
    const perBar = tickCount(timeframe);
    const kraken = !tick.simulated && tick.symbol.startsWith("KRK:") && tick.seq !== undefined;
    if (!perBar || kraken && tick.seq! <= (this.krakenTickThrough.get(key) ?? -Infinity)) return;
    const previous = this.tickStates.get(key) ?? { bars: [], group: null };
    const result = aggregateTickBars(
      previous,
      { price: tick.price, quantity: tick.quantity, seq: tick.seq ?? 0, time: tick.time },
      perBar,
      MAX_HISTORY_BARS,
    );
    const repairedClose = kraken && result.closed && previous.group === this.krakenSilentTickClose.get(key);
    if (kraken && result.state !== previous) this.krakenTickThrough.set(key, tick.seq!);
    if (repairedClose) this.krakenSilentTickClose.delete(key);
    this.tickStates.set(key, result.state);
    this.historySources.set(key, tick.simulated);
    const bar = result.state.bars.at(-1);
    if (bar && !this.publish("bar", this.barListeners.get(key), bar)) return;
    if (result.closed && emitClose && !repairedClose)
      if (!this.publish("close", this.closeListeners, tick.symbol, timeframe, result.closed, tick.simulated)) return;
    const state = useChartStore.getState();
    if (tick.symbol === state.symbol && timeframe === state.timeframe)
      state.set({ candles: result.state.bars });
  }
  private resetSource(symbol: string) {
    this.tradesBySymbol.delete(symbol);
    for (const timeframe of [...this.frames(), ...this.tickFrames]) {
      const key = `${symbol}:${timeframe}`;
      this.histories.delete(key);
      this.liveHistory.delete(key);
      this.historySources.delete(key);
      this.tickStates.delete(key);
      this.krakenTickThrough.delete(key);
      this.krakenSilentTickClose.delete(key);
      if (this.krakenTickGaps.delete(key)) this.recoveryStatus(key, null);
      this.krakenClosedThrough.delete(key);
      this.tickFirstGroup.delete(key);
    }
    const state = useChartStore.getState();
    state.set({
      marketEpochs: {
        ...state.marketEpochs,
        [symbol]: (state.marketEpochs[symbol] ?? 0) + 1,
      },
      ...(symbol === state.symbol
        ? { trades: [], orderBook: null, feedEpoch: state.feedEpoch + 1 }
        : {}),
    });
  }
  onBook(cb:(book:OrderBook)=>void){this.bookListeners.add(cb);return()=>{this.bookListeners.delete(cb);};}
  reconnect(): boolean {
    if (!this.running || this.mode !== "auto") return false;
    useChartStore.getState().set({ feedStatus: "reconnecting" });
    if (useAlpacaStore.getState().enabled) { this.iexStream?.stop(); this.iexStream = null; this.invalidateIex(); this.startIex(this.generation); }
    this.refreshQuoteSubscriptions();
    return true;
  }
  onTick(cb: (tick: Tick) => void) {
    this.tickListeners.add(cb);
    return () => {
      this.tickListeners.delete(cb);
    };
  }
  /** Provider OHLCV updates without a classified execution; delivered after all derived series are updated. */
  onCandleUpdate(cb: (symbol: string) => void) { this.candleListeners.add(cb); return () => { this.candleListeners.delete(cb); }; }
  /** Every quote refresh, including quote-only symbols that stream no trades. */
  onQuote(cb: (quote: Quote) => void) {
    this.quoteListeners.add(cb);
    return () => {
      this.quoteListeners.delete(cb);
    };
  }
  onClose(cb: CloseListener) {
    this.closeListeners.add(cb);
    return () => {
      this.closeListeners.delete(cb);
    };
  }
  subscribe(symbol: string, timeframe: Timeframe, cb: BarListener) {
    this.track(timeframe);
    this.nativeHyperliquidCandles(symbol, timeframe);
    const key = `${symbol}:${timeframe}`;
    const listeners = this.barListeners.get(key) ?? new Set();
    listeners.add(cb);
    this.barListeners.set(key, listeners);
    return () => {
      listeners.delete(cb);
    };
  }
  /**
   * Fetch candles without touching any chart state or cache: for screeners,
   * comparisons and other readers that only need the bars once.
   */
  async fetchBars(
    symbol: string,
    timeframe: Timeframe,
    count: number,
    end?: number,
  ): Promise<OHLCV[]> {
    if(this.mode==="simulation")return this.syntheticHistory(symbol,timeframe,count,end);
    const provider = providerOf(symbol);
    if (provider === "alpaca") return (await loadIexBars(symbol, timeframe, count, end)).bars;
    if (provider === "kraken") {
      const bars = await loadKrakenClosedBars(tickerOf(symbol), timeframe);
      return (end === undefined ? bars : bars.filter(bar => bar.time <= end)).slice(-count);
    }
    if (provider === "hyperliquid")
      return loadHyperliquidBars({ coin: tickerOf(symbol), timeframe, count, end });
    if (provider === "yahoo") {
      const settings = useChartStore.getState();
      const loaded = await loadYahooBars({
          ticker: tickerOf(symbol),
          timeframe,
          count,
          end,
          extended: settings.session === "extended",
          adjustDividends: settings.adjustDividends,
        });
      if (loaded.meta?.sessions) registerMarketSessions(symbol, loaded.meta.sessions, settings.session === "extended" ? "extended" : "regular");
      return loaded.bars;
    }
    return loadKlines(browserKlinePager, { symbol, timeframe, count, end });
  }
  /** The currently collected bars for a series, if any history was loaded. */
  barsFor(symbol: string, timeframe: Timeframe): OHLCV[] {
    const key = `${symbol}:${timeframe}`;
    if (this.krakenGaps.has(key) || this.krakenTickGaps.has(key) || this.hlGaps.has(key) || this.hlAwaitingCandles.has(key)) return [];
    return (
      (isTickInterval(timeframe)
        ? this.tickStates.get(key)?.bars
        : this.histories.get(key)) ?? []
    );
  }
  async history(
    symbol: string,
    timeframe: Timeframe,
    count = 600,
    end?: number,
  ): Promise<OHLCV[]> {
    this.track(timeframe);
    if (this.mode !== "simulation" && providerOf(symbol) === "alpaca") return this.iexHistory(symbol, timeframe, count, end);
    count = Math.max(1, Math.min(MAX_HISTORY_BARS, Math.floor(count)));
    if (this.mode !== "simulation" && providerOf(symbol) === "kraken") {
      if (isTickInterval(timeframe)) {
        const key = `${symbol}:${timeframe}`;
        const gap = this.krakenTickGaps.get(key);
        if (gap) {
          const bars = end !== undefined && end < gap.from
            ? this.tickStates.get(key)?.bars ?? [] : await this.recoverKrakenTicks(key, gap);
          return (end === undefined ? bars : bars.filter(bar => bar.time <= end)).slice(-count);
        }
        if (end !== undefined) return this.tickHistory(symbol, timeframe, count, end);
        const requestKey = `${this.krakenConnection}:kraken-ticks:${key}`;
        let pending = this.pending.get(requestKey);
        if (!pending) {
          pending = this.tickHistory(symbol, timeframe, MAX_HISTORY_BARS).finally(() => {
            if (this.pending.get(requestKey) === pending) this.pending.delete(requestKey);
          });
          this.pending.set(requestKey, pending);
        }
        return (await pending).slice(-count);
      }
      const key = `${symbol}:${timeframe}`, epoch = this.generation, connection = this.krakenConnection;
      const gap = this.krakenGaps.get(key);
      if (gap) {
        // Backward paging must obey the same recovery barrier as a current
        // history request. Only the prefix strictly before the interrupted
        // candle is safe to read without waiting for the connected REST repair.
        const bars = end !== undefined && end < gap.from
          ? this.histories.get(key) ?? [] : await this.recoverKraken(key);
        return (end === undefined ? bars : bars.filter(bar => bar.time <= end)).slice(-count);
      }
      if (!this.liveHistory.has(key)) {
        let closed: OHLCV[] = [];
        const metadata = this.krakenTickSizes.has(symbol) ? Promise.resolve() :
          loadKrakenTradingIncrements(tickerOf(symbol)).then(({ tickSize }) => {
            if (epoch !== this.generation) return;
            this.krakenTickSizes.set(symbol, tickSize);
            if (this.krakenTickSizes.size > 128) this.krakenTickSizes.delete(this.krakenTickSizes.keys().next().value!);
          }).catch(() => {});
        try { [closed] = await Promise.all([loadKrakenClosedBars(tickerOf(symbol), timeframe), metadata]); } catch {
          if (!this.histories.get(key)?.length) throw new Error("Kraken candle history is temporarily unavailable.");
        }
        if (epoch !== this.generation) return [];
        // Initial loads can outlive their socket too. They must not publish an
        // old snapshot or return partially aggregated bars through an active gap.
        if (connection !== this.krakenConnection)
          throw new Error("The Kraken connection changed during history loading.");
        const last = closed.at(-1);
        if (last && nextBucket(timeframe, last.time) > (this.krakenClosedThrough.get(key) ?? -Infinity)) {
          const cutoff = nextBucket(timeframe, last.time);
          const live = this.histories.get(key) ?? [];
          this.histories.set(key, [...closed, ...live.filter(bar => bar.time >= cutoff)].slice(-MAX_HISTORY_BARS));
          this.historySources.set(key, false);
          this.krakenClosedThrough.set(key, cutoff);
          this.liveHistory.add(key);
        }
      }
      const bars = this.histories.get(key) ?? [];
      return (end === undefined ? bars : bars.filter(bar => bar.time <= end)).slice(-count);
    }
    const gap = this.hlGaps.get(`${symbol}:${timeframe}`);
    if (end === undefined && gap) return (await this.recoverHyperliquid(symbol, timeframe, gap.from)).slice(-count);
    if (this.mode!=="simulation"&&providerOf(symbol) === "yahoo")
      return this.yahooHistory(symbol, timeframe, count, end);
    if (this.mode!=="simulation"&&providerOf(symbol) === "hyperliquid" && !isTickInterval(timeframe))
      return this.hyperliquidHistory(symbol, timeframe, count, end);
    if (isTickInterval(timeframe))
      return this.tickHistory(symbol, timeframe, count, end);
    const key = `${symbol}:${timeframe}`;
    const requestKey = `${key}:${count}:${end ?? ""}`;
    const epoch = this.generation;
    const existing = this.histories.get(key);
    if (
      !end &&
      existing &&
      existing.length >= count &&
      (this.mode === "simulation" || this.liveHistory.has(key))
    ) {
      const state = useChartStore.getState();
      if (state.symbol === symbol && state.timeframe === timeframe)
        state.set({ candles: existing });
      return existing.slice(-count);
    }
    const pending = this.pending.get(requestKey);
    if (pending) return pending;
    const task = (async () => {
      let bars: OHLCV[] = [];
      if (this.mode !== "simulation")
        try {
          bars = await loadKlines(browserKlinePager, {
            symbol,
            timeframe,
            count,
            end,
          });
          if (epoch === this.generation && bars.length)
            this.liveHistory.add(key);
        } catch {
          bars = [];
        }
      let simulated = this.mode === "simulation";
      if (!bars.length) {
        const quote = useChartStore.getState().quotes[symbol];
        const collected = this.histories.get(key);
        if (
          this.mode === "auto" &&
          quote &&
          !quote.simulated &&
          collected?.length &&
          this.historySources.get(key) === false
        ) {
          bars = [...collected];
        } else if (
          this.mode === "auto" &&
          (!this.symbols.includes(symbol) || (quote && !quote.simulated))
        ) {
          bars = [];
        } else {
          simulated = true;
          bars = this.syntheticHistory(symbol, timeframe, count, end);
          if (
            epoch === this.generation &&
            symbol === useChartStore.getState().symbol
          )
            useChartStore.getState().set({ feedStatus: "simulation" });
        }
      }
      if (
        this.mode === "auto" &&
        useChartStore.getState().quotes[symbol]?.simulated
      ) {
        simulated = true;
        bars = this.syntheticHistory(symbol, timeframe, count, end);
        this.liveHistory.delete(key);
      }
      if (epoch !== this.generation) return bars;
      if (!end) {
        const tail = this.histories.get(key) ?? [];
        const sameSource = this.historySources.get(key) === simulated;
        const merged = new Map(bars.map((b) => [b.time, b]));
        if (sameSource)
          for (const b of tail)
            if (b.time > (bars.at(-1)?.time ?? 0)) merged.set(b.time, b);
        bars = [...merged.values()]
          .sort((a, b) => a.time - b.time)
          .slice(-MAX_HISTORY_BARS);
        this.histories.set(key, bars);
        this.historySources.set(key, simulated);
        const sourceState = useChartStore.getState();
        sourceState.set({
          dataSources: {
            ...sourceState.dataSources,
            [key]: simulated ? "simulation" : "exchange",
          },
        });
        const state = useChartStore.getState();
        if (symbol === state.symbol && timeframe === state.timeframe)
          state.set({ candles: bars });
      }
      return bars;
    })();
    this.pending.set(requestKey, task);
    try {
      return await task;
    } finally {
      this.pending.delete(requestKey);
    }
  }
  private async tickHistory(
    symbol: string,
    timeframe: Timeframe,
    count: number,
    end?: number,
  ): Promise<OHLCV[]> {
    const key = `${symbol}:${timeframe}`;
    const perBar = tickCount(timeframe);
    const epoch = this.generation;
    const kraken = this.mode !== "simulation" && providerOf(symbol) === "kraken";
    const connection = this.krakenConnection;
    const publish = (state: TickBarState, simulated: boolean) => {
      this.tickStates.set(key, state);
      this.historySources.set(key, simulated);
      const store = useChartStore.getState();
      store.set({
        dataSources: {
          ...store.dataSources,
          [key]: simulated ? "simulation" : "exchange",
        },
      });
      if (symbol === store.symbol && timeframe === store.timeframe)
        store.set({ candles: state.bars });
    };
    const current = this.tickStates.get(key);
    if (end !== undefined) {
      const first = current?.bars[0];
      if (!current || !first || end >= first.time)
        return current?.bars.filter((b) => b.time <= end) ?? [];
      const firstGroup = this.tickFirstGroup.get(key);
      if (this.mode === "simulation" || firstGroup === undefined || firstGroup <= 0)
        return [];
      try {
        const older = await loadTradeBackfill(
          browserTradePager,
          symbol,
          perBar * count,
          6,
          firstGroup * perBar,
        );
        if (epoch !== this.generation) return [];
        const built = barsFromTrades(
          older.map((t) => ({ price: Number(t.p), quantity: Number(t.q), seq: t.a })),
          perBar,
          first.time - TICK_BAR_SPACING,
        );
        if (!built.bars.length) return [];
        const bars = [...built.bars, ...current.bars].slice(-MAX_HISTORY_BARS);
        this.tickFirstGroup.set(key, firstGroup - built.bars.length);
        publish({ bars, group: current.group }, false);
        return built.bars;
      } catch {
        return [];
      }
    }
    if (current && current.bars.length >= Math.min(count, 2) && (this.mode==="simulation"||this.liveHistory.has(key)))
      return current.bars.slice(-count);
    const buffered: Tick[] = [];
    this.tickBuffer.set(key, buffered);
    try {
      let result: TickBarState | null = null;
      let seededThrough = -Infinity;
      let simulated = this.mode === "simulation";
      if (kraken && !current?.bars.length) {
        try {
          const recent = await loadKrakenRecentTrades(tickerOf(symbol), perBar * (count + 1));
          const latest = recent.at(-1);
          if (latest) {
            result = barsFromTrades(recent, perBar, latest.time);
            seededThrough = latest.seq;
          }
        } catch { /* Continue from observed live trades when history is unavailable. */ }
      }
      if (!simulated && providerOf(symbol) === "binance")
        try {
          const loaded = await loadTickBars(
            browserTradePager,
            symbol,
            perBar,
            count,
          );
          if (loaded.state.bars.length) {
            result = loaded.state;
            const lastGroup = loaded.state.group ?? 0;
            this.tickFirstGroup.set(
              key,
              lastGroup - (loaded.state.bars.length - 1),
            );
          }
        } catch {
          result = null;
        }
      if (!result) {
        const quote = useChartStore.getState().quotes[symbol];
        if (current?.bars.length && this.historySources.get(key) === false) {
          result = current;
        } else if (
          this.mode!=="simulation"&&providerOf(symbol) !== "binance" ||
          (this.mode === "auto" &&
            (!this.symbols.includes(symbol) || (quote && !quote.simulated)))
        ) {
          // A market without usable history can still aggregate observed trades.
          result = { bars: [], group: null };
        } else {
          simulated = true;
          const base = this.syntheticHistory(symbol, "1m", count, Date.now());
          const anchor = Math.floor(Date.now() / TICK_BAR_SPACING) * TICK_BAR_SPACING;
          result = {
            bars: base.map((b, i) => ({
              ...b,
              time: anchor - (base.length - 1 - i) * TICK_BAR_SPACING,
            })),
            group: base.length - 1,
          };
          this.simSeq.set(symbol, Math.max(this.simSeq.get(symbol)??0,base.length * perBar));
          this.tickFirstGroup.set(key, 0);
        }
      }
      if (epoch !== this.generation) return result.bars;
      if (kraken && connection !== this.krakenConnection)
        throw new Error("The Kraken connection changed during tick history loading.");
      if (!simulated && result.bars.length) this.liveHistory.add(key);
      let through = Math.max(seededThrough, this.krakenTickThrough.get(key) ?? -Infinity);
      this.tickBuffer.delete(key);
      let state = result;
      if (kraken) buffered.sort((a, b) => (a.seq ?? -1) - (b.seq ?? -1));
      for (const tick of buffered) {
        if (kraken && (tick.seq ?? -1) <= through) continue;
        state = aggregateTickBars(
          state,
          { price: tick.price, quantity: tick.quantity, seq: tick.seq ?? 0, time: tick.time },
          perBar,
          MAX_HISTORY_BARS,
        ).state;
        if (kraken && tick.seq !== undefined) through = tick.seq;
      }
      if (kraken && through !== -Infinity) this.krakenTickThrough.set(key, through);
      publish(state, simulated);
      return state.bars.slice(-count);
    } finally {
      if (this.tickBuffer.get(key) === buffered) this.tickBuffer.delete(key);
    }
  }
  readonly velaFeed: MarketDataFeed = {
    load: (cfg) =>
      this.history(
        stripVenue(cfg.symbol ?? "BTCUSDT"),
        normalizeTimeframe(cfg.timeframe ?? "15m"),
        cfg.bars ?? 600,
      ),
    subscribe: (cfg, cb) => {
      const symbol = stripVenue(cfg.symbol ?? "BTCUSDT");
      const timeframe = normalizeTimeframe(cfg.timeframe ?? "15m");
      let delivered: { from: number; bars: OHLCV[] } | undefined;
      return this.subscribe(symbol, timeframe, bar => {
        const repair = providerOf(symbol) === "kraken" ? this.hlRepairPublication.get(`${symbol}:${timeframe}`) : undefined;
        if (!repair) { cb(bar); return; }
        if (repair === delivered) return;
        delivered = repair;
        cb({ ...repair.bars.at(-1)!, [Symbol.for("affentrader.vela.candle-repair")]: repair });
      });
    },
    loadRange: (cfg, range) => {
      const symbol = stripVenue(cfg.symbol ?? "BTCUSDT"), timeframe = normalizeTimeframe(cfg.timeframe ?? "15m");
      const repair = this.hlRepairPublication.get(`${symbol}:${timeframe}`);
      if (range.to === undefined && typeof range.from === "number" && repair && range.from >= repair.from)
        return Promise.resolve(repair.bars.filter(bar => bar.time >= range.from!).slice(0, range.limit ?? MAX_HISTORY_BARS));
      if (range.to === undefined && typeof range.from === "number" && Number.isFinite(range.from)
        && this.hlCandleSeries.has(`${symbol}:${timeframe}`)) {
        const publication = this.hlRepairPublication.get(`${symbol}:${timeframe}`);
        if (publication && range.from >= publication.from)
          return Promise.resolve(publication.bars.filter(bar => bar.time >= range.from!).slice(0, range.limit ?? MAX_HISTORY_BARS));
        return this.recoverHyperliquid(symbol, timeframe, bucketStart(timeframe, range.from))
          .then(bars => bars.filter(bar => bar.time >= range.from!).slice(0, range.limit ?? MAX_HISTORY_BARS));
      }
      const epoch = this.generation, marketEpoch = useChartStore.getState().marketEpochs[symbol] ?? 0;
      const key = `${symbol}:${timeframe}`, source = this.historySources.get(key);
      return this.history(symbol, timeframe, Math.min(range.limit ?? 600, MAX_HISTORY_BARS), range.to).then(page => {
        // Native backward paging extends the same loaded series. Keep its older
        // bars for Replay/header/technicals without replaying market events.
        if (range.to === undefined || !page.length || !this.running || epoch !== this.generation
          || marketEpoch !== (useChartStore.getState().marketEpochs[symbol] ?? 0)
          || source === undefined || source !== this.historySources.get(key)) return page;
        const current = this.histories.get(key);
        if (!current?.length) return page;
        const merged = new Map(page.map(bar => [bar.time, bar]));
        for (const bar of current) merged.set(bar.time, bar);
        if (merged.size === current.length) return page;
        const bars = [...merged.values()].sort((a, b) => a.time - b.time).slice(-MAX_HISTORY_BARS);
        this.histories.set(key, bars);
        const state = useChartStore.getState();
        if (state.symbol === symbol && state.timeframe === timeframe) state.set({ candles: bars });
        return page;
      });
    },
    symbolInfo: (cfg) => {
      const symbol = stripVenue(cfg.symbol ?? "BTCUSDT");
      if (providerOf(symbol) === "hyperliquid") {
        const price = useChartStore.getState().quotes[symbol]?.price ?? this.hlMarks.get(symbol) ?? this.histories.get(`${symbol}:${useChartStore.getState().timeframe}`)?.at(-1)?.close ?? 1;
        const mintick = priceTick(price, this.hlSzDecimals.get(symbol) ?? 0);
        return {
          ticker: symbol,
          type: "futures",
          timezone: "Etc/UTC",
          mintick,
          pricescale: Math.round(1 / mintick),
          currency: "USD",
          session: "24x7",
        };
      }
      if (providerOf(symbol) === "kraken") return { ticker: symbol, type: "crypto", timezone: "Etc/UTC", currency: tickerOf(symbol).split("/")[1], session: "24x7", mintick: this.krakenTickSizes.get(symbol) };
      if (providerOf(symbol) === "alpaca") return { ticker: symbol, type: "stock", timezone: "America/New_York", mintick: 0.01, pricescale: 100, currency: "USD", session: "regular" };
      if (providerOf(symbol) === "yahoo") {
        const info = symbolInfo(symbol);
        const price = useChartStore.getState().quotes[symbol]?.price ?? 100;
        const mintick = price < 10 ? 0.0001 : 0.01;
        return {
          ticker: symbol,
          type: info?.type === "forex" ? "forex" : info?.type === "future" ? "futures" : "stock",
          timezone: info?.timezone || "Etc/UTC",
          mintick,
          pricescale: Math.round(1 / mintick),
          currency: info?.currency || "USD",
          session: info?.type === "forex" || info?.type === "future" ? "24x5" : "regular",
        };
      }
      return {
        ticker: symbol,
        type: "crypto",
        timezone: "Etc/UTC",
        mintick: getSymbol(symbol).seedPrice < 1 ? 0.000001 : 0.01,
        pricescale: 100,
        currency: "USDT",
        session: "24x7",
      };
    },
  };
}
/** Remove a venue prefix such as `BINANCE:`, keeping the `YF:` and `HL:` provider tags. */
export function stripVenue(symbol: string): string {
  return symbol.startsWith("YF:") || symbol.startsWith("HL:") || providerOf(symbol) === "alpaca" || providerOf(symbol) === "kraken" ? symbol : symbol.replace(/^.*:/, "");
}
export function normalizeTimeframe(tf: string): Timeframe {
  return normalizeInterval(tf, "15m");
}
export const marketService = new MarketService();

