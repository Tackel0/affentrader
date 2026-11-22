import { describe, expect, it, vi } from "vitest";
import { BrowserRuleEngine } from "@/lib/alerts/browserEngine";
import { optionsFlowTicker, summarizeOptionsFlow } from "@/lib/market/optionsFlow";
import { historicalSetupOutcome, mergeSetupHistory, setupAlertRules, setupOverlays, type SetupRecord } from "@/lib/screener/setupJournal";
import { parseTerminalCommand } from "@/lib/terminal/commands";
import { useAlertStore } from "@/stores/useAlertStore";

const now = Date.UTC(2026, 10, 20, 16);
const iso = (delta: number) => new Date(now + delta).toISOString();
const contract = (option: string, strike: number) => `AAPL261127${option}${String(strike).padStart(8, "0")}`;
const print = (price: number, tradeAt = -1000, quoteAt = -2000) => ({
  latestTrade: { p: price, s: 10, t: iso(tradeAt) }, latestQuote: { bp: 1, ap: 1.2, t: iso(quoteAt) },
});
const setup: SetupRecord = {
  id: "YF:AAPL:vcp-squeeze@2026-11-19", symbol: "YF:AAPL", ticker: "AAPL", name: "Apple", label: "VCP",
  currency: "USD", session: "2026-11-19", observedAt: now, score: 78, tracked: true,
  levels: { lastClose: 105, entryZone: [99, 102], invalidation: 95, target1: 110, target2: 115, riskReward: 2 },
};
const bar = (session: string, open: number, low: number, high: number) => ({ session, open, low, high, close: open, time: Date.parse(session), volume: 1800 });

describe("terminal research signals", () => {
  it("only counts fresh signed executions with a preceding, unlocked quote", () => {
    const result = summarizeOptionsFlow("AAPL", { next_page_token: "fixture", snapshots: {
      [contract("C", 200_000)]: print(1.2),
      [contract("P", 200_000)]: print(1),
      [contract("C", 205_000)]: print(1.25),
      [contract("C", 210_000)]: print(1.1),
      [contract("P", 205_000)]: print(1.2, -3000, -2000),
      [contract("P", 210_000)]: print(1.2, -16 * 60_000, -16 * 60_000 - 1000),
      [contract("P", 215_000)]: print(1.2, -1000, -7000),
      [contract("P", 220_000)]: print(1.2, 2000, 1000),
      MSFT261127C00200000: print(1.2),
    } }, now);
    expect(result).toMatchObject({ bias: "bullish", classified: 3, contracts: 9, truncated: true, bearUnits: 0, bullUnits: 34.5 });
    expect(summarizeOptionsFlow("AAPL", { snapshots: {
      [contract("P", 200_000)]: print(1.2), [contract("P", 205_000)]: print(1.2), [contract("C", 205_000)]: print(1),
    } }, now)?.bias).toBe("bearish");
    expect(summarizeOptionsFlow("AAPL", { snapshots: { [contract("C", 200_000)]: print(1.2) } }, now)?.bias).toBe("insufficient");
    expect(summarizeOptionsFlow("AAPL", { error: "no feed" }, now)).toBeNull();
    expect(optionsFlowTicker("IEX:AAPL")).toBe("AAPL");
    expect(optionsFlowTicker("YF:VOD.L")).toBeNull();
    expect(optionsFlowTicker("BTCUSDT")).toBeNull();
  });

  it("preserves original levels and does not guess the sequence inside a daily candle", () => {
    expect(mergeSetupHistory([setup], [{ ...setup, tracked: false, score: 98 }])).toEqual([setup]);
    expect(setupOverlays(setup).map(level => level.kind === "hline" && level.price)).toEqual([99, 102, 95, 110, 115]);
    const entered = bar("2026-11-20", 104, 101, 105);
    const target = bar("2026-11-23", 105, 101, 113);
    const uncertain = bar("2026-11-23", 105, 93, 113);
    expect(historicalSetupOutcome(setup.levels, [entered, target])).toEqual({ status: "target", session: target.session });
    expect(historicalSetupOutcome(setup.levels, [entered, uncertain])?.status).toBe("ambiguous");
    expect(historicalSetupOutcome(setup.levels, [bar("2026-11-20", 94, 93, 113)])?.status).toBe("invalid");
    expect(historicalSetupOutcome(setup.levels, [bar("2026-11-20", 111, 108, 113)])?.status).toBe("waiting");
  });

  it("fires each setup alert once and only from a fresh exchange quote after activation", () => {
    const fire = vi.fn();
    const rules = setupAlertRules(setup, now);
    const quote = { price: 100, previous: 104, changePercent: 0, high: 100, low: 100, volume: 1, simulated: true, time: now };
    const engine = new BrowserRuleEngine({ rules: () => rules, bars: () => [], quote: () => quote, ensure: async () => {}, now: () => now + 1000, fire });
    engine.prime();
    engine.onPrice(setup.symbol, "quote");
    quote.simulated = false;
    quote.time = now - 1;
    engine.onPrice(setup.symbol, "quote");
    expect(fire).not.toHaveBeenCalled();
    quote.time = now + 1;
    engine.onPrice(setup.symbol, "quote");
    engine.onPrice(setup.symbol, "quote");
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire.mock.calls[0][0].id).toMatch(/:entry$/);
    quote.time = now + 20;
    quote.price = 94;
    engine.onPrice(setup.symbol, "quote");
    expect(fire).toHaveBeenCalledTimes(2);
    expect(fire.mock.calls[1][0].id).toMatch(/:stop$/);
  });

  it("opens setup, filing and flow views through terminal commands", () => {
    expect(parseTerminalCommand("JOURNAL")).toMatchObject({ view: "journal" });
    expect(parseTerminalCommand("AAPL INSIDER")).toMatchObject({ view: "insiders", ticker: "AAPL" });
    expect(parseTerminalCommand("AAPL OPTIONSFLOW")).toMatchObject({ view: "optionsflow", ticker: "AAPL" });
  });

  it("disarms a pending entry when the paired stop alert invalidates a setup", () => {
    const previous = useAlertStore.getState();
    const [entry, stop] = setupAlertRules(setup, now);
    try {
      useAlertStore.setState({ rules: [entry, stop], events: [] });
      expect(previous.recordFiring({ id: "test-stop", ruleId: stop.id, name: stop.name, symbol: setup.symbol,
        timeframe: "1D", price: 94, time: now + 1000, message: stop.name, source: "browser", simulated: false })).toBe(true);
      expect(useAlertStore.getState().rules.map(rule => rule.status)).toEqual(["paused", "triggered"]);
    } finally { useAlertStore.setState(previous, true); }
  });
});
