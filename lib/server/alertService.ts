import type { AlertRule, RuleEvent } from "@/types/alerts";
import {
  isQuoteOnly,
  requiredViews,
  requiredHistoryViews,
  requiredQuoteRanges,
  ruleMessage,
  validateRuleShape,
  type MarketView,
} from "@/lib/alerts/rules";
import { isValidInterval } from "@/lib/market/intervals";
import { bybitMarket, bybitSymbol, isSymbolId, providerOf, tickerOf } from "@/lib/symbolId";
import { BYBIT_NATIVES } from "@/lib/market/bybit";
import { bybitServerPager, bybitTickers } from "@/lib/server/bybit";
import { loadHyperliquidBars } from "@/lib/market/hyperliquidClient";
import { parseCandles } from "@/lib/market/hyperliquid";
import { loadYahooBars } from "@/lib/market/yahooClient";
import { registerMarketSessions } from "@/lib/market/sessionWindows";
import { TpoCandlePool, type TpoCandleSnapshot } from "@/lib/orderflow/tpoCandleSource";
import { requiredTpoHistory, tpoAlertQuery, tpoHistoryKey, tpoSettingsTape, type TpoHistoryView } from "@/lib/alerts/tpoSource";
import { hyperliquidAssets, hyperliquidCandles, hyperliquidRange } from "./hyperliquid";
import { loadKrakenClosedBars } from "@/lib/market/kraken";
import { basicMetrics, nonnegative, pendingRange } from "@/lib/market/quoteMetrics";
import { stepRule, type RuleRuntimeState } from "@/lib/alerts/runtime";
import { closesOnly, completedWatchlist, isExpired, oneShot, scopeFinished, timingFields } from "@/lib/alerts/schedule";
import { watchlistMembers } from "@/lib/alerts/dependencies";
import { admitTrigger, restartRule, resumeRate, scopeStopped } from "@/lib/alerts/rateLimit";
import { pineSnapshot, pineEvent, pineSeries } from "@/lib/alerts/pineRules";
import { PineJournalSession } from "@/lib/alerts/pineJournal";
import { pineRunEpoch, pineOwner, pineMarketSource } from "@/lib/alerts/pineRecoveryState";
import { loadPineJournal, appendPineJournal, acknowledgePineJournal, prunePineJournals } from "./pineJournalStore";
import type { PineSeries, PineSignal, PineDeliveryBatch } from "@/types/pineAlerts";
import { drawingCondition, drawingFingerprint, drawingSourceRevision, drawingSync, validateDrawingGeometry } from "@/lib/alerts/drawing";
import type { DrawingAlertGeometry } from "@/types/drawingAlerts";
import { yahooChart, yahooSpark } from "./yahoo";
import { loadKlines, MAX_HISTORY_BARS } from "@/lib/market/klines";
import { binanceJson, serverKlinePager } from "./exchange";
import { sendPush } from "./push";
import type { OHLCV } from "@/types/trading";
import { JsonStore } from "./storage";
import {trackedActivity,editedActivity,triggeredActivity,expirationReason} from "@/lib/alerts/lifecycle";
import {
  deliverWebhook,
  MAX_ATTEMPTS,
  parseWebhookUrl,
  RETRY_DELAYS,
  WebhookError,
} from "./webhooks";

export interface StoredEvent extends RuleEvent {
  seq: number;
}
export interface AlertDb {
  rules: AlertRule[];
  events: StoredEvent[];
  seq: number;
  /** Edge state per `ruleId:symbol`, so a restart does not re-fire held conditions. */
  edges: Record<string, RuleRuntimeState>;
  /** Webhook credentials are kept server-side only. */
}

export const MAX_RULES = 200;
export const MAX_EVENTS = 1000;
export const MAX_WATCHLIST_SYMBOLS = 1000;

export const store = new JsonStore<AlertDb>("alerts", () => ({
  rules: [],
  events: [],
  seq: 0,
  edges: {},
}));


