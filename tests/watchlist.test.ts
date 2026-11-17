import { beforeEach, describe, expect, it } from "vitest";
import {
  columnValue,
  makeSection,
  MAX_LIST_SYMBOLS,
  normalizeSymbol,
  parseWatchlistText,
  sortEntries,
  watchlistCsv,
} from "@/lib/watchlist";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import { parseWorkspace } from "@/lib/workspace";
import type { Quote } from "@/types/trading";

const quote = (symbol: string, price: number, changePercent: number, volume = 100): Quote => ({
  symbol,
  price,
  previous: price,
  change: (price * changePercent) / 100,
  changePercent,
  high: price * 1.1,
  low: price * 0.9,
  volume,
  history: [price * 0.99, price],
  time: 0,
  simulated: false,
});

describe("symbol normalization", () => {
  it("accepts exchange-prefixed, separated and bare tickers", () => {
    expect(normalizeSymbol("BINANCE:BTCUSDT")).toBe("BTCUSDT");
    expect(normalizeSymbol("btc/usdt")).toBe("BTCUSDT");
    expect(normalizeSymbol("ETH-USDT")).toBe("ETHUSDT");
    expect(normalizeSymbol("sol")).toBe("SOLUSDT");
    expect(normalizeSymbol("ETHBTC")).toBe("ETHBTC");
    expect(normalizeSymbol("BTCUSDT.P")).toBe("BTCUSDT");
  });
  it("rejects junk", () => {
    expect(normalizeSymbol("")).toBeNull();
    expect(normalizeSymbol("!!!")).toBeNull();
    expect(normalizeSymbol("THISISWAYTOOLONGTOBEATICKER")).toBeNull();
  });
});

describe("importing lists", () => {
  it("parses lines, separators, duplicates, sections and rejects", () => {
    const parsed = parseWatchlistText("BTCUSDT\nETH, SOL;AVAX btcusdt\n###Layer 1\n??\nDOT");
    expect(parsed.entries).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT", "AVAXUSDT", "###Layer 1", "DOTUSDT"]);
    expect(parsed.rejected).toEqual(["??"]);
  });
  it("reads a CSV export, ignoring its numeric columns", () => {
    const csv = "symbol,last,change\r\nBTCUSDT,81000,1.2\r\nETHUSDT,2400,-0.4\r\n";
    expect(parseWatchlistText(csv).entries).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(parseWatchlistText("BTCUSDT,81000,1.5\nETHUSDT,2400,2").entries).toEqual(["BTCUSDT", "ETHUSDT"]);
  });
  it("handles a byte-order mark", () => {
    expect(parseWatchlistText("﻿BTCUSDT").entries).toEqual(["BTCUSDT"]);
  });
});

describe("sorting and export", () => {
  const quotes = {
    AAAUSDT: quote("AAAUSDT", 10, 5, 50),
    BBBUSDT: quote("BBBUSDT", 20, -3, 500),
    CCCUSDT: quote("CCCUSDT", 5, 1, 5),
  };
  const entries = ["CCCUSDT", makeSection("S"), "AAAUSDT", "BBBUSDT", "NOQUOTE"];
  it("sorts by any column and keeps missing quotes last", () => {
    expect(sortEntries(entries, quotes, { column: "changePercent", direction: "desc" })).toEqual([
      "AAAUSDT",
      "CCCUSDT",
      "BBBUSDT",
      "NOQUOTE",
    ]);
    expect(sortEntries(entries, quotes, { column: "volume", direction: "asc" }).slice(0, 3)).toEqual([
      "CCCUSDT",
      "AAAUSDT",
      "BBBUSDT",
    ]);
    expect(sortEntries(entries, quotes, { column: "symbol", direction: "asc" })[0]).toBe("AAAUSDT");
    expect(sortEntries(entries, quotes, null)).toEqual(entries);
  });
  it("sorts by flag colour", () => {
    const flags = { BBBUSDT: "red", AAAUSDT: "blue" } as const;
    expect(sortEntries(entries, quotes, { column: "flag", direction: "asc" }, flags).slice(0, 2)).toEqual(["BBBUSDT", "AAAUSDT"]);
  });
  it("computes derived column values", () => {
    expect(columnValue("quoteVolume", quotes.AAAUSDT)).toBeNull();
    expect(columnValue("range", quotes.AAAUSDT)).toBeCloseTo(0.5, 5);
    expect(columnValue("last", undefined)).toBeNull();
  });
  it("exports CSV with quoting and flags", () => {
    const csv = watchlistCsv(["AAAUSDT", makeSection("A, B")], quotes, { AAAUSDT: "green" });
    const [header, row, section] = csv.split("\r\n");
    expect(header).toContain("change_percent");
    expect(row.startsWith("AAAUSDT,10,")).toBe(true);
    expect(row.split(",")[7]).toBe("green");
    expect(header).toContain("range_resolution");
    expect(section).toBe('"###A, B"');
  });
});

