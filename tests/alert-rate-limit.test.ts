import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const memoryStorage = vi.hoisted(() => new Map<string, string>());
vi.mock("zustand/middleware", async importOriginal => {
  const actual = await importOriginal<typeof import("zustand/middleware")>();
  return { ...actual, persist: (...args: Parameters<typeof actual.persist>) => actual.persist(args[0], { ...args[1], storage: actual.createJSONStorage(() => ({
    getItem: key => memoryStorage.get(key) ?? null, setItem: (key, value) => { memoryStorage.set(key, value); }, removeItem: key => { memoryStorage.delete(key); },
  })) }) };
});
import type { AlertRateFields, AlertRule, RuleEvent } from "@/types/alerts";
import type { PriceAlert } from "@/types/trading";
import { admitTrigger, freshRate, RATE_WINDOW_MS, restartRule, resumeRate, scopeStopped, validateRateFields } from "@/lib/alerts/rateLimit";
import { useAlertStore } from "@/stores/useAlertStore";
import { BrowserRuleEngine } from "@/lib/alerts/browserEngine";
import { ruleMarketSubscriptions, watchlistMembers } from "@/lib/alerts/dependencies";
import { validateRuleShape } from "@/lib/alerts/rules";
import { parseWorkspace } from "@/lib/workspace";
import { AlertEvaluator } from "@/lib/alerts/engine";
import { pineEvent, pineSeries } from "@/lib/alerts/pineRules";
import type { PineSignal } from "@/types/pineAlerts";
import type { PineDeliveryBatch } from "@/types/pineAlerts";

const rule = (patch: Partial<AlertRule> = {}): AlertRule => ({ id: "rate", name: "Rate verification", kind: "technical", status: "active",
  scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "1s" }, condition: { op: "leaf", leaf: { type: "compare", left: { type: "quote", field: "price" }, comparator: ">", right: { type: "number", value: 100 } } },
  frequency: "tick", repeat: true, trigger: "every_time", cooldownMs: 0, sound: false, browserNotification: false, serverSide: false, createdAt: 0, ...patch });
const watch = (patch: Partial<AlertRule> = {}) => rule({ kind: "watchlist", scope: { type: "watchlist", listId: "w", symbols: ["BTCUSDT", "ETHUSDT"], timeframe: "1s" }, expiresAt: 9_000_000, ...patch });
const event = (symbol = "BTCUSDT", time = 1000, patch: Partial<RuleEvent> = {}): RuleEvent => ({ id: crypto.randomUUID(), ruleId: "rate", name: "Rate verification", symbol, timeframe: "1s", price: 110, time, message: "above 100", source: "browser", ...patch });
const priceAlert = (): PriceAlert => ({ id: "price", name: "Price", symbol: "BTCUSDT", condition: "crossing", price: 100, status: "active", repeat: true, trigger: "every_time", frequency: "tick", timeframe: "1s", sound: false, browserNotification: false, simulated: false, createdAt: 0 });

