import type { AlertRule } from "@/types/alerts";
import { evaluateTickerOpportunities, opportunityPlan, opportunityReadiness, type OpportunityKeyLevels, type TradeOpportunity } from "./opportunities";
import { isSymbolId } from "@/lib/symbolId";
import type { OverlayPrimitive } from "@/lib/chart/overlays";
import type { DailyStockBar } from "./stockBase";

export const SETUP_REPLAY_SESSIONS = 60;
export const SETUP_ENTRY_SESSIONS = 10;
export const SETUP_OUTCOME_SESSIONS = 20;
export type SetupOutcome = "waiting" | "entered" | "target" | "stopped" | "invalid" | "ambiguous" | "expired" | "data-gap";
export type SetupResult = { status: SetupOutcome; session: string };

export interface SetupRecord {
  id: string;
  symbol: string;
  ticker: string;
  name: string;
  label: string;
  currency: string;
  session: string;
  observedAt: number;
  score: number;
  levels: OpportunityKeyLevels;
  tracked: boolean;
  reconstructed?: boolean;
  outcome?: SetupResult;
}

export function historicalSetupOutcome(levels: OpportunityKeyLevels, bars: readonly DailyStockBar[]): SetupResult | undefined {
  const plan = opportunityPlan(levels);
  if (!plan) return;
  let outcome: SetupResult | undefined;
  let entered = false;
  for (const [i, bar] of bars.slice(0, SETUP_OUTCOME_SESSIONS).entries()) {
    const verdict = (status: SetupOutcome): SetupResult => ({ status, session: bar.session });
    const stopAtOpen = bar.open <= plan.stop;
    const touchedStop = bar.low <= plan.stop;
    const touchedTarget = bar.high >= plan.target1;
    if (entered) {
      if (stopAtOpen) return verdict("stopped");
      if (bar.open >= plan.target1) return verdict("target");
      if (touchedStop && touchedTarget) return verdict("ambiguous");
      if (touchedStop || touchedTarget) return verdict(touchedStop ? "stopped" : "target");
    } else {
      if (stopAtOpen) return verdict("invalid");
      if (bar.low <= plan.entry) {
        if (touchedStop && touchedTarget) return verdict("ambiguous");
        if (touchedStop) return verdict("stopped");
        if (touchedTarget) return verdict(bar.open <= plan.entry || bar.close >= plan.target1 ? "target" : "ambiguous");
        entered = true;
      } else if (i + 1 === SETUP_ENTRY_SESSIONS) return verdict("expired");
    }
    outcome = verdict(entered ? "entered" : "waiting");
  }
  return outcome;
}

export function reconstructSetupHistory(
  bars: readonly DailyStockBar[], nominal: readonly DailyStockBar[], benchmark: readonly DailyStockBar[],
  metadata: Parameters<typeof evaluateTickerOpportunities>[2],
) {
  const records: SetupRecord[] = [];
  const nominalBySession = new Map(nominal.map(bar => [bar.session, bar]));
  let active = new Set<string>();
  // One session before the reporting window seeds already active patterns.
  const start = Math.max(59, bars.length - SETUP_REPLAY_SESSIONS - 2);
  for (let i = start; i < bars.length - 1; i++) {
    const signal = bars[i], raw = nominalBySession.get(signal.session);
    if (!raw) continue;
    const scale = raw.close / signal.close;
    if (!Number.isFinite(scale) || scale <= 0) continue;
    const history = bars.slice(0, i + 1).map(bar => ({ ...bar, open: bar.open * scale, high: bar.high * scale,
      low: bar.low * scale, close: bar.close * scale }));
    const priorIndex = benchmark.filter(bar => bar.session <= signal.session);
    const next = new Set<string>();
    for (const opportunity of evaluateTickerOpportunities(history, priorIndex, metadata, null)) {
      if (!opportunityReadiness(opportunity.levels).canPrepare) continue;
      const pattern = `${opportunity.id}:${opportunity.structure?.retest.session ?? ""}`;
      next.add(pattern);
      if (active.has(pattern) || i < bars.length - SETUP_REPLAY_SESSIONS - 1) continue;
      const row = setupRecord(opportunity, signal.time);
      if (!row) continue;
      const follow: DailyStockBar[] = [];
      let gap: string | undefined;
      let previousClose = raw.close;
      for (const date of benchmark.filter(bar => bar.session > signal.session).slice(0, SETUP_OUTCOME_SESSIONS)) {
        const bar = nominalBySession.get(date.session);
        if (!bar || !Number.isFinite(bar.volume) || bar.volume <= 0 || bar.close / previousClose > 2.2 || bar.close / previousClose < 0.45) {
          gap = date.session;
          break;
        }
        follow.push(bar);
        previousClose = bar.close;
      }
      let outcome = historicalSetupOutcome(row.levels, follow);
      if (gap && (!outcome || outcome.status === "waiting" || outcome.status === "entered")) outcome = { status: "data-gap", session: gap };
      records.push({ ...row, id: `replay:${row.id}`, reconstructed: true, outcome });
    }
    active = next;
  }
  return records;
}

