import { POPULAR } from "@/lib/markets";
import { SYMBOLS } from "@/lib/symbols";
import { isYahooTicker, symbolInfo, yahooSymbol } from "@/lib/symbolId";

export interface ParsedOrderSpec {
  action: "BUY" | "SELL";
  ticker: string;
  qty?: number;
  price?: number;
}

export type OrderParseResult =
  | { matched: false }
  | { matched: true; ok: true; order: ParsedOrderSpec }
  | { matched: true; ok: false; reason: string };

export type OrderExecutionPlan =
  | {
      ok: true;
      action: "BUY" | "SELL";
      ticker: string;
      targetSymbol: string;
      quantity: number;
      type: "market" | "limit";
      price?: number;
    }
  | { ok: false; reason: string };

const POSITIVE_NUMBER_RE = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

const NON_TRADEABLE_INDEX_SET = new Set<string>([
  ...POPULAR.index.map((item) => item.ticker.toUpperCase()),
  "SPX",
  "NDX",
  "DJI",
  "DJIA",
  "RUT",
  "VIX",
  "DXY",
  "TNX",
  "TYX",
  "IRX",
]);

function parsePositiveNumber(token: string): number | null {
  if (!POSITIVE_NUMBER_RE.test(token)) return null;
  const value = Number(token);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function stripPricePrefix(token: string): string {
  return token.replace(/^@/, "").replace(/^\$/, "");
}

function parseOrderArgs(
  rest: readonly string[],
  action: "BUY" | "SELL",
  ticker: string,
): OrderParseResult {
  if (rest.length === 0) {
    return { matched: true, ok: true, order: { action, ticker } };
  }

  let qty: number | undefined;
  let price: number | undefined;
  let idx = 0;

  const first = rest[0];
  if (first === "@") {
    if (!rest[1]) {
      return {
        matched: true,
        ok: false,
        reason: `Missing limit price after @. Usage: ${action} ${ticker} [QTY] @ <PRICE>.`,
      };
    }
    const parsedPrice = parsePositiveNumber(stripPricePrefix(rest[1]));
    if (parsedPrice === null) {
      return {
        matched: true,
        ok: false,
        reason: `Invalid limit price "${rest[1]}". Price must be a positive number.`,
      };
    }
    price = parsedPrice;
    idx = 2;
  } else if (first.startsWith("@")) {
    const rawPrice = stripPricePrefix(first);
    const parsedPrice = parsePositiveNumber(rawPrice);
    if (parsedPrice === null) {
      return {
        matched: true,
        ok: false,
        reason: `Invalid limit price "${first}". Usage: ${action} ${ticker} [QTY] @ <PRICE>.`,
      };
    }
    price = parsedPrice;
    idx = 1;
  } else {
    const parsedQty = parsePositiveNumber(first);
    if (parsedQty === null) {
      return {
        matched: true,
        ok: false,
        reason: `Invalid order quantity "${first}". Quantity must be a positive number.`,
      };
    }
    qty = parsedQty;
    idx = 1;
  }

  if (idx < rest.length) {
    if (price !== undefined) {
      return {
        matched: true,
        ok: false,
        reason: `Unexpected extra token "${rest[idx]}" in order command.`,
      };
    }
    const next = rest[idx];
    if (next === "@") {
      const priceToken = rest[idx + 1];
      if (!priceToken) {
        return {
          matched: true,
          ok: false,
          reason: `Missing limit price after @. Usage: ${action} ${ticker} ${qty ?? 100} @ <PRICE>.`,
        };
      }
      const parsedPrice = parsePositiveNumber(stripPricePrefix(priceToken));
      if (parsedPrice === null) {
        return {
          matched: true,
          ok: false,
          reason: `Invalid limit price "${priceToken}". Price must be a positive number.`,
        };
      }
      price = parsedPrice;
      idx += 2;
    } else if (next.startsWith("@")) {
      const parsedPrice = parsePositiveNumber(stripPricePrefix(next));
      if (parsedPrice === null) {
        return {
          matched: true,
          ok: false,
          reason: `Invalid limit price "${next}". Price must be a positive number.`,
        };
      }
      price = parsedPrice;
      idx += 1;
    } else {
      const parsedPrice = parsePositiveNumber(stripPricePrefix(next));
      if (parsedPrice === null) {
        return {
          matched: true,
          ok: false,
          reason: `Invalid limit price "${next}". Price must be a positive number.`,
        };
      }
      price = parsedPrice;
      idx += 1;
    }
  }

  if (idx < rest.length) {
    return {
      matched: true,
      ok: false,
      reason: `Unexpected extra token "${rest[idx]}" in order command.`,
    };
  }

  return {
    matched: true,
    ok: true,
    order: { action, ticker, qty, price },
  };
}

/**
 * Parses `BUY <TICKER> [QTY] [@ PRICE]` and `<TICKER> BUY [QTY] [@ PRICE]` (plus `SELL`).
 * Rejects malformed, zero, or negative quantities/prices instead of falling back silently.
 */
export function parseOrderTokens(tokens: readonly string[]): OrderParseResult {
  if (!tokens.length) return { matched: false };

  let action: "BUY" | "SELL" | null = null;
  let candidateTicker = "";
  let rest: readonly string[] = [];

  if (tokens[0] === "BUY" || tokens[0] === "SELL") {
    action = tokens[0];
    if (tokens.length < 2) {
      return {
        matched: true,
        ok: false,
        reason: `Missing ticker. Usage: ${action} <TICKER> [QTY] [@ PRICE].`,
      };
    }
    candidateTicker = tokens[1];
    rest = tokens.slice(2);
  } else if (tokens[1] === "BUY" || tokens[1] === "SELL") {
    action = tokens[1];
    candidateTicker = tokens[0];
    rest = tokens.slice(2);
  } else {
    return { matched: false };
  }

  if (
    !candidateTicker ||
    candidateTicker === "BUY" ||
    candidateTicker === "SELL" ||
    !isYahooTicker(candidateTicker) ||
    /^\d+$/.test(candidateTicker)
  ) {
    return {
      matched: true,
      ok: false,
      reason: `Invalid order ticker "${candidateTicker}". Usage: ${action} <TICKER> [QTY] [@ PRICE].`,
    };
  }

  return parseOrderArgs(rest, action, candidateTicker);
}

export function isNonTradeableIndex(ticker: string, targetSymbol?: string): boolean {
  const upper = ticker.trim().toUpperCase();
  if (!upper) return true;
  if (upper.startsWith("^") || NON_TRADEABLE_INDEX_SET.has(upper)) return true;
  if (targetSymbol && symbolInfo(targetSymbol)?.type === "index") return true;
  return false;
}

export function resolveOrderTargetSymbol(ticker: string): string {
  const upper = ticker.trim().toUpperCase();
  if (SYMBOLS.some((s) => s.symbol === upper)) return upper;
  return yahooSymbol(upper);
}

/**
 * Validates tradeability and converts a parsed terminal order command into a Paper Trading ticket payload.
 */
export function resolveOrderExecution(spec: ParsedOrderSpec): OrderExecutionPlan {
  const upper = spec.ticker.trim().toUpperCase();
  const targetSymbol = resolveOrderTargetSymbol(upper);

  if (isNonTradeableIndex(upper, targetSymbol)) {
    return {
      ok: false,
      reason: `${upper} is a cash index and cannot be traded directly. Stage orders on an equity or ETF proxy (e.g., SPY, QQQ).`,
    };
  }

  const quantity = spec.qty ?? 100;
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      ok: false,
      reason: `Invalid order quantity "${spec.qty}". Quantity must be greater than zero.`,
    };
  }

  if (spec.price !== undefined && (!Number.isFinite(spec.price) || spec.price <= 0)) {
    return {
      ok: false,
      reason: `Invalid limit price "${spec.price}". Price must be greater than zero.`,
    };
  }

  return {
    ok: true,
    action: spec.action,
    ticker: upper,
    targetSymbol,
    quantity,
    type: spec.price !== undefined ? "limit" : "market",
    price: spec.price,
  };
}
