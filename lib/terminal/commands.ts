import { isYahooTicker } from "@/lib/symbolId";
import { parseOrderTokens } from "./orders";

export type TerminalView =
  | "opps"
  | "journal"
  | "insiders"
  | "optionsflow"
  | "social"
  | "fa"
  | "scan"
  | "markets"
  | "compare"
  | "capm"
  | "noise"
  | "macro"
  | "news"
  | "heatmap"
  | "osint"
  | "help";

export type ParsedTerminalCommand =
  | { kind: "view"; view: TerminalView; ticker?: string }
  | { kind: "chart"; ticker: string }
  | { kind: "flow"; ticker?: string }
  | { kind: "capm"; ticker?: string }
  | { kind: "layout"; mode: "single" | "split-2" | "split-3" }
  | { kind: "pane"; pane: "p1" | "p2" | "p3" }
  | { kind: "clear" }
  | { kind: "order"; action: "BUY" | "SELL"; ticker: string; qty?: number; price?: number }
  | { kind: "unknown"; raw: string };

/**
 * Parses Bloomberg-style AffenTerminal commands such as:
 * - Layout: `SPLIT 1`, `SPLIT 2`, `SPLIT 3`, `1-PANE`, `2-PANE`, `3-PANE`, `GRID`, `PANE 1`, `PANE 2`, `PANE 3`, `CLEAR`
 * - Orders: `BUY AAPL`, `BUY AAPL 100`, `SELL NVDA 50`, `BUY TSLA 10 @ 250`
 * - Shortcuts: `HELP`, `QUOTE <TICKER>`, `DES <TICKER>`, `WEI`
 * - Views: `OPPS`, `SCAN`, `VALUE`, `FA`, `FLOW`, `CHART`, `MACRO`, `NEWS`, `MARKETS`, `COMPARE`, `HEATMAP`, `NOISE`
 * - Tickers: `AAPL <GO>`, `AAPL GO`, `AAPL GP`, `AAPL CHART`, `AAPL`
 * - Two-token: `QCOM FA`, `QCOM VALUE`, `AAPL CAPM`, `SPY NOISE`, `NVDA FLOW`, `MSFT NEWS`
 */
export function tokenizeTerminalCommand(raw: string): string[] {
  const cleaned = raw
    .trim()
    .replace(/<GO>$/i, "")
    .trim()
    .toUpperCase();
  if (!cleaned) return [];
  return cleaned.split(/\s+/).filter((t) => t !== "GO" && t !== "<GO>");
}

