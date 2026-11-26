import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const SITE_COOKIE = "affentrader-site-session";
export const SESSION_DAYS = 30;
export const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;
export interface SiteAccessConfig { passwordHash: string; secret: string }

export function sitePasswordRequired(): boolean {
  return process.env.AFFENTRADER_REQUIRE_SITE_PASSWORD === "1";
}

let fallbackSessionSecret: string | null = null;

export function siteSessionSecret(): string {
  const configured = process.env.AFFENTRADER_SITE_SESSION_SECRET ?? "";
  if (/^[a-f0-9]{64,}$/.test(configured)) return configured;
  fallbackSessionSecret ??= randomBytes(32).toString("hex");
  return fallbackSessionSecret;
}

export function siteAccessConfig(): SiteAccessConfig | null {
  const passwordHash = process.env.AFFENTRADER_SITE_PASSWORD_HASH ?? "";
  const secret = process.env.AFFENTRADER_SITE_SESSION_SECRET ?? "";
  return /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash) && /^[a-f0-9]{64,}$/.test(secret)
    ? { passwordHash, secret } : null;
}

export async function matchesSitePassword(password: string, config: SiteAccessConfig): Promise<boolean> {
  if (!password || Buffer.byteLength(password) > 512) return false;
  const [salt, expected] = config.passwordHash.split(":");
  const actual = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key));
  });
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}

function signature(payload: string, config: SiteAccessConfig): string {
  // Changing the password also invalidates every existing session.
  return createHmac("sha256", config.secret).update(`${config.passwordHash}:${payload}`).digest("hex");
}

export function createSiteSession(config: SiteAccessConfig, now = Date.now()): string {
  const payload = `${Math.floor(now / 1000) + SESSION_SECONDS}.${randomBytes(16).toString("hex")}`;
  return `${payload}.${signature(payload, config)}`;
}

export function validSiteSession(token: string | undefined, config: SiteAccessConfig, now = Date.now()): boolean {
  if (!token || !/^\d{10,12}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token)) return false;
  const [expires, nonce, supplied] = token.split(".");
  const remaining = Number(expires) - Math.floor(now / 1000);
  if (remaining <= 0 || remaining > SESSION_SECONDS) return false;
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(signature(`${expires}.${nonce}`, config), "hex"));
}

export function safeReturnPath(value: string | null): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional null-byte rejection
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n\u0000]/.test(value)) return "/";
  try {
    const parsed = new URL(value, "http://local.invalid");
    return parsed.origin === "http://local.invalid" && !["/login", "/logout"].includes(parsed.pathname)
      ? parsed.pathname + parsed.search : "/";
  } catch { return "/"; }
}

// A bounded process-wide budget deliberately does not trust spoofable IP headers.
// Public multi-instance hosting should additionally rate-limit at its reverse proxy.
let attempts = { window: 0, count: 0 };
export function takeLoginAttempt(now = Date.now()): boolean {
  const window = Math.floor(now / 60_000);
  if (attempts.window !== window) attempts = { window, count: 0 };
  return ++attempts.count <= 30;
}