/** Validate and normalize a rule received over the network. */
export function validateRule(input: unknown): AlertRule {
  const fail = (message: string): never => {
    throw new WebhookError(message);
  };
  const shapeError = validateRuleShape(input);
  if (shapeError) fail(shapeError);
  const r = input as AlertRule;
  if (!isValidInterval(r.scope.timeframe) || r.scope.timeframe.endsWith("T"))
    fail("Server rules need a time-based interval.");
  const leafSymbols: unknown[] = [];
  const leafIntervals: string[] = [];
  const walk = (node: AlertRule["condition"]) => {
    if (node.op === "leaf") {
      leafSymbols.push(node.leaf.symbol);
      if (node.leaf.timeframe) leafIntervals.push(node.leaf.timeframe);
    }
    else node.conditions.forEach(walk);
  };
  walk(r.condition);
  if (leafIntervals.some(interval => interval.endsWith("T"))) fail("Server conditions need time-based intervals.");
  const everySymbol = [
    ...(r.scope.type === "symbol" ? [r.scope.symbol] : r.scope.symbols),
    ...leafSymbols.filter(Boolean),
  ];
  if (!everySymbol.every((s) => typeof s === "string" && isSymbolId(s)))
    fail("Invalid symbol.");
  if (everySymbol.some(symbol => typeof symbol === "string" && providerOf(symbol) === "alpaca")) fail("IEX credentials are session-only. Use browser alerts while this tab is connected; server alerts cannot use this feed.");
  if (r.webhook) {
    if (typeof r.webhook.url !== "string") fail("Invalid webhook.");
    parseWebhookUrl(r.webhook.url);
    if (r.webhook.secret !== undefined && (typeof r.webhook.secret !== "string" || r.webhook.secret.length > 200))
      fail("Invalid webhook secret.");
  }
  return {
    id: r.id,
    name: r.name.trim(),
    kind: r.kind,
    status: r.status,
    scope: structuredClone(r.scope),
    condition: structuredClone(r.condition),
    frequency: r.frequency,
    repeat: Boolean(r.repeat),
    ...(r.trigger ? timingFields(r.trigger) : {}),
    expiresAt: r.expiresAt,
    activity:r.activity?structuredClone(r.activity):undefined,
    expiration:r.expiration?{...r.expiration}:undefined,
    triggeredSymbols: r.triggeredSymbols,
    lastFired: r.lastFired,
    scriptState: r.scriptState,
    pineEpoch: r.kind === "pine" ? r.pineEpoch ?? crypto.randomUUID() : undefined,
    drawingIssue:r.drawingIssue,
    drawingRevision:r.drawingRevision,
    pineMemberEpochs: r.pineMemberEpochs,
    pineCursors: r.pineCursors,
    rate: r.rate,
    stop: r.stop,
    cooldownMs: r.cooldownMs,
    message: r.message?.trim() || undefined,
    sound: Boolean(r.sound),
    browserNotification: Boolean(r.browserNotification),
    serverSide: true,
    webhook: r.webhook ? { url: r.webhook.url, secret: r.webhook.secret || undefined } : undefined,
    createdAt: Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
    lastTriggeredAt: Number.isFinite(r.lastTriggeredAt) ? r.lastTriggeredAt : undefined,
  };
}
export async function upsertRule(rule: AlertRule): Promise<AlertRule> {
  const clean = validateRule(rule);
  await store.update((db) => {
    const index = db.rules.findIndex((r) => r.id === clean.id);
    if (index < 0 && db.rules.length >= MAX_RULES)
      throw new WebhookError(`The server keeps at most ${MAX_RULES} rules.`);
    const previous=index>=0?db.rules[index]:undefined;
    clean.activity=editedActivity(previous??{},Date.now());
    clean.expiration=undefined;
    if(previous)clean.createdAt=previous.createdAt;
    if (index >= 0) db.rules[index] = clean;
    else db.rules.push(clean);
    for (const key of Object.keys(db.edges)) if (key.startsWith(`${clean.id}:`)) delete db.edges[key];
  });
  return clean;
}

export async function deleteRule(id: string): Promise<boolean> {
  let removed = false;
  await store.update((db) => {
    const before = db.rules.length;
    db.rules = db.rules.filter((r) => r.id !== id);
    removed = db.rules.length < before;
    for (const key of Object.keys(db.edges)) if (key.startsWith(`${id}:`)) delete db.edges[key];
  });
  return removed;
}

/** Geometry-only compare-and-swap retains live counters, status, membership and secrets. */
export async function updateLinkedDrawing(id:string,expected:string,geometry:DrawingAlertGeometry|null,now=Date.now()):Promise<AlertRule>{
  if(typeof expected!=="string"||expected.length>100)throw new WebhookError("Invalid drawing revision.");
  if(geometry!==null){const error=validateDrawingGeometry(geometry);if(error)throw new WebhookError(error);}
  let saved!:AlertRule;
  await store.update(draft=>{
    const current=draft.rules.find(rule=>rule.id===id),condition=current&&drawingCondition(current);
    if(!current||!condition)throw new WebhookError("Drawing alert not found.");
    if(drawingSourceRevision(current)!==expected)throw new WebhookError("The server drawing changed. Refresh before updating it.");
    if(geometry&&(geometry.id!==condition.geometry.id||geometry.type!==condition.geometry.type||geometry.chartCellId!==condition.geometry.chartCellId))throw new WebhookError("A linked drawing update must retain its identity, chart context and tool type.");
    const patch=drawingSync(current,geometry??undefined,now);saved=patch?{...current,...patch}:current;
    draft.rules[draft.rules.indexOf(current)]=saved;
    if(patch)for(const key of Object.keys(draft.edges))if(key.startsWith(`${id}:`))draft.edges[key]={...draft.edges[key],drawing:undefined,quotes:undefined,closedAt:undefined,initialized:false};
  });return saved;
}

