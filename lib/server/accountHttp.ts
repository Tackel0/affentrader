import { NextRequest, NextResponse } from "next/server";
import { ACCOUNT_SCOPE_COOKIE } from "@/lib/accountScope";
import { ACCOUNT_COOKIE, AccountError, createAccountSession, createPasswordAccount, revokeAccountSession, verifyPasswordAccount, type Account } from "./accounts";
import { isSameOriginRequest } from "./security";
import { matchesSitePassword, safeReturnPath, SESSION_SECONDS, SITE_COOKIE, siteAccessConfig, takeLoginAttempt } from "./siteAccess";
import { siteLoginPage, type SignInMode } from "./siteLoginPage";

export const accountHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow",
};

export function secureAccountRequest(request: NextRequest): boolean {
  return request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase() === "https";
}

export function accountOrigin(request: NextRequest): string {
  const host = request.headers.get("host") ?? request.nextUrl.host;
  if (!/^[a-z0-9.[\]:-]+$/i.test(host)) return request.nextUrl.origin;
  return `${secureAccountRequest(request) ? "https" : "http"}://${host}`;
}

export function accountHtml(html: string, status = 200) {
  return new NextResponse(html, { status, headers: { ...accountHeaders,
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; manifest-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  } });
}

export function googleSettings() {
  const clientId = process.env.AFFENTRADER_GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.AFFENTRADER_GOOGLE_CLIENT_SECRET?.trim();
  const configured = process.env.AFFENTRADER_GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !configured) return null;
  try {
    const redirect = new URL(configured);
    if ((redirect.protocol !== "https:" && !(redirect.protocol === "http:" && ["localhost", "127.0.0.1"].includes(redirect.hostname))) ||
      redirect.pathname !== "/api/account/google/callback" || redirect.username || redirect.password || redirect.search || redirect.hash) return null;
    return { clientId, clientSecret, redirect };
  } catch { return null; }
}

export function clearAccountCookies(response: NextResponse, request: NextRequest) {
  const settings = { secure: secureAccountRequest(request), sameSite: "lax", path: "/", maxAge: 0 } as const;
  response.cookies.set(ACCOUNT_COOKIE, "", { ...settings, httpOnly: true });
  response.cookies.set(ACCOUNT_SCOPE_COOKIE, "", settings);
}

export async function accountSignInResponse(request: NextRequest, user: Account, next: string, origin = accountOrigin(request)) {
  const token = await createAccountSession(user.id);
  await revokeAccountSession(request.cookies.get(ACCOUNT_COOKIE)?.value);
  const response = NextResponse.redirect(new URL(safeReturnPath(next), origin), { status: 303, headers: accountHeaders });
  const settings = { secure: secureAccountRequest(request), sameSite: "lax", path: "/", maxAge: SESSION_SECONDS } as const;
  response.cookies.set(ACCOUNT_COOKIE, token, { ...settings, httpOnly: true });
  response.cookies.set(ACCOUNT_SCOPE_COOKIE, user.id, settings);
  response.cookies.set(SITE_COOKIE, "", { ...settings, httpOnly: true, maxAge: 0 });
  return response;
}

async function readAccountForm(request: NextRequest) {
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) throw new AccountError(400, "Ungültiges Formular.");
  const reader = request.body?.getReader();
  if (!reader) throw new AccountError(400, "Das Formular ist leer.");
  const values: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > 4096) { await reader.cancel(); throw new AccountError(413, "Die Eingabe ist zu lang."); }
    values.push(chunk.value);
  }
  return new URLSearchParams(Buffer.concat(values).toString("utf8"));
}

export async function passwordAccountForm(request: NextRequest, mode: Extract<SignInMode, "account" | "register">) {
  let next = "/";
  const failure = (status: number, message: string) => accountHtml(siteLoginPage(next, message, mode, Boolean(googleSettings())), status);
  const config = siteAccessConfig();
  if (!config) return failure(503, "Der Workspace-Zugang ist noch nicht eingerichtet.");
  if (!isSameOriginRequest(request, { allowMissingOrigin: false, fallbackHost: request.nextUrl.host })) return failure(403, "Öffne die Anmeldung auf diesem Workspace erneut.");
  if (!takeLoginAttempt()) return failure(429, "Zu viele Anmeldeversuche. Bitte warte eine Minute.");
  try {
    const form = await readAccountForm(request);
    next = safeReturnPath(form.get("next"));
    const email = form.get("email") ?? "", password = form.get("password") ?? "";
    if (mode === "register" && !await matchesSitePassword(form.get("invite") ?? "", config)) return failure(403, "Das Website-Passwort zur Freischaltung ist ungültig.");
    const user = mode === "register" ? await createPasswordAccount(email, password) : await verifyPasswordAccount(email, password);
    return user ? await accountSignInResponse(request, user, next) : failure(401, "E-Mail oder Passwort ist ungültig.");
  } catch (error) {
    return error instanceof AccountError ? failure(error.status, error.message) : failure(503, "Das Konto ist vorübergehend nicht erreichbar.");
  }
}