export function parseTerminalCommand(raw: string, currentTicker = "AAPL"): ParsedTerminalCommand {
  const tokens = tokenizeTerminalCommand(raw);
  const firstRaw = raw.trim();
  if (!firstRaw) return { kind: "unknown", raw };
  if (!tokens.length) return { kind: "chart", ticker: currentTicker };

  // 1. Order staging commands: BUY/SELL <TICKER> [QTY] [@ PRICE] or <TICKER> BUY/SELL [QTY] [@ PRICE]
  const orderResult = parseOrderTokens(tokens);
  if (orderResult.matched) {
    if (orderResult.ok) {
      return { kind: "order", ...orderResult.order };
    }
    return { kind: "unknown", raw };
  }

  // 2. Single token commands
  if (tokens.length === 1) {
    const first = tokens[0];
    switch (first) {
      case "1-PANE":
      case "SINGLE":
        return { kind: "layout", mode: "single" };
      case "2-PANE":
      case "SPLIT":
        return { kind: "layout", mode: "split-2" };
      case "3-PANE":
      case "GRID":
        return { kind: "layout", mode: "split-3" };
      case "CLEAR":
      case "CLS":
      case "RESET":
        return { kind: "clear" };
      case "OPPS":
      case "OPPORTUNITIES":
      case "SETUPS":
      case "ORDER":
      case "TRADE":
        return { kind: "view", view: "opps" };
      case "JOURNAL":
        return { kind: "view", view: "journal" };
      case "INSIDER":
        return { kind: "view", view: "insiders" };
      case "OPTIONSFLOW":
      case "OPTIONS":
      case "WALLS":
      case "GEX":
      case "MAXPAIN":
        return { kind: "view", view: "optionsflow" };
      case "SOCIAL":
        return { kind: "view", view: "social" };
      case "SCAN":
      case "BASES":
        return { kind: "view", view: "scan" };
      case "VALUE":
      case "FA":
      case "FUNDAMENTALS":
      case "DES":
        return { kind: "view", view: "fa", ticker: currentTicker };
      case "FLOW":
      case "FOOTPRINT":
      case "ORDERFLOW":
        return { kind: "flow" };
      case "CHART":
      case "GP":
        return { kind: "chart", ticker: currentTicker };
      case "MACRO":
      case "CALENDAR":
      case "YIELDS":
        return { kind: "view", view: "macro" };
      case "NEWS":
        return { kind: "view", view: "news" };
      case "MARKETS":
      case "WEI":
        return { kind: "view", view: "markets" };
      case "COMPARE":
      case "COMP":
        return { kind: "view", view: "compare" };
      case "HEATMAP":
        return { kind: "view", view: "heatmap" };
      case "NOISE":
      case "NOISEMETER":
      case "GAP":
      case "GAPS":
      case "STREAK":
      case "STREAKS":
        return { kind: "view", view: "noise", ticker: currentTicker };
      case "OSINT":
      case "TANKER":
      case "AIS":
      case "FLIGHTS":
      case "ADSB":
      case "MAP":
        return { kind: "view", view: "osint" };
      case "CAPM":
      case "BETA":
        return { kind: "capm", ticker: currentTicker };
      case "HELP":
      case "?":
        return { kind: "view", view: "help" };
      default:
        if (isYahooTicker(first)) {
          return { kind: "chart", ticker: first };
        }
        return { kind: "unknown", raw };
    }
  }

  // 3. Two token commands
  if (tokens.length === 2) {
    const [first, second] = tokens;

    // Layout commands: SPLIT 1, SPLIT 2, SPLIT 3
    if (first === "SPLIT") {
      if (second === "1" || second === "SINGLE") return { kind: "layout", mode: "single" };
      if (second === "2") return { kind: "layout", mode: "split-2" };
      if (second === "3" || second === "GRID") return { kind: "layout", mode: "split-3" };
    }

    // Pane focus commands: PANE 1, PANE 2, PANE 3
    if (first === "PANE") {
      if (second === "1" || second === "P1") return { kind: "pane", pane: "p1" };
      if (second === "2" || second === "P2") return { kind: "pane", pane: "p2" };
      if (second === "3" || second === "P3") return { kind: "pane", pane: "p3" };
    }

    // Specific shortcuts: QUOTE <TICKER>, DES <TICKER>
    if (first === "QUOTE" && isYahooTicker(second) && !/^\d+$/.test(second)) {
      return { kind: "chart", ticker: second };
    }
    if (second === "QUOTE" && isYahooTicker(first) && !/^\d+$/.test(first)) {
      return { kind: "chart", ticker: first };
    }
    if (first === "DES" && isYahooTicker(second) && !/^\d+$/.test(second)) {
      return { kind: "view", view: "fa", ticker: second };
    }
    if (second === "DES" && isYahooTicker(first) && !/^\d+$/.test(first)) {
      return { kind: "view", view: "fa", ticker: first };
    }

    // General two-token commands: `<TICKER> <ACTION>` or `<ACTION> <TICKER>`
    const actionTokens = ["FA", "VALUE", "FUNDAMENTALS", "CAPM", "BETA", "NOISE", "NOISEMETER", "GAP", "GAPS", "STREAK", "GP", "CHART", "FLOW", "FOOTPRINT", "ORDERFLOW", "NEWS", "OPPS", "SCAN", "INSIDER", "OPTIONSFLOW", "OPTIONS", "WALLS", "GEX", "MAXPAIN", "SOCIAL"];
    const actionFirst = actionTokens.includes(first) && isYahooTicker(second) && !/^\d+$/.test(second);
    const actionSecond = actionTokens.includes(second) && isYahooTicker(first) && !/^\d+$/.test(first);

    if (actionFirst || actionSecond) {
      const ticker = actionFirst ? second : first;
      const action = actionFirst ? first : second;

      if (!isYahooTicker(ticker)) return { kind: "unknown", raw };

      switch (action) {
        case "GP":
        case "CHART":
          return { kind: "chart", ticker };
        case "FA":
        case "VALUE":
        case "FUNDAMENTALS":
          return { kind: "view", view: "fa", ticker };
        case "INSIDER":
          return { kind: "view", view: "insiders", ticker };
        case "OPTIONSFLOW":
        case "OPTIONS":
        case "WALLS":
        case "GEX":
        case "MAXPAIN":
          return { kind: "view", view: "optionsflow", ticker };
        case "SOCIAL":
          return { kind: "view", view: "social", ticker };
        case "NOISE":
        case "NOISEMETER":
        case "GAP":
        case "GAPS":
        case "STREAK":
          return { kind: "view", view: "noise", ticker };
        case "CAPM":
        case "BETA":
          return { kind: "capm", ticker };
        case "FLOW":
        case "FOOTPRINT":
        case "ORDERFLOW":
          return { kind: "flow", ticker };
        case "NEWS":
          return { kind: "view", view: "news", ticker };
        case "OPPS":
        case "SCAN":
          return { kind: "view", view: action === "OPPS" ? "opps" : "scan", ticker };
        default:
          return { kind: "unknown", raw };
      }
    }
  }

  // Any other tokens
  return { kind: "unknown", raw };
}
