import { createHash, scryptSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_SCOPE_COOKIE, ACCOUNT_SCOPE_HEADER } from "@/lib/accountScope";
import { ACCOUNT_COOKIE, readAccountSession } from "@/lib/server/accounts";
import { beginGoogleAccount, finishGoogleAccount } from "@/lib/server/googleAccount";
import { POST as register } from "@/app/api/account/register/route";
import { POST as signIn } from "@/app/api/account/login/route";
import { POST as updatePassword } from "@/app/api/account/password/route";
import { POST as endSessions } from "@/app/api/account/sessions/route";
import { GET as readSync, PUT as writeSync } from "@/app/api/sync/route";
import { proxy } from "@/proxy";

const origin = "https://terminal.example";
const invite = "fixture-website-password";
const password = "private-fixture-password";
const googleCookie = "affentrader-google-handshake";
const post = (url: string, data: Record<string, string>, from = origin, cookie = "") => new NextRequest(`${origin}${url}`, {
  method: "POST", headers: { origin: from, cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(data),
});

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "affentrader-accounts-"));
  const salt = "c".repeat(32);
  vi.stubEnv("AFFENTRADER_DATA", folder);
  vi.stubEnv("AFFENTRADER_SITE_PASSWORD_HASH", `${salt}:${scryptSync(invite, salt, 64).toString("hex")}`);
  vi.stubEnv("AFFENTRADER_SITE_SESSION_SECRET", "a".repeat(64));
  vi.stubEnv("AFFENTRADER_GOOGLE_CLIENT_ID", "fixture-client");
  vi.stubEnv("AFFENTRADER_GOOGLE_CLIENT_SECRET", "fixture-provider-value");
  vi.stubEnv("AFFENTRADER_GOOGLE_REDIRECT_URI", `${origin}/api/account/google/callback`);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(folder, { recursive: true, force: true });
});

async function create(email: string) {
  const response = await register(post("/api/account/register", { email, invite, password }));
  expect(response.status).toBe(303);
  const token = response.cookies.get(ACCOUNT_COOKIE)!.value;
  const profile = response.cookies.get(ACCOUNT_SCOPE_COOKIE)!.value;
  return { profile, token, cookie: `${ACCOUNT_COOKIE}=${token}; ${ACCOUNT_SCOPE_COOKIE}=${profile}` };
}