describe("watchlist store", () => {
  beforeEach(() => {
    useWatchlistStore.setState({
      lists: [{ id: "a", name: "A", symbols: ["BTCUSDT"] }, { id: "b", name: "B", symbols: [] }],
      activeId: "a",
      sort: null,
    });
  });
  it("caps lists at the Premium size and reports the overflow", () => {
    const text = Array.from({ length: MAX_LIST_SYMBOLS + 50 }, (_, i) => `T${i.toString(36).toUpperCase().padStart(4, "0")}USDT`).join("\n");
    const result = useWatchlistStore.getState().importText(text, { mode: "replace" });
    expect(result.added).toBe(MAX_LIST_SYMBOLS);
    expect(result.truncated).toBe(true);
    const list = useWatchlistStore.getState().lists[0];
    expect(list.symbols).toHaveLength(MAX_LIST_SYMBOLS);
    expect(useWatchlistStore.getState().addSymbols(["EXTRAUSDT"])).toBe(0);
  });
  it("appends without duplicates, creates new lists and moves symbols", () => {
    const store = useWatchlistStore.getState();
    store.importText("BTCUSDT\nETHUSDT", { mode: "append" });
    expect(useWatchlistStore.getState().lists[0].symbols).toEqual(["BTCUSDT", "ETHUSDT"]);
    store.importText("SOLUSDT", { mode: "new", name: "Third" });
    expect(useWatchlistStore.getState().lists.at(-1)).toMatchObject({ name: "Third", symbols: ["SOLUSDT"] });
    useWatchlistStore.getState().select("a");
    useWatchlistStore.getState().moveSymbols(["ETHUSDT"], "b");
    expect(useWatchlistStore.getState().lists[1].symbols).toEqual(["ETHUSDT"]);
    expect(useWatchlistStore.getState().lists[0].symbols).toEqual(["BTCUSDT"]);
    useWatchlistStore.getState().moveSymbols(["BTCUSDT"], "b", true);
    expect(useWatchlistStore.getState().lists[0].symbols).toEqual(["BTCUSDT"]);
    expect(useWatchlistStore.getState().lists[1].symbols).toContain("BTCUSDT");
  });
  it("flags symbols and forgets flags with the symbol", () => {
    const store = useWatchlistStore.getState();
    store.setFlag("BTCUSDT", "red");
    expect(useWatchlistStore.getState().lists[0].flags).toEqual({ BTCUSDT: "red" });
    store.removeSymbol("BTCUSDT");
    expect(useWatchlistStore.getState().lists[0].flags).toEqual({});
  });
  it("round-trips large lists through workspace validation", () => {
    const symbols = Array.from({ length: 1000 }, (_, i) => `T${i}USDT`);
    const data = {
      version: 1,
      chart: { state: { symbol: "BTCUSDT", timeframe: "15m", chartType: "candles", feedMode: "auto", indicators: [], drawings: {}, pineLibraries: {} } },
      watchlists: { state: { lists: [{ id: "a", name: "Big", symbols: [...symbols, "###Section"], flags: { T1USDT: "red" } }], activeId: "a" } },
      alerts: { state: { alerts: [], logs: [] } },
    };
    expect(() => parseWorkspace(JSON.stringify(data))).not.toThrow();
    data.watchlists.state.lists[0].flags = { T1USDT: "pink" } as never;
    expect(() => parseWorkspace(JSON.stringify(data))).toThrow(/Invalid watchlist/);
  });
});