/** Membership-only updates retain firing gates and completed members of remaining symbols. */
export async function updateWatchlistMembers(id: string, symbols: unknown, now = Date.now()): Promise<AlertRule> {
  if (!Array.isArray(symbols) || symbols.length > 1000 || !symbols.every(symbol => typeof symbol === "string" && isSymbolId(symbol))) throw new WebhookError("Invalid watchlist members.");
  let saved!: AlertRule;
  await store.update(draft => {
    const index = draft.rules.findIndex(rule => rule.id === id && rule.scope.type === "watchlist");
    if (index < 0) throw new WebhookError("Watchlist alert not found.");
    saved = watchlistMembers(draft.rules[index], symbols, now);
    draft.rules[index] = saved;
    for (const key of Object.keys(draft.edges)) if (key.startsWith(`${id}:`) && !symbols.includes(key.slice(id.length + 1))) delete draft.edges[key];
  });
  return saved;
}

export type AlertControl = "pause" | "resume" | "restart" | "restart_symbols";
/** Narrow state changes retain the server's current counters, members and webhook credentials. */
export async function controlRule(id: string, action: AlertControl, now = Date.now()): Promise<AlertRule> {
  if (!["pause", "resume", "restart", "restart_symbols"].includes(action)) throw new WebhookError("Unknown alert action.");
  let saved!: AlertRule;
  await store.update(draft => {
    const index = draft.rules.findIndex(rule => rule.id === id);
    if (index < 0) throw new WebhookError("Alert not found.");
    const rule = draft.rules[index];
    if (action !== "pause" && isExpired(rule, now)) throw new WebhookError("Edit the expiration before restarting this alert.");
    if (action === "pause" || action === "resume") {
      if (action === "pause" && rule.status !== "active" || action === "resume" && rule.status !== "paused") throw new WebhookError("This alert needs an explicit restart.");
      saved = { ...rule, status: action === "pause" ? "paused" : "active", ...(action === "resume" ? { rate: resumeRate(rule.rate, now) } : {}) };
    } else {
      try { saved = restartRule(rule, now, action === "restart_symbols"); }
      catch (error) { throw new WebhookError(error instanceof Error ? error.message : "Cannot restart alert."); }
    }
    draft.rules[index] = saved;
    // Every explicit resume starts a fresh observation baseline, preserving frequency gates below.
    if (action !== "pause") for (const [key, edge] of Object.entries(draft.edges)) if (key.startsWith(`${id}:`)) {
      if (action === "restart" || action === "restart_symbols" && Object.hasOwn(rule.rate?.stoppedSymbols ?? {}, key.slice(id.length + 1))) delete draft.edges[key];
      else if (action !== "restart_symbols") draft.edges[key] = { ...edge, quotes: undefined, closedAt: undefined, initialized: false };
    }
  });
  return saved;
}

/** Webhook secrets never leave the server. */
export function publicRule(rule: AlertRule): AlertRule {
  return rule.webhook?.secret
    ? { ...rule, webhook: { url: rule.webhook.url, secret: "••••••••" } }
    : rule;
}

export async function listEvents(after = 0, limit = 200): Promise<{ events: StoredEvent[]; cursor: number }> {
  const db = await store.read();
  const events = db.events
    .filter((e) => e.seq > after)
    .slice(-limit)
    .map((e) => {
      // Queued webhook credentials stay on the server.
      const { webhook: _webhook, ...rest } = e as StoredEvent & { webhook?: unknown };
      void _webhook;
      return rest;
    });
  return { events, cursor: db.seq };
}

export async function recordEvent(
  event: Omit<RuleEvent, "id">,
  webhook?: AlertRule["webhook"],
): Promise<StoredEvent> {
  let stored!: StoredEvent;
  await store.update((db) => {
    stored = appendEvent(db, event, webhook);
  });
  return stored;
}
function appendEvent(db: AlertDb, event: Omit<RuleEvent, "id">, webhook?: AlertRule["webhook"]): StoredEvent {
  db.seq++;
  const stored: StoredEvent = { ...event, id: `evt-${db.seq}`, seq: db.seq,
    delivery: webhook ? { status: "pending", attempts: 0, nextAttemptAt: event.time } : { status: "none", attempts: 0 } };
  if (webhook) (stored as StoredEvent & { webhook?: AlertRule["webhook"] }).webhook = webhook;
  db.events.push(stored);
  if (db.events.length > MAX_EVENTS) db.events.splice(0, db.events.length - MAX_EVENTS);
  return stored;
}