describe("personal workspaces", () => {
  it("protects invitation signup, logs in with a normalized address and revokes the session on logout", async () => {
    expect((await register(post("/api/account/register", { email: "test@example.com", password, invite }, "https://other.example"))).status).toBe(403);
    expect((await register(post("/api/account/register", { email: "test@example.com", password, invite: "wrong" }))).status).toBe(403);
    const first = await create("Test@example.com");
    expect((await register(post("/api/account/register", { email: "test@example.com", password, invite }))).status).toBe(409);
    expect((await signIn(post("/api/account/login", { email: "test@example.com", password: "incorrect" }))).status).toBe(401);
    const login = await signIn(post("/api/account/login", { email: "TEST@example.com", password, next: "//elsewhere.example" }));
    expect(login.status).toBe(303);
    expect(login.headers.get("location")).toBe(`${origin}/`);
    expect(login.cookies.get(ACCOUNT_COOKIE)?.httpOnly).toBe(true);
    expect(login.cookies.get(ACCOUNT_SCOPE_COOKIE)?.value).toBe(first.profile);
    const storage = await readFile(path.join(folder, "accounts-v1.json"), "utf8");
    expect(storage.includes(password)).toBe(false);
    expect(storage.includes(first.token)).toBe(false);
    expect((await proxy(new NextRequest(origin, { headers: { cookie: first.cookie } }))).headers.get("x-middleware-next")).toBe("1");
    const logout = await proxy(post("/logout", {}, origin, first.cookie));
    expect(logout.status).toBe(303);
    expect(await readAccountSession(first.token)).toBeNull();
  });

  it("isolates account snapshots, rejects stale tabs and keeps key sync independent", async () => {
    const alice = await create("alice@example.com"), bob = await create("bob@example.com");
    const request = (cookie: string, header: string, value: string, body?: unknown) => new NextRequest(`${origin}/api/sync`, {
      method: body ? "PUT" : "GET", headers: { cookie, [header]: value, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    const data = JSON.stringify({ version: 1, chart: { state: { symbol: "YF:NVDA" } }, watchlists: {}, alerts: {} });
    const upload = { data, baseRevision: 0, device: "Fixture device" };
    expect((await writeSync(request(alice.cookie, ACCOUNT_SCOPE_HEADER, alice.profile, upload))).status).toBe(200);
    expect((await writeSync(request(alice.cookie, ACCOUNT_SCOPE_HEADER, alice.profile, upload))).status).toBe(409);
    expect((await readSync(request(bob.cookie, ACCOUNT_SCOPE_HEADER, alice.profile))).status).toBe(401);
    expect((await readSync(request("", ACCOUNT_SCOPE_HEADER, alice.profile))).status).toBe(401);
    expect((await (await readSync(request(bob.cookie, ACCOUNT_SCOPE_HEADER, bob.profile))).json()).revision).toBe(0);
    expect((await (await readSync(request(alice.cookie, ACCOUNT_SCOPE_HEADER, alice.profile))).json()).data).toBe(data);
    const key = "d".repeat(48);
    expect((await writeSync(request(alice.cookie, "x-affentrader-sync", key, upload))).status).toBe(200);
    expect((await (await readSync(request(bob.cookie, "x-affentrader-sync", key))).json()).data).toBe(data);
  });

  it("uses bound OAuth state and PKCE and supports explicitly linked Google sign-in", async () => {
    const user = await create("investor@example.com");
    const begin = await beginGoogleAccount(post("/api/account/google/start", {}, origin, user.cookie));
    expect(begin.status).toBe(303);
    const auth = new URL(begin.headers.get("location")!);
    expect(auth.origin).toBe("https://accounts.google.com");
    const handshake = `${googleCookie}=${begin.cookies.get(googleCookie)!.value}`;
    const callback = (state: string, cookie: string) => new NextRequest(`${origin}/api/account/google/callback?${new URLSearchParams({ state, code: "fixture-code" })}`, { headers: { cookie } });
    const fetcher = vi.fn(async (target: string | URL | Request, options?: RequestInit) => {
      if (String(target) === "https://oauth2.googleapis.com/token") {
        const verifier = (options?.body as URLSearchParams).get("code_verifier")!;
        expect(createHash("sha256").update(verifier).digest("base64url")).toBe(auth.searchParams.get("code_challenge"));
        return Response.json({ access_token: "fixture-oauth-session" });
      }
      expect(String(target)).toBe("https://openidconnect.googleapis.com/v1/userinfo");
      return Response.json({ sub: "google-fixture-subject", email: "investor@example.com", email_verified: true });
    });
    expect((await finishGoogleAccount(callback("bad-state", `${user.cookie}; ${handshake}`), fetcher)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    const linked = await finishGoogleAccount(callback(auth.searchParams.get("state")!, `${user.cookie}; ${handshake}`), fetcher);
    expect(linked.status).toBe(303);
    expect((await readAccountSession(linked.cookies.get(ACCOUNT_COOKIE)!.value))?.googleLinked).toBe(true);
    const startLogin = await beginGoogleAccount(new NextRequest(`${origin}/api/account/google/start`));
    const loginAuth = new URL(startLogin.headers.get("location")!);
    auth.searchParams.set("code_challenge", loginAuth.searchParams.get("code_challenge")!);
    const googleLogin = await finishGoogleAccount(callback(loginAuth.searchParams.get("state")!, `${googleCookie}=${startLogin.cookies.get(googleCookie)!.value}`), fetcher);
    expect(googleLogin.status).toBe(303);
    expect(googleLogin.cookies.get(ACCOUNT_SCOPE_COOKIE)?.value).toBe(user.profile);
  });

  it("ends other devices and rotates the verified password without keeping old sessions", async () => {
    const email = "devices@example.com", replacement = "different-fixture-password";
    const current = await create(email);
    const newDevice = async () => (await signIn(post("/api/account/login", { email, password }))).cookies.get(ACCOUNT_COOKIE)!.value;
    const second = await newDevice();
    expect(await readAccountSession(second)).not.toBeNull();
    expect((await endSessions(post("/api/account/sessions", {}, "https://foreign.example", current.cookie))).status).toBe(403);
    expect(await readAccountSession(second)).not.toBeNull();
    expect((await endSessions(post("/api/account/sessions", {}, origin, current.cookie))).status).toBe(303);
    expect(await readAccountSession(second)).toBeNull();
    expect(await readAccountSession(current.token)).not.toBeNull();

    const last = await newDevice();
    expect((await updatePassword(post("/api/account/password", { current: "incorrect", new: replacement, confirm: replacement }, origin, current.cookie))).status).toBe(401);
    const changed = await updatePassword(post("/api/account/password", { current: password, new: replacement, confirm: replacement }, origin, current.cookie));
    expect(changed.status).toBe(303);
    expect(changed.cookies.get(ACCOUNT_SCOPE_COOKIE)?.value).toBe(current.profile);
    expect(await readAccountSession(changed.cookies.get(ACCOUNT_COOKIE)?.value)).not.toBeNull();
    expect(await readAccountSession(current.token)).toBeNull();
    expect(await readAccountSession(last)).toBeNull();
    expect((await signIn(post("/api/account/login", { email, password }))).status).toBe(401);
    expect((await signIn(post("/api/account/login", { email, password: replacement }))).status).toBe(303);
  });
});
