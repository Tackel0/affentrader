import { logError } from "@/lib/server/logger";
import { optionsChainRequest } from "@/lib/server/optionsChain";
import { HttpError, isSameOriginRequest } from "@/lib/server/security";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, max-age=30" };
  if (!isSameOriginRequest(request, { allowMissingOrigin: true })) {
    return Response.json({ error: "Same-origin requests only." }, { status: 403, headers });
  }
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol") ?? "";
  const expiry = url.searchParams.get("expiry") ?? "near";
  if (!symbol || symbol.length > 32) {
    return Response.json({ error: "Symbol erforderlich." }, { status: 400, headers });
  }
  try {
    const data = await optionsChainRequest(symbol, expiry, request.signal);
    return Response.json(data, { headers });
  } catch (error) {
    if (!(error instanceof HttpError)) logError("api.optionsChain.error", error);
    return Response.json(
      { error: error instanceof HttpError ? error.message : "Optionsdaten vorübergehend nicht verfügbar." },
      { status: error instanceof HttpError ? error.status : 503, headers },
    );
  }
}