/** Attempt every due delivery; failed ones are rescheduled with backoff. */
export async function processDeliveries(
  now = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const db = await store.read();
  const due = db.events.filter(
    (e) => e.delivery?.status === "pending" && (e.delivery.nextAttemptAt ?? 0) <= now,
  );
  let delivered = 0;
  for (const event of due) {
    const rule = db.rules.find((r) => r.id === event.ruleId);
    const webhook = rule?.webhook ?? (event as StoredEvent & { webhook?: AlertRule["webhook"] }).webhook;
    let error: string | null = null;
    if (!webhook) error = "Webhook was removed.";
    else
      try {
        await deliverWebhook(
          webhook.url,
          webhook.secret,
          {
            event: "alert.triggered",
            rule: { id: event.ruleId, name: event.name },
            symbol: event.symbol,
            timeframe: event.timeframe,
            price: event.price,
            time: event.time,
            message: event.message,
            source: event.source,
            ...(event.strategyFill ? { execution: "strategy_emulator" as const, strategyFill: event.strategyFill } : {}),
            ...(event.simulated !== undefined ? { simulated: event.simulated } : {}),
          },
          fetcher,
        );
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    await store.update((draft) => {
      const target = draft.events.find((e) => e.seq === event.seq);
      if (!target?.delivery) return;
      const attempts = target.delivery.attempts + 1;
      if (!error) {
        target.delivery = { status: "delivered", attempts };
        delete (target as StoredEvent & { webhook?: unknown }).webhook;
        delivered++;
      } else if (attempts >= MAX_ATTEMPTS || !webhook) {
        target.delivery = { status: "failed", attempts, lastError: error };
        delete (target as StoredEvent & { webhook?: unknown }).webhook;
      } else {
        target.delivery = {
          status: "pending",
          attempts,
          lastError: error,
          nextAttemptAt: now + RETRY_DELAYS[attempts - 1],
        };
      }
    });
  }
  return delivered;
}

export interface MarketSource {
  tpoHistory?: (view: TpoHistoryView, now?: number) => Promise<TpoCandleSnapshot>;
  bars: (symbol: string, timeframe: string, count?: number) => Promise<OHLCV[]>;
  quotes: (symbols: string[], ranges?: string[]) => Promise<
    Record<string, NonNullable<MarketView["quote"]>>
  >;
}

export function exchangeSource(fetcher: typeof fetch = fetch): MarketSource {
  const pager = serverKlinePager(fetcher);
  const tpoPool = new TpoCandlePool(request => loadYahooBars({ ...request, chartLoader: async (ticker, interval, period1, period2, extended) => {
    const chart = await yahooChart({ ticker, interval, period1: period1 / 1000, period2: period2 / 1000, extended }, fetcher);
    return { meta: chart.meta, rows: chart.bars.map(b => [b.time, b.open, b.high, b.low, b.close, b.volume]), adj: chart.adjClose, events: chart.events };
  } }));
  const loadBars = async (symbol: string, timeframe: string, count: number): Promise<OHLCV[]> => {
    switch (providerOf(symbol)) {
      case "alpaca": throw new Error("Alpaca IEX requires credentials in an open browser tab; server alerts cannot access this session feed.");
      case "bybit": return loadKlines(bybitServerPager(fetcher), { symbol, timeframe, count }, BYBIT_NATIVES);
      case "kraken": return (await loadKrakenClosedBars(tickerOf(symbol), timeframe, fetcher)).slice(-count);
      case "hyperliquid":
        return loadHyperliquidBars({
          coin: tickerOf(symbol),
          timeframe,
          count,
          page: async (coin, api, startTime, endTime) =>
            parseCandles(await hyperliquidCandles({ coin, interval: api, startTime, endTime }, fetcher)),
        });
      case "yahoo": {
        const loaded = await loadYahooBars({
            ticker: tickerOf(symbol),
            timeframe,
            count,
            extended: false,
            adjustDividends: false,
            chartLoader: async (ticker, interval, period1, period2, extended) => {
              const chart = await yahooChart({ ticker, interval, period1: period1 / 1000, period2: period2 / 1000, extended }, fetcher);
              return {
                meta: chart.meta,
                rows: chart.bars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume]),
                adj: chart.adjClose,
                events: chart.events,
              };
            },
          });
        if (loaded.meta?.sessions) registerMarketSessions(symbol, loaded.meta.sessions, "regular");
        return loaded.bars;
      }
      default:
        return loadKlines(pager, { symbol, timeframe, count });
    }
  };
  const barCache = new Map<string, { at: number; bars: OHLCV[]; count: number }>();
  return {
    tpoHistory: (view, now = Date.now()) => tpoPool.load(tpoAlertQuery(view, now, "server")),
    bars: async (symbol, timeframe, requested = 300) => {
      const count = Number.isFinite(requested) ? Math.max(1, Math.min(MAX_HISTORY_BARS, Math.floor(requested))) : 300;
      const key = `${symbol}:${timeframe}`;
      const hit = barCache.get(key);
      if (hit && hit.count >= count && Date.now() - hit.at < 10_000) return hit.bars.slice(-count);
      const bars = await loadBars(symbol, timeframe, count);
      barCache.delete(key);
      barCache.set(key, { at: Date.now(), bars, count });
      if (barCache.size > 128) barCache.delete(barCache.keys().next().value!);
      return bars;
    },
    quotes: async (all, ranges = []) => {
      const out: Record<string, NonNullable<MarketView["quote"]>> = {};
      const symbols = all.filter((s) => providerOf(s) === "binance");
      const bybit = new Set(all.filter(symbol => providerOf(symbol) === "bybit"));
      await Promise.all((["spot", "linear"] as const).filter(category =>
        [...bybit].some(symbol => bybitMarket(symbol)?.category === category)).map(async category => {
        const rows = await bybitTickers(category, fetcher).catch(() => []);
        for (const row of rows) {
          const symbol = bybitSymbol(category, row.pair);
          if (bybit.has(symbol)) out[symbol] = {
            price: row.price, previous: row.open, changePercent: (row.price / row.open - 1) * 100,
            volume: row.volume, high: row.high, low: row.low,
            metrics: basicMetrics(symbol, row.volume, row.turnover, row.high, row.low, "24h", row.time),
          };
        }
      }));
      const kraken = all.filter(symbol => providerOf(symbol) === "kraken");
      for (let i = 0; i < kraken.length; i += 50) {
        const batch = kraken.slice(i, i + 50);
        const query = new URLSearchParams({ assetVersion: "1", pair: batch.map(symbol => tickerOf(symbol).replace("/", "")).join(",") });
        try {
          const response = await fetcher(`https://api.kraken.com/0/public/Ticker?${query}`);
          if (!response.ok) continue;
          const payload = await response.json();
          if (!Array.isArray(payload?.error) || payload.error.length) continue;
          for (const symbol of batch) {
            const row = payload.result?.[tickerOf(symbol)];
            const price = Number(row?.c?.[0]), high = Number(row?.h?.[1]), low = Number(row?.l?.[1]);
            if (![price, high, low].every(value => Number.isFinite(value) && value > 0) || high < low) continue;
            const volume = nonnegative(row?.v?.[1]);
            out[symbol] = { price, previous: price, changePercent: NaN, volume: volume ?? 0, high, low,
              metrics: basicMetrics(symbol, volume, null, high, low, "24h") };
          }
        } catch { /* Keep other providers available during Kraken outages. */ }
      }
      const perps = all.filter((s) => providerOf(s) === "hyperliquid");
      const stocks = all.filter((s) => providerOf(s) === "yahoo");
      if (perps.length) {
        const wanted = new Set(perps);
        for (const asset of await hyperliquidAssets(fetcher))
          if (wanted.has(asset.symbol))
            out[asset.symbol] = {
              price: asset.mark,
              previous: asset.mark,
              changePercent: asset.previousDay > 0 ? ((asset.mark - asset.previousDay) / asset.previousDay) * 100 : 0,
              volume: asset.baseVolume ?? 0,
              high: 0,
              low: 0,
              metrics: { ...basicMetrics(asset.symbol, asset.baseVolume ?? null, asset.volume, 0, 0, "24h", asset.asOf ?? Date.now()), range: pendingRange() },
            };
        await Promise.all(perps.filter(symbol => ranges.includes(symbol) && out[symbol]).map(async symbol => {
          try {
            const range = await hyperliquidRange(tickerOf(symbol), fetcher);
            out[symbol].metrics!.range = range;
            out[symbol].high = range.high ?? 0;
            out[symbol].low = range.low ?? 0;
          } catch { /* An unavailable window remains null and cannot trigger a range rule. */ }
        }));
      }
      if (stocks.length) {
        const spark = await yahooSpark(stocks.map(tickerOf), fetcher);
        for (const symbol of stocks) {
          const q = spark[tickerOf(symbol)];
          if (q && q.price > 0)
            out[symbol] = {
              price: q.price,
              previous: q.price,
              changePercent: q.previousClose > 0 ? ((q.price - q.previousClose) / q.previousClose) * 100 : 0,
              volume: 0,
              high: Math.max(q.high, q.price),
              low: Math.min(q.low, q.price),
              metrics: basicMetrics(symbol, null, null, q.high, q.low, "session"),
            };
        }
      }
      for (let i = 0; i < symbols.length; i += 100) {
        const chunk = symbols.slice(i, i + 100);
        const query = new URLSearchParams({ symbols: JSON.stringify(chunk) });
        const rows = (await binanceJson(`/api/v3/ticker/24hr?${query}`, fetcher)) as {
          symbol: string;
          lastPrice: string;
          prevClosePrice: string;
          priceChangePercent: string;
          volume: string;
          quoteVolume?: string;
          highPrice: string;
          lowPrice: string;
        }[];
        for (const row of rows)
          out[row.symbol] = {
            price: Number(row.lastPrice),
            previous: Number(row.lastPrice),
            changePercent: Number(row.priceChangePercent),
            volume: Number(row.volume),
            high: Number(row.highPrice),
            low: Number(row.lowPrice),
            metrics: basicMetrics(row.symbol, nonnegative(row.volume), nonnegative(row.quoteVolume), +row.highPrice, +row.lowPrice, "24h"),
          };
      }
      return out;
    },
  };
}

