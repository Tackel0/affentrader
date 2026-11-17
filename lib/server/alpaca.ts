import { HttpError } from "./security";
import { validAlpacaCredentials, alpacaError, parseIexOhlcv, SIP_HISTORY_DELAY_MS } from "@/lib/market/alpaca";
import { IEX_TICKER } from "@/lib/symbolId";
/** Fixed read-only stock bars endpoint. SIP history uses a delayed cutoff. */
export async function alpacaBarsRequest(input: unknown, fetcher: typeof fetch = fetch) {
  if (!input || typeof input !== "object") throw new HttpError(400, "Invalid IEX request.");
  const q = input as Record<string, unknown>;
  if (!validAlpacaCredentials(q.credentials) || typeof q.ticker !== "string" || !IEX_TICKER.test(q.ticker) || !["1Min", "1Day"].includes(String(q.timeframe)) || typeof q.end !== "number" || !Number.isFinite(q.end) || q.end < Date.UTC(2016, 0, 1) || q.end > Date.now() + 60_000 || typeof q.limit !== "number" || !Number.isInteger(q.limit) || q.limit < 1 || q.limit > 10_000 || q.pageToken !== undefined && (typeof q.pageToken !== "string" || q.pageToken.length > 4096)) throw new HttpError(400, "Invalid IEX history parameters or credentials.");
  const feed = q.feed ?? "iex";
  if (feed !== "iex" && feed !== "sip") throw new HttpError(400, "Unknown Alpaca history feed.");
  const end = feed === "sip" ? Math.min(q.end, Date.now() - SIP_HISTORY_DELAY_MS) : q.end;
  const query = new URLSearchParams({ symbols: q.ticker, timeframe: String(q.timeframe), start: "2016-01-01T00:00:00Z", end: new Date(end).toISOString(), limit: String(q.limit), feed, adjustment: "raw", sort: "desc" });
  if (q.pageToken) query.set("page_token", String(q.pageToken));
  let response: Response;
  try { response = await fetcher(`https://data.alpaca.markets/v2/stocks/bars?${query}`, { headers: { "APCA-API-KEY-ID": q.credentials.key, "APCA-API-SECRET-KEY": q.credentials.secret }, cache: "no-store", signal: AbortSignal.timeout(20_000), redirect: "error" }); }
  catch { throw new HttpError(503, "Alpaca stock history could not be reached."); }
  if (!response.ok) throw new HttpError([401, 403, 429].includes(response.status) ? response.status : 503,
    feed === "sip" && response.status === 403 ? "Alpaca denied SIP history access. Check your credentials and data permissions." : alpacaError(response.status));
  let body: { bars?: Record<string, unknown[]>; next_page_token?: unknown };
  try { body = await response.json(); } catch { throw new HttpError(502, "Invalid IEX history response."); }
  if (!body || typeof body !== "object" || !body.bars || !Array.isArray(body.bars[q.ticker]) && body.bars[q.ticker] !== undefined) throw new HttpError(502, "Invalid IEX history response.");
  const bars = (body.bars[q.ticker] ?? []).map(parseIexOhlcv).filter(bar => bar !== null)
    .filter(bar => feed !== "sip" || bar.time <= end);
  return { bars, nextPage: typeof body.next_page_token === "string" ? body.next_page_token : null };
}
