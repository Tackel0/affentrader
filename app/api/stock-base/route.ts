import { InvalidStockBaseScan, scanStockBases } from "@/lib/server/stockBase";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    return Response.json(await scanStockBases(params.get("market") ?? "us", Number(params.get("page") ?? 0)));
  } catch (error) {
    if (error instanceof InvalidStockBaseScan) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: "Completed market benchmark unavailable from Yahoo Finance. Try again later." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    // A batch contains at most 24 short tickers. Limit the body before parsing.
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "Watchlist batch required." }, { status: 400 });
    const decoder = new TextDecoder();
    let body = "", bytes = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 2048) { await reader.cancel(); return Response.json({ error: "Watchlist batch too large." }, { status: 413 }); }
      body += decoder.decode(part.value, { stream: true });
    }
    const input = JSON.parse(body + decoder.decode());
    if (typeof input?.market !== "string" || !Array.isArray(input.tickers)) throw new InvalidStockBaseScan("Market and watchlist tickers required.");
    return Response.json(await scanStockBases(input.market, 0, undefined, undefined, input.tickers, request.signal));
  } catch (error) {
    if (error instanceof InvalidStockBaseScan || error instanceof SyntaxError) return Response.json({ error: "Invalid watchlist batch or market." }, { status: 400 });
    return Response.json({ error: "Completed market benchmark unavailable from Yahoo Finance. Try again later." }, { status: 503 });
  }
}
