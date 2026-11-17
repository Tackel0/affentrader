import { NextRequest, NextResponse } from "next/server";
import { HttpError, isAuthorized, readJson } from "@/lib/server/security";
import { listEvents, recordEvent } from "@/lib/server/alertService";
import { WebhookError, parseWebhookUrl } from "@/lib/server/webhooks";
import type { AlertRule, RuleEvent } from "@/types/alerts";
import { isPineOrderFill } from "@/lib/alerts/pineValidation";
import { isSymbolId } from "@/lib/symbolId";
import { isValidInterval } from "@/lib/market/intervals";

export const dynamic = "force-dynamic";

/** Events after a cursor; the browser polls this to surface background alerts. */
export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request)))
    return NextResponse.json({ error: "Missing or invalid server access key." }, { status: 401 });
  const after = Number(request.nextUrl.searchParams.get("after") ?? 0);
  return NextResponse.json(await listEvents(Number.isFinite(after) ? after : 0));
}

/**
 * Hand a browser-fired alert to the server so its webhook is delivered with
 * retries even if the tab is closed right after.
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request)))
    return NextResponse.json({ error: "Missing or invalid server access key." }, { status: 401 });
  try {
    const body = (await readJson(request)) as {
      event?: Partial<RuleEvent>;
      webhook?: AlertRule["webhook"];
    };
    const e = body.event;
    if (!e || typeof e.name !== "string" || typeof e.symbol !== "string" || typeof e.ruleId !== "string")
      throw new HttpError(400, "Invalid event.");
    if (e.strategyFill !== undefined && !isPineOrderFill(e.strategyFill)) throw new HttpError(400, "Invalid strategy fill.");
    const timeframe = String(e.timeframe ?? "15m");
    if (!isSymbolId(e.symbol) || !isValidInterval(timeframe)) throw new HttpError(400, "Invalid event market.");
    if (!body.webhook?.url) throw new HttpError(400, "A webhook is required.");
    parseWebhookUrl(body.webhook.url);
    const stored = await recordEvent(
      {
        ruleId: e.ruleId,
        name: e.name.slice(0, 100),
        symbol: e.symbol,
        timeframe,
        price: Number(e.price) || 0,
        time: Number(e.time) || Date.now(),
        message: String(e.message ?? "").slice(0, 500),
        source: "browser",
        ...(e.strategyFill ? { strategyFill: e.strategyFill } : {}),
        ...(e.simulated !== undefined ? { simulated: Boolean(e.simulated) } : {}),
      },
      { url: body.webhook.url, secret: body.webhook.secret?.slice(0, 200) },
    );
    return NextResponse.json({ queued: stored.seq });
  } catch (error) {
    if (error instanceof HttpError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof WebhookError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Alert service error." }, { status: 500 });
  }
}
