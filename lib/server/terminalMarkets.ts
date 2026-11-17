import { completedStockDays } from "@/lib/screener/stockBase";
import { TERMINAL_MARKETS, type TerminalMarketRow } from "@/lib/terminal/markets";
import { yahooChart } from "./yahoo";

const DAY = 86_400_000;
let cache: { expires: number; rows: TerminalMarketRow[] } | undefined;
let pending: Promise<TerminalMarketRow[]> | undefined;

async function load(now: number): Promise<TerminalMarketRow[]> {
  const deadline = AbortSignal.timeout(18_000);
  const fetcher: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline });
  const end = Math.floor(now / 60_000) * 60;
  return Promise.all(TERMINAL_MARKETS.map(async market => {
    try {
      const data = await yahooChart({ ticker: market.ticker, interval: "1d", period1: end - 60 * 86400, period2: end, extended: false }, fetcher);
      const bars = completedStockDays(data.bars, data.meta.timezone, now);
      const latest = bars.at(-1);
      if (!latest || !data.meta.currency || now - latest.time > 7 * DAY) return { ...market, quote: null };
      const change = (sessions: number) => {
        const prior = bars.at(-1 - sessions);
        return prior ? 100 * (latest.close / prior.close - 1) : null;
      };
      return { ...market, quote: { session: latest.session, currency: data.meta.currency, close: latest.close, changes: { 1: change(1), 5: change(5), 20: change(20) } } };
    } catch {
      return { ...market, quote: null };
    }
  }));
}

export async function terminalMarkets(): Promise<TerminalMarketRow[]> {
  const now = Date.now();
  if (cache && now < cache.expires) return cache.rows;
  pending ??= load(now).then(rows => {
    cache = { rows, expires: Date.now() + (rows.every(row => row.quote) ? 300_000 : 30_000) };
    return rows;
  }).finally(() => { pending = undefined; });
  return pending;
}
