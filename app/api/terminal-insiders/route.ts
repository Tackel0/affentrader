import { fetchSecEdgarForm4Summary } from "@/lib/server/fundamentals";
import { logError } from "@/lib/server/logger";
import { IEX_TICKER } from "@/lib/symbolId";
import { exchangeOfTicker } from "@/lib/markets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ticker = new URL(request.url).searchParams.get("ticker")?.trim().toUpperCase() ?? "";
  if (!IEX_TICKER.test(ticker) || exchangeOfTicker(ticker).id !== "us") return Response.json({ error: "Gib einen gültigen US-Ticker ein." }, { status: 400 });
  const now = Date.now();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(18_000)]);
  const summary = await fetchSecEdgarForm4Summary(ticker, fetch, now, { maxXmlDocs: 12, signal }).catch((error) => {
    logError("api.terminalInsiders.error", error, { ticker });
    return null;
  });
  if (!summary) return Response.json({ error: "SEC-Meldungen vorübergehend nicht verfügbar." }, { status: 503 });
  return Response.json({
    ticker, observedAt: now, source: "SEC EDGAR", verified: summary.xmlVerified,
    filings: summary.xmlVerified ? summary.filings : [],
  }, { headers: { "Cache-Control": "private, max-age=60" } });
}
