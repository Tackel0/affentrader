import { logError } from "@/lib/server/logger";
import { HttpError, isSameOriginRequest, readJson } from "@/lib/server/security";
import { alpacaBarsRequest } from "@/lib/server/alpaca";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store, private", "Pragma": "no-cache" };
  if (!isSameOriginRequest(request, { allowMissingOrigin: true })) return Response.json({ error: "Same-origin requests only." }, { status: 403, headers });
  try { return Response.json(await alpacaBarsRequest(await readJson(request, 8192)), { headers }); }
  catch (error) {
    if (!(error instanceof HttpError) || error.status >= 500) logError("api.alpaca.error", error);
    return Response.json({ error: error instanceof HttpError ? error.message : "IEX history is unavailable." }, { status: error instanceof HttpError ? error.status : 503, headers });
  }
}
