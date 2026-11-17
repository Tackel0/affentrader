import { afterEach, describe, expect, it, vi } from "vitest";
import { scryptSync } from "node:crypto";
import { NextRequest } from "next/server";
import { createSiteSession, matchesSitePassword, safeReturnPath, SESSION_SECONDS, SITE_COOKIE, siteAccessConfig, validSiteSession } from "@/lib/server/siteAccess";
import { proxy } from "@/proxy";

const salt = "a".repeat(32);
const settings = { passwordHash: `${salt}:${scryptSync("test-password", salt, 64).toString("hex")}`, secret: "b".repeat(64) };
function configure() {
  vi.stubEnv("AFFENTRADER_SITE_PASSWORD_HASH", settings.passwordHash);
  vi.stubEnv("AFFENTRADER_SITE_SESSION_SECRET", settings.secret);
}
function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) { return new NextRequest(`http://localhost:3000${path}`, init); }
afterEach(() => vi.unstubAllEnvs());

describe("private site access", () => {
  it("fails closed without valid server configuration", async () => {
    vi.stubEnv("AFFENTRADER_SITE_PASSWORD_HASH", "");
    expect(siteAccessConfig()).toBeNull();
    expect((await proxy(request("/"))).status).toBe(503);
  });
  it("verifies passwords without trimming or accepting oversized inputs", async () => {
    expect(await matchesSitePassword("test-password", settings)).toBe(true);
    expect(await matchesSitePassword("wrong", settings)).toBe(false);
    expect(await matchesSitePassword("test-password ", settings)).toBe(false);
    expect(await matchesSitePassword("x".repeat(513), settings)).toBe(false);
  });
  it("rejects forged, expired, future and password-rotated sessions", () => {
    const now = 1_800_000_000_000, token = createSiteSession(settings, now);
    expect(validSiteSession(token, settings, now)).toBe(true);
    expect(validSiteSession(token, settings, now + SESSION_SECONDS * 1000)).toBe(false);
    expect(validSiteSession(token, settings, now - 1000)).toBe(false);
    expect(validSiteSession(token.slice(0, -1) + (token.endsWith("0") ? "1" : "0"), settings, now)).toBe(false);
    expect(validSiteSession(token, { ...settings, passwordHash: settings.passwordHash + "a" }, now)).toBe(false);
    expect(validSiteSession(undefined, settings, now)).toBe(false);
  });
  it("keeps return paths local and prevents login loops", () => {
    for (const path of ["//evil.test", "https://evil.test", "/\\evil.test", "/login", "/logout", "/\nheader"]) expect(safeReturnPath(path)).toBe("/");
    expect(safeReturnPath("/?symbol=BTC")).toBe("/?symbol=BTC");
  });
  it("blocks pages, static assets, RSC requests and API requests without a cookie", async () => {
    configure();
    for (const path of ["/", "/_next/static/chunk.js", "/?_rsc=1", "/icon.svg"]) {
      const response = await proxy(request(path));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain("/login?");
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect((await proxy(request("/api/alerts"))).status).toBe(401);
    expect((await proxy(request("/sw.js"))).headers.get("x-middleware-next")).toBe("1");
  });
  it("renders an isolated escaped login form with no client-side password", async () => {
    configure();
    const response = await proxy(request("/login?next=" + encodeURIComponent('/?q="<script>')));
    const html = await response.text();
    expect(html).toContain("Privater Workspace");
    expect(html).toContain("/?q=%22%3Cscript%3E");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain(settings.passwordHash);
    expect(html).not.toContain("test-password");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
  it("rejects wrong passwords and cross-origin login submissions", async () => {
    configure();
    const init = { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://localhost:3000" }, body: "password=wrong" };
    expect((await proxy(request("/login", init))).status).toBe(401);
    expect((await proxy(request("/login", { ...init, headers: { ...init.headers, origin: "https://evil.test" } }))).status).toBe(403);
  });
  it("creates an HttpOnly session, admits authenticated requests and supports logout", async () => {
    configure();
    const response = await proxy(request("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://localhost:3000" }, body: "password=test-password&next=%2F" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(response.headers.get("set-cookie")).toMatch(/SameSite=strict/i);
    const token = response.cookies.get(SITE_COOKIE)!.value;
    const admitted = await proxy(request("/api/alerts", { headers: { cookie: `${SITE_COOKIE}=${token}` } }));
    expect(admitted.headers.get("x-middleware-next")).toBe("1");
    const logout = await proxy(request("/logout", { method: "POST", headers: { origin: "http://localhost:3000" } }));
    expect(logout.cookies.get(SITE_COOKIE)?.maxAge).toBe(0);
    expect((await proxy(request("/logout"))).status).toBe(405);
  });
  it("sets Secure cookies on HTTPS and limits body size", async () => {
    configure();
    const response = await proxy(new NextRequest("https://example.test/login", { method: "POST", headers: { origin: "https://example.test", "content-type": "application/x-www-form-urlencoded" }, body: "password=test-password" }));
    expect(response.cookies.get(SITE_COOKIE)?.secure).toBe(true);
    expect((await proxy(request("/login", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/x-www-form-urlencoded" }, body: "password=" + "x".repeat(5000) }))).status).toBe(413);
  });
  it("accepts the actual Host when production normalizes its bind address", async () => {
    configure();
    const response = await proxy(new NextRequest("http://0.0.0.0:3000/login", { method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/x-www-form-urlencoded" }, body: "password=test-password" }));
    expect(response.status).toBe(303);
  });
});
