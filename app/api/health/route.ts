import { NextRequest, NextResponse } from "next/server";
import { runnerStatus } from "@/lib/server/alertRunner";
import { isAuthorizedWithoutCreatingKey } from "@/lib/server/security";
import { SITE_COOKIE, siteAccessConfig, validSiteSession } from "@/lib/server/siteAccess";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function readCookieFromHeader(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    if (part.slice(0, idx).trim() === name) {
      return part.slice(idx + 1).trim();
    }
  }
  return undefined;
}

async function isAuthenticatedHealthRequest(request?: Request | NextRequest): Promise<boolean> {
  if (!request) return false;
  const settings = siteAccessConfig();
  const cookie =
    "cookies" in request && typeof request.cookies?.get === "function"
      ? request.cookies.get(SITE_COOKIE)?.value
      : readCookieFromHeader(request.headers.get("cookie"), SITE_COOKIE);
  if (settings && validSiteSession(cookie, settings)) return true;
  if (request.headers.get("x-affentrader-key")) {
    return isAuthorizedWithoutCreatingKey(request).catch(() => false);
  }
  return false;
}

export async function GET(request: Request | NextRequest) {
  const revision = process.env.CONTAINER_APP_REVISION;
  const payload: Record<string, unknown> = {
    ok: true,
    status: "ok",
    timestamp: new Date().toISOString(),
    ...(revision ? { revision } : {}),
  };

  if (await isAuthenticatedHealthRequest(request)) {
    const status = runnerStatus();
    payload.uptimeSec = Math.floor(process.uptime());
    payload.runner = status
      ? {
          running: status.running,
          startedAt: status.startedAt,
          lastRunAt: status.lastRunAt,
          lastDurationMs: status.lastDurationMs,
          lastEvaluated: status.lastEvaluated,
          lastFired: status.lastFired,
          intervalMs: status.intervalMs,
          runs: status.runs,
          errorCount: status.lastErrors.length,
        }
      : null;
  }

  return NextResponse.json(payload, { status: 200, headers: NO_STORE_HEADERS });
}

export async function HEAD() {
  return new NextResponse(null, { status: 200, headers: NO_STORE_HEADERS });
}
