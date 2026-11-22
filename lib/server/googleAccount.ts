import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { validWorkspaceProfile } from "@/lib/accountScope";
import { ACCOUNT_COOKIE, AccountError, connectGoogleAccount, readAccountSession } from "./accounts";
import { accountHeaders, accountHtml, accountOrigin, accountSignInResponse, googleSettings, secureAccountRequest } from "./accountHttp";
import { isSameOriginRequest } from "./security";
import { safeReturnPath, SITE_COOKIE, siteAccessConfig, takeLoginAttempt, validSiteSession } from "./siteAccess";
import { accountOverviewPage, siteLoginPage } from "./siteLoginPage";

const HANDSHAKE_COOKIE = "affentrader-google-handshake";
const HANDSHAKE_PATH = "/api/account/google";
const LIFETIME = 600;
interface Handshake { state: string; verifier: string; next: string; expires: number; linkId?: string; allowNew: boolean }

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(`affentrader-google-v1:${payload}`).digest("hex");
}

function readHandshake(cookie: string | undefined, secret: string): Handshake | null {
  const match = /^([A-Za-z0-9_-]{1,1300})\.([a-f0-9]{64})$/.exec(cookie ?? "");
  if (!match || !timingSafeEqual(Buffer.from(match[2], "hex"), Buffer.from(sign(match[1], secret), "hex"))) return null;
  try {
    const flow = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")) as Handshake;
    return Number.isSafeInteger(flow.expires) && flow.expires > Date.now() && /^[A-Za-z0-9_-]{32}$/.test(flow.state) &&
      /^[A-Za-z0-9_-]{64}$/.test(flow.verifier) && typeof flow.next === "string" && typeof flow.allowNew === "boolean" &&
      (flow.linkId === undefined || validWorkspaceProfile(flow.linkId)) ? flow : null;
  } catch { return null; }
}

const options = (request: NextRequest, maxAge: number) => ({ httpOnly: true, secure: secureAccountRequest(request), sameSite: "lax" as const, path: HANDSHAKE_PATH, maxAge });

export async function beginGoogleAccount(request: NextRequest) {
  const google = googleSettings(), access = siteAccessConfig();
  const next = safeReturnPath(request.nextUrl.searchParams.get("next"));
  if (!google || !access || accountOrigin(request) !== google.redirect.origin) {
    return accountHtml(siteLoginPage(next, "Die Google-Anmeldung ist auf dieser Adresse noch nicht eingerichtet.", "account"), 503);
  }
  if (!takeLoginAttempt()) return accountHtml(siteLoginPage(next, "Zu viele Anmeldeversuche. Bitte warte eine Minute.", "account", true), 429);
  const link = request.method === "POST";
  if (link && !isSameOriginRequest(request, { allowMissingOrigin: false, fallbackHost: request.nextUrl.host })) {
    return accountHtml(siteLoginPage(next, "Diese Anfrage wurde abgelehnt.", "account", true), 403);
  }
  const user = link ? await readAccountSession(request.cookies.get(ACCOUNT_COOKIE)?.value) : null;
  if (link && !user) return accountHtml(siteLoginPage(next, "Melde dich zuerst mit deinem Konto an.", "account", true), 401);
  const handshake: Handshake = {
    state: randomBytes(24).toString("base64url"), verifier: randomBytes(48).toString("base64url"),
    next: user ? "/konto" : next,
    expires: Date.now() + LIFETIME * 1000,
    linkId: user?.id, allowNew: !link && validSiteSession(request.cookies.get(SITE_COOKIE)?.value, access),
  };
  const payload = Buffer.from(JSON.stringify(handshake)).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: google.clientId, redirect_uri: google.redirect.href, response_type: "code",
    scope: "openid email", state: handshake.state, code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(handshake.verifier).digest("base64url"), prompt: "select_account" }).toString();
  const response = NextResponse.redirect(url, { status: 303, headers: accountHeaders });
  response.cookies.set(HANDSHAKE_COOKIE, `${payload}.${sign(payload, access.secret)}`, options(request, LIFETIME));
  return response;
}

export async function finishGoogleAccount(request: NextRequest, fetcher = fetch) {
  const access = siteAccessConfig(), google = googleSettings();
  const flow = access ? readHandshake(request.cookies.get(HANDSHAKE_COOKIE)?.value, access.secret) : null;
  const user = flow?.linkId ? await readAccountSession(request.cookies.get(ACCOUNT_COOKIE)?.value) : null;
  const clear = (response: NextResponse) => { response.cookies.set(HANDSHAKE_COOKIE, "", options(request, 0)); return response; };
  const failure = (status: number, message: string) => clear(accountHtml(user
    ? accountOverviewPage(user, Boolean(google), message)
    : siteLoginPage(flow?.next ?? "/", message, "account", Boolean(google)), status));
  const code = request.nextUrl.searchParams.get("code");
  if (!access || !google || accountOrigin(request) !== google.redirect.origin || !flow ||
    flow.state !== request.nextUrl.searchParams.get("state") || !code || code.length > 1024 ||
    (flow.linkId && user?.id !== flow.linkId)) return failure(400, "Die Google-Anmeldung ist abgelaufen oder wurde abgebrochen. Starte sie erneut.");
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
    const token = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST", signal, redirect: "error", cache: "no-store",
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: flow.verifier,
        client_id: google.clientId, client_secret: google.clientSecret, redirect_uri: google.redirect.href }),
    });
    if (!token.ok) return failure(401, "Google konnte diese Anmeldung nicht bestätigen.");
    const { access_token: bearer } = await token.json() as { access_token?: unknown };
    if (typeof bearer !== "string" || !/^[A-Za-z0-9._~+/%=-]{12,2048}$/.test(bearer)) return failure(401, "Google konnte diese Anmeldung nicht bestätigen.");
    const profile = await fetcher("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${bearer}` }, signal, redirect: "error", cache: "no-store",
    });
    if (!profile.ok) return failure(401, "Google konnte dein Profil nicht bestätigen.");
    const { sub, email, email_verified: verified } = await profile.json() as { sub?: unknown; email?: unknown; email_verified?: unknown };
    if (verified !== true || typeof sub !== "string" || typeof email !== "string") return failure(401, "Google hat keine bestätigte E-Mail geliefert.");
    const connected = await connectGoogleAccount({ subject: sub, email, linkId: flow.linkId,
      allowNew: flow.allowNew && validSiteSession(request.cookies.get(SITE_COOKIE)?.value, access) });
    return clear(await accountSignInResponse(request, connected, flow.next, google.redirect.origin));
  } catch (error) {
    return error instanceof AccountError ? failure(error.status, error.message) : failure(503, "Die Google-Anmeldung ist vorübergehend nicht erreichbar.");
  }
}