describe("rolling trigger admission", () => {
  it("delivers the fifteenth firing, stops immediately and never delivers a sixteenth", () => {
    let alert: AlertRateFields = {};
    for (let i = 0; i < 15; i++) {
      const next = admitTrigger(alert, "BTCUSDT", i);
      expect(next.allowed).toBe(true); expect(Boolean(next.stop)).toBe(i === 14);
      alert = next;
    }
    expect(admitTrigger(alert, "BTCUSDT", 15).allowed).toBe(false);
    expect(alert.rate?.recent).toHaveLength(15);
    expect(alert.stop).toEqual({ reason: "trigger_rate", time: 14 });
    expect(admitTrigger(alert, "BTCUSDT", RATE_WINDOW_MS + 1).allowed).toBe(false);
  });
  it("uses a rolling half-open window rather than a fixed three-minute bucket", () => {
    const recent = Array.from({ length: 14 }, () => ({ symbol: "BTCUSDT", time: 1 }));
    expect(admitTrigger({ rate: { recent, stoppedSymbols: {} } }, "BTCUSDT", RATE_WINDOW_MS).stop).toBeDefined();
    const next = admitTrigger({ rate: { recent, stoppedSymbols: {} } }, "BTCUSDT", RATE_WINDOW_MS + 1);
    expect(next.stop).toBeUndefined(); expect(next.rate.recent).toHaveLength(1);
  });
  it("stops a watchlist member independently and keeps other members eligible", () => {
    let alert: AlertRateFields = {};
    for (let i = 0; i < 15; i++) alert = admitTrigger(alert, "BTCUSDT", i, true);
    expect(alert.stop).toBeUndefined(); expect(scopeStopped(alert, "BTCUSDT")).toBe(true);
    expect(admitTrigger(alert, "BTCUSDT", 20, true).allowed).toBe(false);
    expect(admitTrigger(alert, "ETHUSDT", 20, true).allowed).toBe(true);
  });
  it("stops the entire watchlist at 1000 without needing an individual member limit", () => {
    let alert: AlertRateFields = {};
    for (let i = 0; i < 1000; i++) {
      const next = admitTrigger(alert, `S${i % 100}USDT`, 1000, true);
      expect(next.allowed).toBe(true); alert = next;
    }
    expect(alert.stop).toEqual({ reason: "watchlist_rate", time: 1000 });
    expect(Object.keys(alert.rate!.stoppedSymbols)).toHaveLength(0);
    expect(admitTrigger(alert, "NEWUSDT", 1001, true).allowed).toBe(false);
    expect(alert.rate!.recent).toHaveLength(1000);
  });
  it("retains recent firings if the wall clock moves backwards", () => {
    const rate = { recent: Array.from({ length: 14 }, () => ({ symbol: "BTCUSDT", time: 2000 })), stoppedSymbols: {} };
    expect(admitTrigger({ rate }, "BTCUSDT", 1000).stop?.reason).toBe("trigger_rate");
  });
  it("distinguishes a deliberate restart from a pause/resume", () => {
    const rate = { recent: [{ symbol: "BTCUSDT", time: 1000 }], stoppedSymbols: { BTCUSDT: 1000 }, resetAt: 1000 };
    expect(resumeRate(rate, 1000)).toMatchObject({ recent: rate.recent, stoppedSymbols: rate.stoppedSymbols, resetAt: 1001 });
    expect(freshRate(1000, rate)).toEqual({ recent: [], stoppedSymbols: {}, resetAt: 1001 });
  });
  it("restarts only stopped members while retaining other members' completion, rate and frequency gates", () => {
    const original = watch({ rate: { recent: [{ symbol: "BTCUSDT", time: 1000 }, { symbol: "ETHUSDT", time: 1001 }], stoppedSymbols: { BTCUSDT: 1000 } },
      lastFired: { BTCUSDT: { time: 1000, bar: 0 }, ETHUSDT: { time: 1001, bar: 0 } }, triggeredSymbols: ["ETHUSDT"] });
    const restarted = restartRule(original, 2000, true);
    expect(restarted.status).toBe("active"); expect(restarted.triggeredSymbols).toEqual(["ETHUSDT"]);
    expect(restarted.lastFired).toEqual({ ETHUSDT: { time: 1001, bar: 0 } });
    expect(restarted.rate?.recent).toEqual([{ symbol: "ETHUSDT", time: 1001 }]);
    expect(restarted.rate?.stoppedSymbols).toEqual({});
    expect(restartRule({ ...original, status: "paused" }, 2000, true).status).toBe("paused");
    expect(() => restartRule({ ...original, expiresAt: 2000 }, 2000)).toThrow(/expiration/);
  });
  it.each([
    { stop: { reason: "unknown", time: 1 } }, { stop: { reason: "trigger_rate", time: NaN } },
    { rate: { recent: new Array(1001).fill({ symbol: "BTCUSDT", time: 1 }), stoppedSymbols: {} } },
    { rate: { recent: [{ symbol: "bad symbol", time: 1 }], stoppedSymbols: {} } },
    { rate: { recent: [{ symbol: "BTCUSDT", time: -1 }], stoppedSymbols: {} } },
    { rate: { recent: [], stoppedSymbols: [] } }, { rate: { recent: [], stoppedSymbols: {}, resetAt: Infinity } },
  ])("rejects malformed durable state %#", input => expect(validateRateFields(input as AlertRateFields)).toBeTypeOf("string"));
});

