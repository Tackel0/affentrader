import { OPTIONS_FLOW_SYMBOL_LIMIT, summarizeOptionsFlow, type OptionsFlowSummary } from "@/lib/market/optionsFlow";
import { validAlpacaCredentials } from "@/lib/market/alpaca";
import { IEX_TICKER } from "@/lib/symbolId";
import { HttpError } from "./security";

export async function optionsFlowRequest(input: unknown, signal: AbortSignal, fetcher = fetch, now = Date.now()) {
  const request = input as { tickers?: unknown; credentials?: unknown } | null;
  if (!request || !validAlpacaCredentials(request.credentials) || !Array.isArray(request.tickers) ||
    request.tickers.length < 1 || request.tickers.length > OPTIONS_FLOW_SYMBOL_LIMIT ||
    !request.tickers.every(ticker => typeof ticker === "string" && IEX_TICKER.test(ticker))) {
    throw new HttpError(400, "Gültige Alpaca-Verbindung und bis zu acht US-Ticker erforderlich.");
  }
  const tickers = [...new Set<string>(request.tickers)];
  const credentials = request.credentials;
  const result: Record<string, OptionsFlowSummary> = {};
  const unavailable: Record<string, string> = {};
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(13_000)]);
  const tradingDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const query = new URLSearchParams({
    feed: "opra", limit: "1000", expiration_date_gte: tradingDate.format(now),
    expiration_date_lte: tradingDate.format(now + 21 * 86_400_000),
  });
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, tickers.length) }, async () => {
    while (cursor < tickers.length) {
      const ticker = tickers[cursor++];
      try {
        const response = await fetcher(`https://data.alpaca.markets/v1beta1/options/snapshots/${encodeURIComponent(ticker)}?${query}`, {
          headers: { "APCA-API-KEY-ID": credentials.key, "APCA-API-SECRET-KEY": credentials.secret },
          cache: "no-store", redirect: "error", signal: deadline,
        });
        if (response.status === 401 || response.status === 403) {
          unavailable[ticker] = "Der Alpaca-Zugang benötigt OPRA-Berechtigung.";
          continue;
        }
        if (response.status === 429) {
          unavailable[ticker] = "Der Datenanbieter begrenzt die Abfragen gerade.";
          continue;
        }
        if (!response.ok) throw new Error("Optionsdaten fehlen.");
        const summary = summarizeOptionsFlow(ticker, await response.json(), now);
        if (!summary) throw new Error("Optionsdaten fehlen.");
        result[ticker] = summary;
      } catch {
        unavailable[ticker] = "Optionsdaten vorübergehend nicht verfügbar.";
      }
    }
  }));
  return { result, unavailable, source: "Alpaca OPRA" };
}
