import { NextRequest, NextResponse } from "next/server";
import { HttpError, isAuthorized, readJson } from "@/lib/server/security";
import { logError } from "@/lib/server/logger";
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
  const rawAfter = request.nextUrl.searchParams.get("after");
  let after = 0;
  if (rawAfter !== null && rawAfter !== "") {
    const parsed = Number(rawAfter);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
    }
    after = parsed;
  }
  try {
    return NextResponse.json(await listEvents(after));
  } catch (error) {
    logError("api.alerts.events.get", error);
    return NextResponse.json({ error: "Alert service error." }, { status: 500 });
  }
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
    if (
      !e ||
      typeof e !== "object" ||
      Array.isArray(e) ||
      typeof e.name !== "string" ||
      !e.name.trim() ||
      typeof e.symbol !== "string" ||
      typeof e.ruleId !== "string" ||
      !e.ruleId ||
      e.ruleId.length > 128
    )
      throw new HttpError(400, "Invalid event.");
    if (e.strategyFill !== undefined && !isPineOrderFill(e.strategyFill)) throw new HttpError(400, "Invalid strategy fill.");
    const timeframe = e.timeframe === undefined ? "15m" : String(e.timeframe);
    if (!isSymbolId(e.symbol) || !isValidInterval(timeframe)) throw new HttpError(400, "Invalid event market.");
    const price = e.price === undefined ? 0 : e.price;
    if (typeof price !== "number" || !Number.isFinite(price)) throw new HttpError(400, "Invalid event price.");
    const time = e.time === undefined ? Date.now() : e.time;
    if (typeof time !== "number" || !Number.isFinite(time) || time < 0) throw new HttpError(400, "Invalid event time.");
    if (e.message !== undefined && typeof e.message !== "string") throw new HttpError(400, "Invalid event message.");

    const webhook = body.webhook as { url?: unknown; secret?: unknown } | undefined;
    if (
      !webhook ||
      typeof webhook !== "object" ||
      Array.isArray(webhook) ||
      typeof webhook.url !== "string" ||
      !webhook.url
    ) {
      throw new HttpError(400, "A webhook is required.");
    }
    if (webhook.secret !== undefined && (typeof webhook.secret !== "string" || webhook.secret.length > 200)) {
      throw new HttpError(400, "Invalid webhook secret.");
    }
    parseWebhookUrl(webhook.url);
    const stored = await recordEvent(
      {
        ruleId: e.ruleId,
        name: e.name.slice(0, 100),
        symbol: e.symbol,
        timeframe,
        price,
        time,
        message: (e.message ?? "").slice(0, 500),
        source: "browser",
        ...(e.strategyFill ? { strategyFill: e.strategyFill } : {}),
        ...(e.simulated !== undefined ? { simulated: Boolean(e.simulated) } : {}),
      },
      { url: webhook.url, secret: webhook.secret },
    );
    return NextResponse.json({ queued: stored.seq });
  } catch (error) {
    if (error instanceof HttpError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof WebhookError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    logError("api.alerts.events.post", error);
    return NextResponse.json({ error: "Alert service error." }, { status: 500 });
  }
}
