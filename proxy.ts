import { NextRequest, NextResponse } from "next/server";
import { apiRateBucketKey, isSameOriginRequest, takeApiAttempt } from "@/lib/server/security";
import { createSiteSession, matchesSitePassword, safeReturnPath, SESSION_SECONDS, SITE_COOKIE, siteAccessConfig, takeLoginAttempt, validSiteSession } from "@/lib/server/siteAccess";
import { siteLoginPage } from "@/lib/server/siteLoginPage";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";
const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
const HEAVY_GET_API_PATHS = new Set(["/api/terminal-opportunities", "/api/stock-base", "/api/screener"]);

// Browsers fetch manifests with credentials omitted per HTML spec, and push SWs reference icons before auth.
const PUBLIC_PWA_PATHS = new Set([
  "/manifest.webmanifest",
  "/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/screenshots/workspace-phone.png",
  "/screenshots/workspace-tablet.png",
]);

function isHttpsRequest(request: NextRequest): boolean {
  if (request.nextUrl.protocol === "https:") return true;
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return forwarded === "https";
}

function externalUrl(request: NextRequest, target: string): URL {
  const host = request.headers.get("host")?.trim();
  if (host && !/[\s/\\@?#]/.test(host)) {
    try {
      return new URL(target, `${isHttpsRequest(request) ? "https" : "http"}://${host}`);
    } catch {
      /* fallback to request.url */
    }
  }
  return new URL(target, request.url);
}

function appCsp(https: boolean): string {
  const directives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://data-api.binance.vision wss://data-stream.binance.vision https://api.kraken.com wss://ws.kraken.com wss://api.hyperliquid.xyz wss://stream.data.alpaca.markets wss://stream.bybit.com",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (https) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

function login(next: string, error = "", status = 200): NextResponse {
  return new NextResponse(siteLoginPage(next, error), { status, headers: {
    ...privateHeaders, "Content-Type": "text/html; charset=utf-8",
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; manifest-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  } });
}

function sameOrigin(request: NextRequest): boolean {
  return isSameOriginRequest(request, { allowMissingOrigin: false, fallbackHost: request.nextUrl.host });
}

export async function proxy(request: NextRequest) {
  const rawPath = request.nextUrl.pathname;
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, "") || "/" : rawPath;
  // This data-free worker must remain reachable to retire pre-gate offline caches.
  if (path === "/sw.js" && ["GET", "HEAD"].includes(request.method)) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'",
    );
    return response;
  }
  if (path === "/api/health" && ["GET", "HEAD"].includes(request.method)) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    return response;
  }
  const settings = siteAccessConfig();
  if (!settings) return new NextResponse("Der Website-Zugang ist noch nicht konfiguriert.", { status: 503, headers: privateHeaders });
  if (PUBLIC_PWA_PATHS.has(path) && ["GET", "HEAD"].includes(request.method)) {
    const response = NextResponse.next();
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Cache-Control", path === "/manifest.webmanifest" ? "no-store" : "public, max-age=3600");
    if (path === "/icon.svg") {
      response.headers.set(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox",
      );
    }
    return response;
  }
  const sessionCookie = request.cookies.get(SITE_COOKIE)?.value;
  const authenticated = validSiteSession(sessionCookie, settings);
  const secure = isHttpsRequest(request);
  const sessionCookieOptions = { httpOnly: true, sameSite: "lax", secure, path: "/" } as const;
  if (path === "/logout") {
    if (request.method !== "POST") return new NextResponse("POST required", { status: 405, headers: { ...privateHeaders, Allow: "POST" } });
    if (!sameOrigin(request)) return new NextResponse("Forbidden", { status: 403, headers: privateHeaders });
    const response = NextResponse.redirect(externalUrl(request, "/login"), 303);
    response.cookies.set(SITE_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
    for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
    return response;
  }
  if (path === "/login") {
    const next = safeReturnPath(request.nextUrl.searchParams.get("next"));
    if (request.method === "GET" || request.method === "HEAD") {
      return authenticated ? NextResponse.redirect(externalUrl(request, next), 303) : login(next);
    }
    if (request.method !== "POST") return new NextResponse("Method not allowed", { status: 405, headers: { ...privateHeaders, Allow: "GET, HEAD, POST" } });
    if (!sameOrigin(request)) return login(next, "Diese Anfrage wurde abgelehnt. Bitte öffne die Anmeldung erneut.", 403);
    if (!takeLoginAttempt()) {
      const response = login(next, "Zu viele Anmeldeversuche. Bitte warte eine Minute.", 429);
      response.headers.set("Retry-After", "60");
      return response;
    }
    if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return login(next, "Ungültige Anmeldung.", 400);
    const reader = request.body?.getReader();
    if (!reader) return login(next, "Bitte gib das Passwort ein.", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 4096) { await reader.cancel(); return login(next, "Die Eingabe ist zu lang.", 413); }
        chunks.push(chunk.value);
      }
    } catch { return login(next, "Die Anmeldung konnte nicht gelesen werden.", 400); }
    const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    const destination = safeReturnPath(form.get("next"));
    if (!await matchesSitePassword(form.get("password") ?? "", settings)) return login(destination, "Das Passwort ist nicht richtig.", 401);
    const response = NextResponse.redirect(externalUrl(request, destination), 303);
    response.cookies.set(SITE_COOKIE, createSiteSession(settings), { ...sessionCookieOptions, maxAge: SESSION_SECONDS });
    for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
    return response;
  }
  if (!authenticated) {
    if (path.startsWith("/api/") || !["GET", "HEAD"].includes(request.method)) return NextResponse.json({ error: "Website login required." }, { status: 401, headers: privateHeaders });
    const url = externalUrl(request, "/login");
    url.searchParams.set("next", safeReturnPath(path + request.nextUrl.search));
    return NextResponse.redirect(url, { status: 303, headers: privateHeaders });
  }
  if (path.startsWith("/api/") && sessionCookie) {
    const writes = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    const fetchSite = request.headers.get("sec-fetch-site");
    if (writes && (fetchSite === "cross-site" || fetchSite === "same-site"
      || (request.headers.has("origin") && !sameOrigin(request)))) {
      return NextResponse.json({ error: "Same-origin requests only." }, { status: 403, headers: privateHeaders });
    }
    const isHeavy = !["GET", "HEAD"].includes(request.method) || HEAVY_GET_API_PATHS.has(path);
    const tier = isHeavy ? "heavy" : "read";
    const limit = isHeavy ? 60 : 240;
    const rate = takeApiAttempt(apiRateBucketKey(sessionCookie, tier), limit);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
        {
          status: 429,
          headers: {
            ...privateHeaders,
            "Content-Security-Policy": API_CSP,
            "Permissions-Policy": PERMISSIONS_POLICY,
            "Retry-After": String(rate.retryAfterSec),
          },
        },
      );
    }
  }
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
  response.headers.set("Permissions-Policy", PERMISSIONS_POLICY);
  response.headers.set("Content-Security-Policy", path.startsWith("/api/") ? API_CSP : appCsp(secure));
  return response;
}