describe("browser/store rate lifecycle", () => {
  const storage = memoryStorage;
  beforeEach(() => {
    useAlertStore.setState({ alerts: [], logs: [], rules: [], events: [] });
  });
  afterEach(() => { storage.clear(); useAlertStore.setState({ alerts: [], logs: [], rules: [], events: [] }); vi.restoreAllMocks(); });
  it("persists a regular stop independently of clearing logs and browser reload", async () => {
    useAlertStore.getState().add(priceAlert());
    for (let i = 0; i < 15; i++) {
      expect(useAlertStore.getState().trigger("price", 110, 100_000 + i, false, undefined, i)).not.toBeNull();
      if (i === 13) useAlertStore.getState().clearLogs();
    }
    expect(useAlertStore.getState().alerts[0]).toMatchObject({ status: "stopped", stop: { reason: "trigger_rate" } });
    expect(useAlertStore.getState().alerts[0].rate!.recent[0].time).toBe(0);
    const saved = storage.get("affentrader-alerts-v1")!;
    useAlertStore.setState({ alerts: [], logs: [] }); storage.set("affentrader-alerts-v1", saved);
    await useAlertStore.persist.rehydrate();
    expect(useAlertStore.getState().trigger("price", 90, 500_000, false, undefined, 500_000)).toBeNull();
    expect(useAlertStore.getState().alerts[0].status).toBe("stopped");
  });
  it("commits rate state and one event together and never double-counts a repeated event id", () => {
    useAlertStore.getState().addRule(rule());
    const first = event();
    expect(useAlertStore.getState().recordFiring(first)).toBe(true);
    expect(useAlertStore.getState().recordFiring(first)).toBe(false);
    for (let i = 1; i < 15; i++) expect(useAlertStore.getState().recordFiring(event("BTCUSDT", 1000 + i))).toBe(true);
    expect(useAlertStore.getState().rules[0].status).toBe("stopped");
    expect(useAlertStore.getState().events).toHaveLength(15);
    expect(useAlertStore.getState().recordFiring(event())).toBe(false);
  });
  it("persists native strategy fill identities atomically with events and rate counters",async()=>{
    const r=rule({kind:"pine",condition:{op:"leaf",leaf:{type:"pine",snapshot:{source:'//@version=6\nstrategy("Fills")\nstrategy.entry("L",strategy.long)',title:"Fills",inputs:{},libraries:{},selection:{type:"orders"},history:50,chartType:"candles",timezone:"UTC"}}}});
    useAlertStore.getState().addRule(r);
    const data=pineSeries("BTCUSDT","1s",[{time:1000,open:100,high:110,low:100,close:110,volume:1}]);
    const signal:PineSignal={type:"order_fill",id:"native-fill",time:1000,price:110,confirmed:false,message:"",plots:{},fill:{id:"native-fill",orderId:"L",action:"buy",contracts:1,price:110,comment:"L",alertMessage:"",positionSize:1,previousPositionSize:0,leg:"entry"}};
    const firing=pineEvent(useAlertStore.getState().rules[0],signal,data,1001,"browser")!;expect(useAlertStore.getState().recordFiring(firing)).toBe(true);
    const saved=storage.get("affentrader-alerts-v1")!;useAlertStore.setState({rules:[],events:[]});storage.set("affentrader-alerts-v1",saved);await useAlertStore.persist.rehydrate();
    const restored=useAlertStore.getState();expect(restored.events[0].strategyFill).toEqual(signal.fill);expect(restored.rules[0].rate?.recent).toHaveLength(1);
    expect(pineEvent(restored.rules[0],signal,data,1002,"browser")).toBeUndefined();
    expect(pineEvent(restored.rules[0],{...signal,fill:{...signal.fill!,id:"next-fill"}},data,1002,"browser")).toBeDefined();
  });
  it("commits a recovered batch and its cursor once even after display logs are cleared",async()=>{
    const r=rule({kind:"pine",pineEpoch:"run-1",condition:{op:"leaf",leaf:{type:"pine",snapshot:{source:'//@version=6\nstrategy("Batch")\nalert("Live",alert.freq_all)',title:"Batch",inputs:{},libraries:{},selection:{type:"calls"},history:50,chartType:"candles",timezone:"UTC"}}}});useAlertStore.getState().addRule(r);
    const batch:PineDeliveryBatch={cursor:{id:crypto.randomUUID(),epoch:"run-1",sequence:2,time:1001},series:pineSeries("BTCUSDT","1s",[{time:1000,open:100,high:110,low:100,close:110,volume:1}]),result:{inspection:{title:"Batch",declaration:"strategy",hasCalls:true,conditions:[],inputs:[]},lastBar:1000,warnings:[],signals:Array.from({length:3},(_,index)=>({type:"alert",id:`call_${index}`,freq:"all",message:`Live ${index}`,price:110,time:1000,confirmed:false,plots:{}}))}};
    expect(useAlertStore.getState().recordPineBatch(r.id,batch)).toHaveLength(3);const saved=storage.get("affentrader-alerts-v1")!;useAlertStore.setState({rules:[],events:[]});storage.set("affentrader-alerts-v1",saved);await useAlertStore.persist.rehydrate();
    expect(useAlertStore.getState().rules[0].pineCursors?.BTCUSDT.exchange).toEqual(batch.cursor);useAlertStore.getState().clearLogs();expect(useAlertStore.getState().recordPineBatch(r.id,batch)).toEqual([]);expect(useAlertStore.getState().rules[0].rate?.recent).toHaveLength(3);
    expect(useAlertStore.getState().recordPineBatch(r.id,{...batch,cursor:{...batch.cursor,sequence:3}})).toHaveLength(3);expect(useAlertStore.getState().rules[0].rate?.recent).toHaveLength(6);
  });
  it("finishes the cursor atomically when a recovered batch reaches the trigger limit",()=>{
    const r=rule({kind:"pine",pineEpoch:"run-1",condition:{op:"leaf",leaf:{type:"pine",snapshot:{source:'//@version=6\nstrategy("Batch")\nalert("Live",alert.freq_all)',title:"Batch",inputs:{},libraries:{},selection:{type:"calls"},history:50,chartType:"candles",timezone:"UTC"}}}});useAlertStore.getState().addRule(r);
    const batch:PineDeliveryBatch={cursor:{id:crypto.randomUUID(),epoch:"run-1",sequence:1,time:1001},series:pineSeries("BTCUSDT","1s",[{time:1000,open:100,high:110,low:100,close:110,volume:1}]),result:{inspection:{title:"Batch",declaration:"strategy",hasCalls:true,conditions:[],inputs:[]},lastBar:1000,warnings:[],signals:Array.from({length:30},(_,index)=>({type:"alert",id:`call_${index}`,freq:"all",message:`Live ${index}`,price:110,time:1000,confirmed:false,plots:{}}))}};
    expect(useAlertStore.getState().recordPineBatch(r.id,batch)).toHaveLength(15);expect(useAlertStore.getState().rules[0]).toMatchObject({status:"stopped",pineCursors:{BTCUSDT:{exchange:batch.cursor}}});expect(useAlertStore.getState().recordPineBatch(r.id,batch)).toEqual([]);
    const restarted=restartRule(useAlertStore.getState().rules[0],2000);useAlertStore.getState().updateRule(r.id,restarted);expect(restarted.pineEpoch).not.toBe("run-1");expect(useAlertStore.getState().recordPineBatch(r.id,batch)).toEqual([]);
  });
  it("keeps independent browser delivery cursors for real and simulated observations",()=>{
    const r=rule({kind:"pine",pineEpoch:"run-1",condition:{op:"leaf",leaf:{type:"pine",snapshot:{source:'//@version=6\nstrategy("Sources")\nalert("Live",alert.freq_all)',title:"Sources",inputs:{},libraries:{},selection:{type:"calls"},history:50,chartType:"candles",timezone:"UTC"}}}});useAlertStore.getState().addRule(r);
    const batch:PineDeliveryBatch={cursor:{id:crypto.randomUUID(),epoch:"run-1",sequence:1,time:1001},series:pineSeries("BTCUSDT","1s",[{time:1000,open:100,high:110,low:100,close:110,volume:1}],false),result:{inspection:{title:"Sources",declaration:"strategy",hasCalls:true,conditions:[],inputs:[]},lastBar:1000,warnings:[],signals:[{type:"alert",id:"call",freq:"all",message:"Live",price:110,time:1000,confirmed:false,plots:{}}]}};
    const simulated={...batch,cursor:{...batch.cursor,id:crypto.randomUUID()},series:{...batch.series,simulated:true}};
    expect(useAlertStore.getState().recordPineBatch(r.id,batch)).toHaveLength(1);expect(useAlertStore.getState().recordPineBatch(r.id,simulated)).toHaveLength(1);expect(useAlertStore.getState().recordPineBatch(r.id,batch)).toEqual([]);
    expect(useAlertStore.getState().recordPineBatch(r.id,{...batch,cursor:{...batch.cursor,sequence:2}})).toHaveLength(1);expect(useAlertStore.getState().rules[0].pineCursors?.BTCUSDT).toEqual({exchange:{...batch.cursor,sequence:2},simulation:simulated.cursor});expect(useAlertStore.getState().events.filter(event=>event.simulated)).toHaveLength(1);
  });
  it("enforces the ordinary price evaluator-to-store pipeline without a sixteenth notification", () => {
    useAlertStore.getState().add(priceAlert());
    const evaluator = new AlertEvaluator();
    let delivered = 0;
    for (let i = 0; i < 40; i++) {
      const price = i % 2 ? 101 : 99, now = 1000 + i;
      const ids = evaluator.evaluate(useAlertStore.getState().alerts, "BTCUSDT", price, now, false, "tick", undefined, now);
      for (const id of ids) if (useAlertStore.getState().trigger(id, price, now, false, undefined, now)) delivered++;
    }
    expect(delivered).toBe(15);
    expect(useAlertStore.getState().logs).toHaveLength(15);
    expect(useAlertStore.getState().alerts[0].status).toBe("stopped");
  });
  it("does not reapply server event history to an authoritative stopped rule", () => {
    const stopped = rule({ serverSide: true, status: "stopped", stop: { reason: "trigger_rate", time: 2000 }, lastTriggeredAt: 2000, rate: freshRate(2000) });
    useAlertStore.getState().replaceServerRules([stopped]);
    expect(useAlertStore.getState().recordFiring(event("BTCUSDT", 1000, { source: "server" }))).toBe(true);
    expect(useAlertStore.getState().rules[0]).toEqual(stopped);
  });
  it("removes stopped scopes from subscriptions, preserves them on resume and prunes removed members", () => {
    const stopped = watch({ expiresAt: Date.now() + 1_000_000, rate: { recent: [{ symbol: "BTCUSDT", time: 1 }], stoppedSymbols: { BTCUSDT: 1 } } });
    expect(ruleMarketSubscriptions([stopped])).toEqual({ quotes: ["ETHUSDT"], streams: [] });
    expect(watchlistMembers(stopped, ["ETHUSDT"]).rate).toMatchObject({ recent: [], stoppedSymbols: {} });
    expect(validateRuleShape({ ...stopped, status: "stopped", stop: { reason: "watchlist_rate", time: 1000 } })).toBeNull();
    expect(validateRuleShape({ ...stopped, status: "stopped" })).toMatch(/reason/);
  });
  it("enforces real browser-engine dispatch and rebaselines an explicit restart", () => {
    let now = 1000;
    vi.spyOn(Date,"now").mockImplementation(()=>now);
    useAlertStore.getState().addRule(rule());
    const emitted: RuleEvent[] = [];
    const engine = new BrowserRuleEngine({ rules: () => useAlertStore.getState().rules, bars: () => [], quote: () => ({ price: 110, previous: 110, changePercent: 0, high: 110, low: 110, volume: 1, time: now }),
      ensure: async () => {}, now: () => now, fire: (_rule, current) => { if (useAlertStore.getState().recordFiring(current)) emitted.push(current); } });
    engine.prime();
    for (let i = 0; i < 30; i++) { now++; engine.onPrice("BTCUSDT"); }
    expect(emitted).toHaveLength(15); expect(useAlertStore.getState().rules[0].status).toBe("stopped");
    const restarted = restartRule(useAlertStore.getState().rules[0], ++now);
    useAlertStore.getState().updateRule("rate", restarted); engine.prime();
    expect(emitted).toHaveLength(15);
    now++; engine.onPrice("BTCUSDT"); expect(emitted).toHaveLength(16);
    expect(useAlertStore.getState().rules[0].rate!.recent).toHaveLength(1);
  });
  it("lets a second watchlist member fire after the first member stops, including after source restart", () => {
    let now = 1000;
    vi.spyOn(Date,"now").mockImplementation(()=>now);
    useAlertStore.getState().addRule(watch());
    const engine = new BrowserRuleEngine({ rules: () => useAlertStore.getState().rules, bars: () => [], quote: () => ({ price: 110, previous: 110, changePercent: 0, high: 110, low: 110, volume: 1, time: now }),
      ensure: async () => {}, now: () => now, fire: (_rule, current) => { useAlertStore.getState().recordFiring(current); } });
    engine.prime();
    for (let i = 0; i < 15; i++) { now++; engine.onPrice("BTCUSDT"); }
    engine.invalidateData(); engine.prime(); now++; engine.onPrice("BTCUSDT"); engine.onPrice("ETHUSDT");
    expect(useAlertStore.getState().events).toHaveLength(16);
    expect(useAlertStore.getState().rules[0].status).toBe("active");
    expect(useAlertStore.getState().rules[0].rate?.stoppedSymbols).toHaveProperty("BTCUSDT");
  });
  it("restarting a stopped member preserves another member's pending crossing baseline", () => {
    const r = watch({ trigger: "every_time", condition: { op: "leaf", leaf: { type: "compare", left: { type: "quote", field: "price" }, comparator: "crossing_up", right: { type: "number", value: 100 } } } });
    let now = 1000;
    vi.spyOn(Date,"now").mockImplementation(()=>now);
    useAlertStore.getState().addRule(r);
    const prices: Record<string, number> = { BTCUSDT: 99, ETHUSDT: 99 };
    const engine = new BrowserRuleEngine({ rules: () => useAlertStore.getState().rules, bars: () => [], quote: symbol => ({ price: prices[symbol], previous: prices[symbol], changePercent: 0, high: 200, low: 1, volume: 1, time: now }),
      ensure: async () => {}, now: () => now, fire: (_rule, current) => { useAlertStore.getState().recordFiring(current); } });
    engine.prime();
    for (let i = 0; i < 30; i++) { now++; prices.BTCUSDT = i % 2 === 0 ? 100 : 99; engine.onPrice("BTCUSDT"); }
    expect(useAlertStore.getState().rules[0].rate?.stoppedSymbols).toHaveProperty("BTCUSDT");
    useAlertStore.getState().updateRule("rate", restartRule(useAlertStore.getState().rules[0], ++now, true)); engine.prime();
    now++; prices.ETHUSDT = 100; engine.onPrice("ETHUSDT");
    expect(useAlertStore.getState().events[0].symbol).toBe("ETHUSDT");
    expect(useAlertStore.getState().events).toHaveLength(16);
  });
  it("round-trips stops and counters through workspace validation", () => {
    const data = { version: 1, chart: { state: { symbol: "BTCUSDT", timeframe: "1m", chartType: "candles", feedMode: "auto", indicators: [], drawings: {}, pineLibraries: {} } },
      watchlists: { state: { lists: [{ id: "w", name: "Crypto", symbols: ["BTCUSDT", "ETHUSDT"] }], activeId: "w" } },
      alerts: { state: { alerts: [{ ...priceAlert(), status: "stopped", stop: { reason: "trigger_rate", time: 1000 }, rate: freshRate(1000) }], logs: [], rules: [watch({ rate: { recent: [], stoppedSymbols: { BTCUSDT: 1000 } } })] } } };
    expect(parseWorkspace(JSON.stringify(data)).alerts.state).toEqual(data.alerts.state);
    data.alerts.state.alerts[0].rate.recent = new Array(1001).fill({ symbol: "BTCUSDT", time: 1000 });
    expect(() => parseWorkspace(JSON.stringify(data))).toThrow(/trigger window/);
  });
});
