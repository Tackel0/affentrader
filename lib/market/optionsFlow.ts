import { IEX_TICKER } from "@/lib/symbolId";
import { exchangeOfTicker } from "@/lib/markets";

export const OPTIONS_FLOW_SYMBOL_LIMIT = 8;
export const OPTIONS_FLOW_WINDOW_MS = 15 * 60_000;
export const OPTIONS_FLOW_REFRESH_MS = 60_000;
export type OptionsBias = "bullish" | "bearish" | "balanced" | "insufficient";
export interface OptionFlowPrint {
  contract: string;
  option: "call" | "put";
  side: "buy" | "sell";
  price: number;
  size: number;
  time: number;
}
export interface OptionsFlowSummary {
  ticker: string;
  asOf: number;
  newestTrade: number | null;
  contracts: number;
  truncated: boolean;
  bullUnits: number;
  bearUnits: number;
  classified: number;
  bias: OptionsBias;
  prints: OptionFlowPrint[];
}

export function optionsFlowTicker(symbol: string): string | null {
  const ticker = /^(?:YF|IEX|SIP):(.+)$/.exec(symbol)?.[1];
  return ticker && IEX_TICKER.test(ticker) && (!symbol.startsWith("YF:") || exchangeOfTicker(ticker).id === "us") ? ticker : null;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const timestamp = (value: unknown) => typeof value === "string" ? Date.parse(value) : NaN;

export function summarizeOptionsFlow(ticker: string, payload: unknown, now: number): OptionsFlowSummary | null {
  const response = record(payload), snapshots = record(response?.snapshots);
  if (!snapshots) return null;
  const pairs = Object.entries(snapshots);
  const prints: OptionFlowPrint[] = [];
  let bullUnits = 0, bearUnits = 0;
  for (const [contract, value] of pairs.slice(0, 1000)) {
    const parsed = /^([A-Z0-9.]{1,15})(\d{6})([CP])\d{8}$/.exec(contract);
    const root = ticker.replace(/[.-]/g, "");
    if (!parsed || parsed[1].replace(/[.-]/g, "") !== root) continue;
    const row = record(value), trade = record(row?.latestTrade), quote = record(row?.latestQuote);
    if (!trade || !quote || !finite(trade.p) || !finite(trade.s) || trade.p <= 0 || !Number.isSafeInteger(trade.s) || trade.s <= 0 ||
      !finite(quote.bp) || !finite(quote.ap) || quote.bp <= 0 || quote.ap <= quote.bp) continue;
    const tradeTime = timestamp(trade.t), quoteTime = timestamp(quote.t);
    if (!Number.isFinite(tradeTime) || !Number.isFinite(quoteTime) || tradeTime < now - OPTIONS_FLOW_WINDOW_MS ||
      tradeTime > now || quoteTime >= tradeTime || tradeTime - quoteTime > 5000) continue;
    const side = trade.p >= quote.ap ? "buy" : trade.p <= quote.bp ? "sell" : null;
    if (!side) continue;
    const option = parsed[3] === "C" ? "call" : "put";
    const units = trade.p * trade.s;
    if (!Number.isFinite(units) || !Number.isFinite(bullUnits + bearUnits + units)) continue;
    if ((option === "call") === (side === "buy")) bullUnits += units;
    else bearUnits += units;
    prints.push({ contract, option, side, price: trade.p, size: trade.s, time: tradeTime });
  }
  prints.sort((a, b) => b.time - a.time);
  const total = bullUnits + bearUnits;
  const bias = prints.length < 3 || total <= 0 ? "insufficient" : bullUnits / total >= 0.6
    ? "bullish" : bearUnits / total >= 0.6 ? "bearish" : "balanced";
  return {
    ticker, asOf: now, newestTrade: prints[0]?.time ?? null, contracts: Math.min(pairs.length, 1000),
    truncated: Boolean(response?.next_page_token) || pairs.length > 1000,
    bullUnits, bearUnits, classified: prints.length, bias, prints: prints.slice(0, 12),
  };
}

export const optionsBiasLabels: Record<OptionsBias, string> = {
  bullish: "Bullischer Flow", bearish: "Bärischer Flow", balanced: "Gemischter Flow", insufficient: "Zu wenig Flow-Daten",
};
