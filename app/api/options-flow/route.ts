import { logError } from "@/lib/server/logger";
import { optionsFlowRequest } from "@/lib/server/optionsFlow";
import { HttpError, isSameOriginRequest, readJson } from "@/lib/server/security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store, private" };
  if (!isSameOriginRequest(request, { allowMissingOrigin: true })) return Response.json({ error: "Same-origin requests only." }, { status: 403, headers });
  try {
    return Response.json(await optionsFlowRequest(await readJson(request, 4096), request.signal), { headers });
  } catch (error) {
    if (!(error instanceof HttpError)) logError("api.optionsFlow.error", error);
    return Response.json({ error: error instanceof HttpError ? error.message : "Optionsflow nicht verfügbar." },
      { status: error instanceof HttpError ? error.status : 503, headers });
  }
}
