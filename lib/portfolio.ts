import { csvEscape } from "./watchlist";
import { isSymbolId } from "./symbolId";

export interface Lot {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  time: number;
  note?: string;
}

export interface Portfolio {
  id: string;
  name: string;
  lots: Lot[];
}

export interface Holding {
  symbol: string;
  quantity: number;
  /** Average cost of the quantity still held (average-cost method). */
  avgCost: number;
  invested: number;
  realized: number;
  fees: number;
}

/** Replay transactions in time order into per-symbol holdings. */
export function computeHoldings(lots: readonly Lot[]): Holding[] {
  const map = new Map<string, Holding>();
  for (const lot of [...lots].sort((a, b) => a.time - b.time)) {
    const h = map.get(lot.symbol) ?? { symbol: lot.symbol, quantity: 0, avgCost: 0, invested: 0, realized: 0, fees: 0 };
    h.fees += lot.fee;
    if (lot.side === "buy") {
      const cost = h.quantity * h.avgCost + lot.quantity * lot.price + lot.fee;
      h.quantity += lot.quantity;
      h.avgCost = h.quantity ? cost / h.quantity : 0;
    } else {
      const sold = Math.min(lot.quantity, h.quantity);
      h.realized += sold * (lot.price - h.avgCost) - lot.fee;
      h.quantity -= sold;
      if (h.quantity < 1e-12) {
        h.quantity = 0;
        h.avgCost = 0;
      }
    }
    h.invested = h.quantity * h.avgCost;
    map.set(lot.symbol, h);
  }
  return [...map.values()];
}

export interface ValuedHolding extends Holding {
  price: number | null;
  value: number;
  unrealized: number;
  returnPercent: number;
  /** Share of total portfolio value, 0–100. */
  weight: number;
  dayChangePercent: number | null;
}

export interface PortfolioSummary {
  holdings: ValuedHolding[];
  value: number;
  invested: number;
  unrealized: number;
  realized: number;
  fees: number;
  returnPercent: number;
}

export function valuePortfolio(
  holdings: readonly Holding[],
  prices: Record<string, { price: number; changePercent: number } | undefined>,
): PortfolioSummary {
  const open = holdings.filter((h) => h.quantity > 0);
  const valued = open.map((h) => {
    const quote = prices[h.symbol];
    const price = quote?.price ?? null;
    const value = price === null ? h.invested : h.quantity * price;
    return {
      ...h,
      price,
      value,
      unrealized: value - h.invested,
      returnPercent: h.invested ? ((value - h.invested) / h.invested) * 100 : 0,
      weight: 0,
      dayChangePercent: quote?.changePercent ?? null,
    };
  });
  const value = valued.reduce((s, h) => s + h.value, 0);
  for (const h of valued) h.weight = value ? (h.value / value) * 100 : 0;
  valued.sort((a, b) => b.value - a.value);
  const invested = valued.reduce((s, h) => s + h.invested, 0);
  return {
    holdings: valued,
    value,
    invested,
    unrealized: value - invested,
    realized: holdings.reduce((s, h) => s + h.realized, 0),
    fees: holdings.reduce((s, h) => s + h.fees, 0),
    returnPercent: invested ? ((value - invested) / invested) * 100 : 0,
  };
}

export function lotsToCsv(lots: readonly Lot[]): string {
  const header = "date,symbol,side,quantity,price,fee,note";
  return [
    header,
    ...[...lots]
      .sort((a, b) => a.time - b.time)
      .map((l) =>
        [new Date(l.time).toISOString(), l.symbol, l.side, l.quantity, l.price, l.fee, l.note ?? ""]
          .map(csvEscape)
          .join(","),
      ),
  ].join("\r\n");
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (c === '"') quoted = false;
      else current += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(current);
      current = "";
    } else current += c;
  }
  out.push(current);
  return out;
}

export interface ParsedLots {
  lots: Lot[];
  errors: string[];
}

/** Parse the CSV written by `lotsToCsv` (header optional). */
export function csvToLots(text: string, maxLots = 5000): ParsedLots {
  const lots: Lot[] = [];
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const start = /^date\s*,/i.test(lines[0] ?? "") ? 1 : 0;
  for (let i = start; i < lines.length && lots.length < maxLots; i++) {
    const [date, symbol, side, quantity, price, fee = "0", note = ""] = splitCsv(lines[i]);
    const time = Date.parse(date);
    const q = Number(quantity);
    const p = Number(price);
    const f = Number(fee || 0);
    if (
      !Number.isFinite(time) ||
      !isSymbolId((symbol ?? "").toUpperCase()) ||
      !["buy", "sell"].includes((side ?? "").toLowerCase()) ||
      !(q > 0) ||
      !(p >= 0) ||
      !(f >= 0)
    ) {
      errors.push(`Line ${i + 1}: invalid transaction`);
      continue;
    }
    lots.push({
      id: crypto.randomUUID(),
      symbol: symbol.toUpperCase(),
      side: side.toLowerCase() as Lot["side"],
      quantity: q,
      price: p,
      fee: f,
      time,
      note: note.slice(0, 200) || undefined,
    });
  }
  return { lots, errors };
}