export const setupRecordId = (setup: Pick<TradeOpportunity, "session" | "id">) => `${setup.id}@${setup.session}`;
export function setupRecord(setup: TradeOpportunity, observedAt: number): SetupRecord | null {
  if (!isSymbolId(setup.symbol) || !opportunityPlan(setup.levels) || !/^\d{4}-\d{2}-\d{2}$/.test(setup.session)) return null;
  return {
    id: setupRecordId(setup), symbol: setup.symbol, ticker: setup.ticker, name: setup.name,
    label: setup.setupLabel, currency: setup.currency, session: setup.session, observedAt, score: setup.score,
    levels: { ...setup.levels, entryZone: [...setup.levels.entryZone] }, tracked: false,
  };
}

export function mergeSetupHistory(records: readonly SetupRecord[], additions: readonly SetupRecord[]) {
  const indexed = new Map(records.map(item => [item.id, item]));
  let changed = false;
  for (const entry of additions) {
    const previous = indexed.get(entry.id);
    if (!previous) { indexed.set(entry.id, entry); changed = true; }
    else if (previous.reconstructed && entry.reconstructed && (previous.outcome?.session !== entry.outcome?.session ||
      previous.outcome?.status !== entry.outcome?.status || previous.score !== entry.score ||
      JSON.stringify(previous.levels) !== JSON.stringify(entry.levels))) {
      indexed.set(entry.id, entry);
      changed = true;
    }
  }
  if (!changed) return records;
  const all = [...indexed.values()].sort((a, b) => b.session.localeCompare(a.session) || b.observedAt - a.observedAt || b.score - a.score);
  return [...all.filter(row => row.tracked), ...all.filter(row => !row.tracked).slice(0, 600)];
}

export function summarizeSetupHistory(records: readonly SetupRecord[]) {
  const byPattern = new Map<string, { target: number; stopped: number; total: number }>();
  let target = 0, stopped = 0, open = 0, unfilled = 0, uncertain = 0;
  for (const row of records) {
    let pattern = byPattern.get(row.label);
    if (!pattern) { pattern = { target: 0, stopped: 0, total: 0 }; byPattern.set(row.label, pattern); }
    pattern.total++;
    switch (row.outcome?.status) {
      case "target": target++; pattern.target++; break;
      case "stopped": stopped++; pattern.stopped++; break;
      case "expired": case "invalid": unfilled++; break;
      case "ambiguous": case "data-gap": uncertain++; break;
      default: open++;
    }
  }
  return { target, stopped, open, unfilled, uncertain, byPattern: [...byPattern] };
}

export function mergeSetupRecords(records: readonly SetupRecord[], opportunities: readonly TradeOpportunity[], observedAt: number) {
  return mergeSetupHistory(records, opportunities.flatMap(setup => {
    const row = setupRecord(setup, observedAt);
    return row ? [row] : [];
  }));
}

export const setupRuleIds = (id: string) => [`setup:${id}:entry`, `setup:${id}:stop`] as const;

export function setupAlertRules(setup: SetupRecord, now: number): AlertRule[] {
  const [entry, stop] = setupRuleIds(setup.id), [low, high] = setup.levels.entryZone;
  const quote = { type: "quote", field: "price" } as const;
  const rule = {
    kind: "technical", status: "active", scope: { type: "symbol", symbol: setup.symbol, timeframe: "1D" },
    frequency: "tick", repeat: false, trigger: "once", cooldownMs: 0, serverSide: false, sound: false,
    browserNotification: true, createdAt: now, exchangeOnly: true,
  } as const;
  return [
    { ...rule, id: entry, name: `${setup.ticker} · Einstiegszone`,
      condition: { op: "leaf", leaf: { type: "band", operand: quote, low, high, mode: "inside" } } },
    { ...rule, id: stop, name: `${setup.ticker} · Setup invalidiert`,
      condition: { op: "leaf", leaf: { type: "compare", left: quote, comparator: "<=", right: { type: "number", value: setup.levels.invalidation } } } },
  ];
}

export function setupOverlays(setup: SetupRecord): OverlayPrimitive[] {
  const plan = opportunityPlan(setup.levels);
  if (!plan) return [];
  const [low, high] = setup.levels.entryZone;
  const prices: [string, number, string][] = [
    ["Einstiegszone unten", low, "#6288e2"], ["Einstiegszone oben", high, "#6288e2"],
    ["Stop", plan.stop, "#e26164"], ["Ziel 1", plan.target1, "#269a81"],
  ];
  if (high === low) prices.shift();
  if (plan.target2 > plan.target1) prices.push(["Ziel 2", plan.target2, "#269a81"]);
  return prices.map(([label, price, color]) => ({ kind: "hline", id: `${setup.id}:${label}`, label: `${label} ${price}`, price, color }));
}
