import type { AlertRule } from "@/types/alerts";
import { opportunityPlan, type OpportunityKeyLevels, type TradeOpportunity } from "./opportunities";
import { isSymbolId } from "@/lib/symbolId";
import type { OverlayPrimitive } from "@/lib/chart/overlays";
import type { DailyStockBar } from "./stockBase";

export type SetupOutcome = "waiting" | "entered" | "target" | "stopped" | "invalid" | "ambiguous";

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
  outcome?: { status: SetupOutcome; session: string };
}

export function historicalSetupOutcome(levels: OpportunityKeyLevels, bars: readonly DailyStockBar[]): SetupRecord["outcome"] {
  let outcome: SetupRecord["outcome"];
  let entered = false;
  const [low, high] = levels.entryZone;
  for (const bar of bars) {
    const verdict = (status: SetupOutcome) => ({ status, session: bar.session });
    const stopAtOpen = bar.open <= levels.invalidation;
    const touchedStop = bar.low <= levels.invalidation;
    const touchedTarget = bar.high >= levels.target1;
    if (entered) {
      if (stopAtOpen) return verdict("stopped");
      if (bar.open >= levels.target1) return verdict("target");
      if (touchedStop && touchedTarget) return verdict("ambiguous");
      if (touchedStop || touchedTarget) return verdict(touchedStop ? "stopped" : "target");
    } else {
      if (stopAtOpen) return verdict("invalid");
      if (bar.low <= high && bar.high >= low) {
        if (touchedStop || touchedTarget) return verdict("ambiguous");
        entered = true;
      } else if (touchedStop) return verdict("invalid");
    }
    outcome = verdict(entered ? "entered" : "waiting");
  }
  return outcome;
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
    else if (previous.reconstructed && entry.outcome && (previous.outcome?.session !== entry.outcome.session || previous.outcome.status !== entry.outcome.status)) {
      indexed.set(entry.id, { ...previous, outcome: entry.outcome });
      changed = true;
    }
  }
  if (!changed) return records;
  const all = [...indexed.values()].sort((a, b) => b.session.localeCompare(a.session) || b.observedAt - a.observedAt || b.score - a.score);
  return [...all.filter(row => row.tracked), ...all.filter(row => !row.tracked).slice(0, 600)];
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