export interface RunResult {
  evaluated: number;
  fired: number;
  errors: string[];
}

/** One evaluation pass over every active server rule. */
let evaluationQueue: Promise<unknown> = Promise.resolve();
const pineSessions = new Map<string, { signature: string; resetAt?: number; session: PineJournalSession; owner: string }>();
export function disposePineAlertRuntimes() { for (const entry of pineSessions.values()) entry.session.dispose(); pineSessions.clear(); }
async function cleanPineJournals() {
  const current = await store.read();
  const owners = current.rules.filter(rule => rule.kind === "pine").flatMap(rule => (rule.scope.type === "symbol" ? [rule.scope.symbol] : rule.scope.symbols).map(symbol => ({ owner: `${pineOwner(rule.id, symbol)}:exchange`, epoch: pineRunEpoch(rule, symbol)! })));
  await prunePineJournals(owners);
}
export function evaluateRules(source: MarketSource, now = Date.now()): Promise<RunResult> {
  const result = evaluationQueue.then(() => runEvaluation(source, now), () => runEvaluation(source, now));
  evaluationQueue = result.catch(() => undefined);
  return result;
}
async function runEvaluation(
  source: MarketSource,
  now = Date.now(),
): Promise<RunResult> {
  const startedWall = Date.now();
  await expireRules(now);
  const initial = await store.read();
  if (initial.rules.some(rule => rule.kind === "pine" && !rule.pineEpoch)) await store.update(draft => { for (const rule of draft.rules) if (rule.kind === "pine" && !rule.pineEpoch) rule.pineEpoch = crypto.randomUUID(); });
  const db = await store.read();
  const rules = db.rules.filter((r) => r.status === "active");
  for (const [key, entry] of pineSessions) {
    const active = rules.some(rule => {
      if (!pineSnapshot(rule.condition) || !key.startsWith(`${rule.id}:`)) return false;
      const symbol = key.slice(rule.id.length + 1);
      return (rule.scope.type === "symbol" ? rule.scope.symbol === symbol : rule.scope.symbols.includes(symbol)) && !scopeStopped(rule, symbol) && !scopeFinished(rule, symbol);
    });
    if (!active) { entry.session.dispose(); pineSessions.delete(key); }
  }
  const result: RunResult = { evaluated: 0, fired: 0, errors: [] };
  if (!rules.length) { await cleanPineJournals().catch(error => result.errors.push(String(error))); return result; }
  const symbols = new Set<string>();
  const views = new Map<string, { symbol: string; timeframe: string; count: number }>();
  const tpoViews = new Map<string, TpoHistoryView>();
  for (const rule of rules) {
    const own = rule.scope.type === "symbol" ? [rule.scope.symbol] : rule.scope.symbols;
    for (const symbol of own) {
      if (scopeFinished(rule, symbol) || scopeStopped(rule, symbol)) continue;
      symbols.add(symbol);
      if (source.tpoHistory) for (const view of requiredTpoHistory(rule.condition, { symbol, timeframe: rule.scope.timeframe })) {
        const key = tpoHistoryKey(view.symbol, view.timeframe, view.tape);
        if ((tpoViews.get(key)?.count ?? 0) < view.count) tpoViews.set(key, view);
      }
      if (isQuoteOnly(rule.condition) && !closesOnly(rule) && rule.trigger !== "once_per_bar") {
        for (const view of requiredViews(rule.condition, { symbol, timeframe: rule.scope.timeframe }))
          symbols.add(view.symbol);
        continue;
      }
      for (const view of requiredHistoryViews(rule.condition, { symbol, timeframe: rule.scope.timeframe })) {
        symbols.add(view.symbol);
        const key = `${view.symbol}:${view.timeframe}`;
        if (!views.has(key) || views.get(key)!.count < view.count) views.set(key, view);
      }
      const ownKey = `${symbol}:${rule.scope.timeframe}`;
      if (!views.has(ownKey)) views.set(ownKey, { symbol, timeframe: rule.scope.timeframe, count: 300 });
    }
  }
  let quotes: Awaited<ReturnType<MarketSource["quotes"]>> = {};
  const ranges = new Set(rules.flatMap(rule => (rule.scope.type === "symbol" ? [rule.scope.symbol] : rule.scope.symbols)
    .flatMap(symbol => requiredQuoteRanges(rule.condition, { symbol, timeframe: rule.scope.timeframe }))));
  try {
    quotes = await source.quotes([...symbols], [...ranges]);
  } catch (error) {
    result.errors.push(`quotes: ${error instanceof Error ? error.message : String(error)}`);
  }
  const bars = new Map<string, OHLCV[]>();
  const tpoHistories = new Map<string, TpoCandleSnapshot>();
  const tpoJobs = [...tpoViews.entries()].slice(0, 60); let tpoCursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, tpoJobs.length) }, async () => {
    while (tpoCursor < tpoJobs.length) {
      const [key, view] = tpoJobs[tpoCursor++];
      try { tpoHistories.set(key, await source.tpoHistory!(view, now)); }
      catch (error) { result.errors.push(`TPO ${key}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }));
  const wanted = [...views.entries()].slice(0, 60);
  await Promise.all(
    wanted.map(async ([key, view]) => {
      try {
        bars.set(key, await source.bars(view.symbol, view.timeframe, view.count));
      } catch (error) {
        result.errors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );
  const plans: { rule: AlertRule; symbol: string; key: string; state?: RuleRuntimeState; message?: string; price?: number; signal?: PineSignal; series?: PineSeries; error?: string; batch?: PineDeliveryBatch; time?: number }[] = [];
  const touched = new Set<string>();
  for (const rule of rules) {
    const own = rule.scope.type === "symbol" ? [rule.scope.symbol] : rule.scope.symbols;
    for (const symbol of own) {
      if (scopeFinished(rule, symbol) || scopeStopped(rule, symbol)) continue;
      const key = `${rule.id}:${symbol}`;
      const snapshot = pineSnapshot(rule.condition);
      if (snapshot) {
        const ownBars = bars.get(`${symbol}:${rule.scope.timeframe}`) ?? [];
        if (!ownBars.length) { result.errors.push(`${key}: Pine history unavailable.`); continue; }
        const signature = JSON.stringify([snapshot, symbol, rule.scope.timeframe, pineRunEpoch(rule, symbol)]);
        let entry = pineSessions.get(key);
        const reset = entry && entry.resetAt !== rule.rate?.resetAt && (!rule.rate?.resetSymbols || rule.rate.resetSymbols.includes(symbol));
        const series = pineSeries(symbol, rule.scope.timeframe, ownBars);
        try {
          if (!entry || entry.signature !== signature || reset) {
            entry?.session.dispose(); const owner = `${pineOwner(rule.id, symbol)}:exchange`;
            entry = { signature, resetAt: rule.rate?.resetAt, owner, session: new PineJournalSession(snapshot, { epoch: pineRunEpoch(rule, symbol)!, journal: await loadPineJournal(owner), expected: rule.pineCursors?.[symbol]?.exchange }) }; pineSessions.set(key, entry);
          }
          entry.resetAt = rule.rate?.resetAt; touched.add(key);
          const output = await entry.session.observe({ series, now }, async (symbol, timeframe, count) => pineSeries(symbol, timeframe, await source.bars(symbol, timeframe, count)));
          await appendPineJournal(entry.owner, entry.session.journal!);
          for (const batch of output.deliveries) plans.push({ rule, symbol, key, batch, series: batch.series, time: batch.cursor.time });
          result.evaluated++;
        } catch (error) {
          const detail = String(error instanceof Error ? error.message : error).slice(0, 500);
          result.errors.push(`${key}: ${detail}`); plans.push({ rule, symbol, key, error: detail });
          entry?.session.dispose(); pineSessions.delete(key);
        }
        continue;
      }
      const step = stepRule(
        rule, symbol, db.edges[key],
        (s, tf) => {
          const all = bars.get(`${s}:${tf}`) ?? [];
          const quote = quotes[s];
          if (!all.length && !quote) return undefined;
          return { bars: all, quote, ...(source.tpoHistory ? { tpoSource: settings => {
            const tape = tpoSettingsTape(s, settings); return tape ? tpoHistories.get(tpoHistoryKey(s, tf, tape)) : undefined;
          } } : {}) };
        },
        now,
      );
      result.evaluated++;
      plans.push({ rule, symbol, key, state: step.state,
        message: step.fire && step.evaluation ? ruleMessage(rule, symbol, step.evaluation) : undefined,
        price: step.fire ? step.evaluation?.price : undefined });
    }
  }
  const committed: StoredEvent[] = [];
  const acknowledgements: { owner: string; id: string; sequence: number }[] = [];
  try { await store.update((draft) => {
    const valid = new Set(draft.rules.filter(rule => rule.status === "active" && rules.some(original => original.id === rule.id && JSON.stringify(original) === JSON.stringify(rule))).map(rule => rule.id));
    const commit = (plan: typeof plans[number]) => {
      if (!valid.has(plan.rule.id)) return;
      const current = draft.rules.find(rule => rule.id === plan.rule.id)!;
      if (current.status !== "active" || scopeStopped(current, plan.symbol)) return;
      const observedAt=now+Math.max(0,Date.now()-startedWall),reason=expirationReason(current,observedAt);
      if (reason) { current.status = "expired"; current.expiration={reason,time:observedAt}; return; }
      if (plan.error) { current.status = "stopped"; current.stop = { reason: "script_error", time: now, detail: plan.error }; return; }
      const eventTime = plan.time ?? now;
      const scriptEvent = plan.signal && plan.series ? pineEvent(current, plan.signal, plan.series, eventTime, "server") : undefined;
      if (plan.signal) { if (!scriptEvent) return; plan.message = scriptEvent.message; plan.price = scriptEvent.price; }
      if (plan.state) draft.edges[plan.key] = plan.state;
      if (plan.message === undefined || plan.price === undefined) return;
      const admission = admitTrigger(current, plan.symbol, plan.time ?? now + Math.max(0, Date.now() - startedWall), current.scope.type === "watchlist");
      current.rate = admission.rate;
      current.stop = admission.stop;
      if (admission.stop) current.status = "stopped";
      if (!admission.allowed) return;
      committed.push(appendEvent(draft, { ruleId: plan.rule.id, name: plan.rule.name, symbol: plan.symbol,
        timeframe: plan.rule.scope.timeframe, price: plan.price, time: eventTime, message: plan.message, source: "server", barTime: scriptEvent?.barTime ?? plan.state?.firedBar, scriptGate: scriptEvent?.scriptGate, strategyFill: scriptEvent?.strategyFill }, plan.rule.webhook));
      current.lastTriggeredAt = eventTime;
      current.activity=triggeredActivity(current,observedAt);
      const firedBar = scriptEvent?.barTime ?? plan.state?.firedBar;
      current.lastFired = { ...current.lastFired, [plan.symbol]: { time: eventTime, ...(firedBar !== undefined ? { bar: firedBar } : {}) } };
      if (scriptEvent?.scriptGate) current.scriptState = { ...current.scriptState, [plan.symbol]: { ...current.scriptState?.[plan.symbol], [scriptEvent.scriptGate.key]: { bar: scriptEvent.scriptGate.bar, time: eventTime, ...(scriptEvent.scriptGate.token ? { token: scriptEvent.scriptGate.token } : {}) } } };
      if (oneShot(current) && current.scope.type === "watchlist") current.triggeredSymbols = [...new Set([...(current.triggeredSymbols ?? []), plan.symbol])];
      if (current.status !== "stopped" && oneShot(current) && (current.scope.type !== "watchlist" || completedWatchlist(current))) current.status = "triggered";
    };
    for (const plan of plans) {
      if (!plan.batch) { commit(plan); continue; }
      const current = draft.rules.find(rule => rule.id === plan.rule.id), batch = plan.batch;
      if (!current || pineRunEpoch(current, plan.symbol) !== batch.cursor.epoch) continue;
      const source = pineMarketSource(batch.series.simulated), previous = current.pineCursors?.[plan.symbol]?.[source];
      if (previous?.id === batch.cursor.id && previous.sequence >= batch.cursor.sequence) continue;
      if (previous && previous.id !== batch.cursor.id) throw new Error("Pine journal identity conflicts with the saved firing cursor.");
      if (valid.has(current.id)) for (const signal of batch.result.signals) commit({ ...plan, batch: undefined, signal });
      else if (current.status !== "paused" || JSON.stringify(current.condition) !== JSON.stringify(plan.rule.condition)) continue;
      current.pineCursors = { ...current.pineCursors, [plan.symbol]: { ...current.pineCursors?.[plan.symbol], [source]: batch.cursor } };
      acknowledgements.push({ owner: `${pineOwner(current.id, plan.symbol)}:${source}`, id: batch.cursor.id, sequence: batch.cursor.sequence });
    }
  }); } catch (error) { for (const key of touched) { pineSessions.get(key)?.session.dispose(); pineSessions.delete(key); } throw error; }
  for (const acknowledgement of new Map(acknowledgements.map(value => [value.owner, value])).values()) { await acknowledgePineJournal(acknowledgement.owner, acknowledgement.id, acknowledgement.sequence); for (const entry of pineSessions.values()) if (entry.owner === acknowledgement.owner) entry.session.acknowledge(acknowledgement.sequence); }
  for (const key of touched) if (!acknowledgements.some(value => value.owner === pineSessions.get(key)?.owner)) { pineSessions.get(key)?.session.dispose(); pineSessions.delete(key); }
  result.fired = committed.length;
  await cleanPineJournals().catch(error => result.errors.push(`Pine recovery cleanup: ${String(error)}`));
  for (const event of committed) void sendPush({ title: event.name, body: `${event.message}${event.strategyFill ? " · EMULATED FILL" : ""}`, tag: `${event.ruleId}:${event.symbol}`, symbol: event.symbol }).catch(() => undefined);
  return result;
}

/** Expiration does not require a successful market request or an open browser. */
export async function expireRules(now = Date.now()): Promise<void> {
  const expired = (rule: AlertRule) => ["active", "paused"].includes(rule.status) && isExpired(rule, now);
  const current = await store.read();
  if (!current.rules.some(rule=>!rule.activity||expired(rule))) return;
  await store.update(draft => { for (const rule of draft.rules) {
    rule.activity??=trackedActivity(rule,now);
    const reason=expirationReason(rule,now);
    if(["active","paused"].includes(rule.status)&&reason){rule.status="expired";rule.expiration={reason,time:now};}
  } });
}


