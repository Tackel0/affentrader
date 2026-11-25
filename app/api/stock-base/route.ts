import { logError } from "@/lib/server/logger";
import { HttpError, readJson } from "@/lib/server/security";
import { InvalidStockBaseScan, scanStockBases } from "@/lib/server/stockBase";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const rawPage = params.get("page");
  let page = 0;
  if (rawPage !== null && rawPage !== "") {
    const parsed = Number(rawPage);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return Response.json({ error: "Choose a valid universe page." }, { status: 400 });
    }
    page = parsed;
  }
  try {
    return Response.json(
      await scanStockBases(params.get("market") ?? "us", page, undefined, undefined, undefined, request.signal),
      { headers: { "Cache-Control": "private, max-age=120" } },
    );
  } catch (error) {
    if (error instanceof InvalidStockBaseScan) return Response.json({ error: error.message }, { status: 400 });
    logError("api.stockBase.get", error);
    return Response.json({ error: "Completed market benchmark unavailable from Yahoo Finance. Try again later." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    // A batch contains at most 24 short tickers. Limit the body before parsing.
    const input = (await readJson(request, 2048)) as { market?: unknown; tickers?: unknown };
    if (typeof input.market !== "string" || !Array.isArray(input.tickers)) {
      throw new InvalidStockBaseScan("Market and watchlist tickers required.");
    }
    return Response.json(await scanStockBases(input.market, 0, undefined, undefined, input.tickers, request.signal));
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof InvalidStockBaseScan) return Response.json({ error: "Invalid watchlist batch or market." }, { status: 400 });
    logError("api.stockBase.post", error);
    return Response.json({ error: "Completed market benchmark unavailable from Yahoo Finance. Try again later." }, { status: 503 });
  }
}
