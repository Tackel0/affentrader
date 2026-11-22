import { isSymbolId } from "@/lib/symbolId";
import { logError } from "@/lib/server/logger";
import { fetchUsClosePrices } from "@/lib/server/usMarketClose";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("symbols") ?? "";
  const symbols = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  if (!symbols.length) {
    return Response.json({ error: "Missing symbols query parameter." }, { status: 400 });
  }
  if (symbols.length > 60 || !symbols.every(isSymbolId)) {
    return Response.json({ error: "Invalid symbols query parameter." }, { status: 400 });
  }
  try {
    const snapshot = await fetchUsClosePrices(symbols);
    return Response.json(snapshot, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (error) {
    logError("api.usClose.error", error, { count: symbols.length });
    return Response.json({ error: "US close reference prices unavailable." }, { status: 503 });
  }
}
