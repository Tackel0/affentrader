import { isYahooTicker } from "@/lib/symbolId";
import { yahooChart } from "@/lib/server/yahoo";
import { adjustForDividends } from "@/lib/market/yahoo";
import { completedStockDays } from "@/lib/screener/stockBase";
import { closingDrawdowns } from "@/lib/terminal/drawdown";

export const dynamic = "force-dynamic";
export const maxDuration = 25;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tickers = ["a", "b"].map(key => params.get(key)?.trim().toUpperCase() ?? "");
  const basis = params.get("basis") ?? "local";
  const retest = params.get("retest");
  if (retest !== null && !/^\d{4}-\d{2}-\d{2}$/.test(retest)) return Response.json({ error: "Use YYYY-MM-DD for the retest date." }, { status: 400 });
  if (!["local", "EUR", "USD", "GBP"].includes(basis)) return Response.json({ error: "Unsupported comparison currency." }, { status: 400 });
  if (!tickers.every(isYahooTicker) || tickers[0] === tickers[1]) return Response.json({ error: "Enter two different Yahoo symbols." }, { status: 400 });
  try {
    const now = Date.now(), end = Math.floor(now / 60_000) * 60, deadline = AbortSignal.timeout(18_000);
    const fetcher: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.any([deadline, request.signal, ...(init?.signal ? [init.signal] : [])]) });
    const load = async (ticker: string) => {
      const data = await yahooChart({ ticker, interval: "1d", period1: end - 180 * 86400, period2: end, extended: false }, fetcher);
      if (!data.meta.timezone || data.meta.timezone === "UTC" && !ticker.endsWith("=X")) throw new Error("Missing exchange timezone.");
      return { currency: data.meta.currency, bars: completedStockDays(adjustForDividends(data.bars, data.adjClose), data.meta.timezone, now) };
    };
    const [a, b] = await Promise.all(tickers.map(load));
    const isPence = (code: string) => code === "GBp" || code === "GBX";
    const currencies = [a.currency, b.currency].map(code => isPence(code) ? "GBP" : code);
    const scaleA = isPence(a.currency) ? .01 : 1;
    const scaleB = isPence(b.currency) ? .01 : 1;
    if (basis !== "local" && currencies.some(code => !/^[A-Z]{3}$/.test(code))) return Response.json({ error: "An instrument has no supported quote currency." }, { status: 422 });
    const rates = new Map(await Promise.all([...new Set(currencies)].filter(code => basis !== "local" && code !== basis).map(async code => {
      const data = await load(`${code}${basis}=X`);
      if (data.currency !== basis) throw new Error("Unexpected FX quote currency.");
      return [code, new Map(data.bars.map(bar => [bar.session, bar.close]))] as const;
    })));
    const other = new Map(b.bars.map(bar => [bar.session, bar.close]));
    const shared = a.bars.flatMap(bar => {
      const second = other.get(bar.session);
      const firstFx = rates.has(currencies[0]) ? rates.get(currencies[0])!.get(bar.session) : 1;
      const secondFx = rates.has(currencies[1]) ? rates.get(currencies[1])!.get(bar.session) : 1;
      if (!second || !firstFx || !secondFx) return [];
      const localA = bar.close * scaleA, localB = second * scaleB;
      return [{ session: bar.session, a: localA * firstFx, b: localB * secondFx, localA, localB }];
    });
    const latest = shared.at(-1);
    if (!latest || shared.length < 2) return Response.json({ error: "Fewer than two common completed sessions." }, { status: 422 });
    const summarize = (start: typeof latest, sessions: number) => {
      const first = latest.a / start.a, second = latest.b / start.b;
      const window = shared.slice(-sessions - 1);
      const maxDrawdownA = Math.min(...closingDrawdowns(window.map(bar => bar.a)).map(point => point.percent));
      const maxDrawdownB = Math.min(...closingDrawdowns(window.map(bar => bar.b)).map(point => point.percent));
      return { sessions, start: start.session, a: (first - 1) * 100, b: (second - 1) * 100, relative: (first / second - 1) * 100, localA: (latest.localA / start.localA - 1) * 100, localB: (latest.localB / start.localB - 1) * 100, maxDrawdownA, maxDrawdownB };
    };
    const rows = [1, 5, 20, 60].flatMap(sessions => {
      const start = shared.at(-1 - sessions);
      return start ? [summarize(start, sessions)] : [];
    });
    const series = shared.slice(-61).map(({ session, a, b }) => ({ session, a, b }));
    const retestIndex = series.findIndex(bar => bar.session === retest);
    const retestRow = retestIndex >= 0 && retestIndex < series.length - 1
      ? summarize(shared[shared.length - series.length + retestIndex], series.length - retestIndex - 1)
      : null;
    const latestSessions = [a.bars.at(-1)!.session, b.bars.at(-1)!.session];
    const firstSessions = new Set(a.bars.map(bar => bar.session));
    const unmatchedInstrumentDates = [
      a.bars.filter(bar => bar.session >= series[0].session && !other.has(bar.session)).length,
      b.bars.filter(bar => bar.session >= series[0].session && !firstSessions.has(bar.session)).length,
    ];
    const missingFxSessions = basis === "local" ? 0 : a.bars.filter(bar =>
      bar.session >= series[0].session && other.has(bar.session) &&
      currencies.some(currency => rates.has(currency) && !rates.get(currency)!.get(bar.session)),
    ).length;
    return Response.json({ tickers, basis, currencies, asOf: latest.session, observations: shared.length, latestSessions, unmatchedInstrumentDates, missingFxSessions, rows, retestRow, series });
  } catch {
    return Response.json({ error: "Yahoo Finance history is unavailable for this comparison." }, { status: 503 });
  }
}
