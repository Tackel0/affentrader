import { NextRequest, NextResponse } from "next/server";
import { HttpError, isAuthorized, readJson } from "@/lib/server/security";
import { logError } from "@/lib/server/logger";
import {
  deleteRule,
  listEvents,
  publicRule,
  store,
  upsertRule,
  updateWatchlistMembers,
  controlRule,
  updateLinkedDrawing,
  type AlertControl,
} from "@/lib/server/alertService";
import { WebhookError, deliverWebhook } from "@/lib/server/webhooks";
import { runnerStatus, startAlertRunner } from "@/lib/server/alertRunner";
import type { AlertRule } from "@/types/alerts";

export const dynamic = "force-dynamic";

function failure(error: unknown) {
  if (error instanceof HttpError)
    return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof WebhookError)
    return NextResponse.json({ error: error.message }, { status: 400 });
  logError("api.alerts.error", error);
  return NextResponse.json({ error: "Alert service error." }, { status: 500 });
}

async function guard(request: NextRequest) {
  if (!(await isAuthorized(request)))
    return NextResponse.json(
      { error: "Missing or invalid server access key." },
      { status: 401 },
    );
  return null;
}

/** List server-side rules, recent events and evaluator health. */
export async function GET(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const db = await store.read();
    const { events, cursor } = await listEvents(0, 100);
    const status = runnerStatus() ?? startAlertRunner();
    return NextResponse.json({
      rules: db.rules.map(publicRule),
      events,
      cursor,
      runner: status,
      serverTime: Date.now(),
    });
  } catch (error) {
    return failure(error);
  }
}

/** Create or replace a rule. A webhook secret of "••••••••" keeps the stored one. */
export async function PUT(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const body = (await readJson(request, 3_000_000)) as { rule?: unknown };
    if (!body.rule || typeof body.rule !== "object" || Array.isArray(body.rule))
      throw new HttpError(400, "Missing rule.");
    const rule = body.rule as AlertRule;
    if (rule.webhook?.secret === "••••••••") {
      const existing = (await store.read()).rules.find((r) => r.id === rule.id);
      rule.webhook = { ...rule.webhook, secret: existing?.webhook?.secret };
    }
    const saved = await upsertRule(rule);
    return NextResponse.json({ rule: publicRule(saved) });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id || id.length > 128) return NextResponse.json({ error: "Missing or invalid id." }, { status: 400 });
    return NextResponse.json({ removed: await deleteRule(id) });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const body = await readJson(request) as { id?: unknown; symbols?: unknown; action?: unknown; drawing?: unknown; expected?: unknown };
    if (typeof body.id !== "string" || !body.id || body.id.length > 128) throw new HttpError(400, "Missing rule id.");
    if(Object.hasOwn(body,"drawing")){
      if(body.action!==undefined||body.symbols!==undefined||typeof body.expected!=="string")throw new HttpError(400,"Invalid drawing update.");
      return NextResponse.json({rule:publicRule(await updateLinkedDrawing(body.id,body.expected,body.drawing as import("@/types/drawingAlerts").DrawingAlertGeometry|null))});
    }
    if (body.action !== undefined) {
      if (body.symbols !== undefined || typeof body.action !== "string" || !["pause", "resume", "restart", "restart_symbols"].includes(body.action)) throw new HttpError(400, "Invalid alert control action.");
      return NextResponse.json({ rule: publicRule(await controlRule(body.id, body.action as AlertControl)) });
    }
    return NextResponse.json({ rule: publicRule(await updateWatchlistMembers(body.id, body.symbols)) });
  } catch (error) { return failure(error); }
}

/** Send a test delivery to a webhook without storing anything. */
export async function POST(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const body = (await readJson(request)) as {
      action?: unknown;
      webhook?: unknown;
    };
    const webhook = body.webhook as { url?: unknown; secret?: unknown } | undefined;
    if (
      body.action !== "test" ||
      !webhook ||
      typeof webhook !== "object" ||
      Array.isArray(webhook) ||
      typeof webhook.url !== "string" ||
      !webhook.url
    ) {
      throw new HttpError(400, "Expected { action: 'test', webhook: { url } }.");
    }
    if (webhook.secret !== undefined && (typeof webhook.secret !== "string" || webhook.secret.length > 200)) {
      throw new HttpError(400, "Invalid webhook secret.");
    }
    await deliverWebhook(webhook.url, webhook.secret, {
      event: "alert.test",
      rule: { id: "test", name: "Webhook test" },
      symbol: "BTCUSDT",
      timeframe: "15m",
      price: 0,
      time: Date.now(),
      message: "Test delivery from Affentrader.",
      source: "server",
    });
    return NextResponse.json({ delivered: true });
  } catch (error) {
    return failure(error);
  }
}
