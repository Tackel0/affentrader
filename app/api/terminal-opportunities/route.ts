import { logError } from "@/lib/server/logger";
import { HttpError, readJson } from "@/lib/server/security";
import { InvalidOpportunityScan, scanTradeOpportunities } from "@/lib/server/opportunities";

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
      await scanTradeOpportunities(params.get("market") ?? "us", page),
    );
  } catch (error) {
    if (error instanceof InvalidOpportunityScan) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    logError("api.terminalOpportunities.get", error);
    return Response.json(
      { error: "Market benchmark or scanner data is temporarily unavailable. Try again shortly." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const input = (await readJson(request, 2048)) as { market?: unknown; tickers?: unknown };
    if (typeof input.market !== "string" || !Array.isArray(input.tickers)) {
      throw new InvalidOpportunityScan("Market and watchlist tickers required.");
    }
    return Response.json(await scanTradeOpportunities(input.market, 0, undefined, undefined, input.tickers, undefined, request.signal));
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof InvalidOpportunityScan) {
      return Response.json({ error: "Invalid watchlist batch or market." }, { status: 400 });
    }
    logError("api.terminalOpportunities.post", error);
    return Response.json(
      { error: "Market benchmark or scanner data is temporarily unavailable. Try again shortly." },
      { status: 503 },
    );
  }
}
