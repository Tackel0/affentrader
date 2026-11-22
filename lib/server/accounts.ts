import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { validWorkspaceProfile } from "@/lib/accountScope";
import { JsonStore, dataDir } from "./storage";
import { SESSION_SECONDS } from "./siteAccess";

export const ACCOUNT_COOKIE = "affentrader-account-session";
export interface Account { id: string; email: string; googleLinked: boolean; passwordEnabled: boolean }
interface Entry {
  id: string;
  email: string;
  passwordHash?: string;
  googleSubject?: string;
  sessions: { hash: string; expires: number }[];
}
interface Directory { accounts: Entry[] }
const globalScope = globalThis as typeof globalThis & { affentraderAccountDirectories?: Map<string, JsonStore<Directory>> };
const directoryByPath = globalScope.affentraderAccountDirectories ??= new Map<string, JsonStore<Directory>>();
function directory(): JsonStore<Directory> {
  const path = dataDir();
  let store = directoryByPath.get(path);
  if (!store) {
    store = new JsonStore<Directory>("accounts-v1", () => ({ accounts: [] }), () => path);
    directoryByPath.set(path, store);
  }
  return store;
}

export class AccountError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function normalizeAccountEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  return value.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value) ? value : null;
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const account = (entry: Entry): Account => ({ id: entry.id, email: entry.email, googleLinked: Boolean(entry.googleSubject), passwordEnabled: Boolean(entry.passwordHash) });
const sessionPattern = /^[a-f0-9]{32}\.[a-f0-9]{64}$/;
const dummySalt = "0".repeat(32);

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, hash) => error ? reject(error) : resolve(hash));
  });
}

const acceptablePassword = (password: string) => password.length >= 10 && Buffer.byteLength(password) <= 512;

async function newPasswordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await derive(password, salt)).toString("hex")}`;
}

function addAccount(state: Directory, email: string): Entry {
  if (state.accounts.some(entry => entry.email === email)) throw new AccountError(409, "Für diese E-Mail gibt es bereits ein Konto.");
  if (state.accounts.length >= 100) throw new AccountError(507, "Auf diesem Workspace können derzeit keine weiteren Konten angelegt werden.");
  const entry: Entry = { id: randomBytes(16).toString("hex"), email, sessions: [] };
  state.accounts.push(entry);
  return entry;
}

export async function createPasswordAccount(email: string, password: string): Promise<Account> {
  if (!normalizeAccountEmail(email) || !acceptablePassword(password)) {
    throw new AccountError(400, "Gib eine gültige E-Mail und ein Passwort mit mindestens 10 Zeichen ein.");
  }
  const passwordHash = await newPasswordHash(password);
  let created!: Account;
  await directory().update(state => {
    const entry = addAccount(state, normalizeAccountEmail(email)!);
    entry.passwordHash = passwordHash;
    created = account(entry);
  });
  return created;
}

export async function loginPasswordAccount(email: string, password: string) {
  if (!password || Buffer.byteLength(password) > 512) return null;
  const entry = (await directory().read()).accounts.find(row => row.email === normalizeAccountEmail(email));
  const [salt, expected] = (entry?.passwordHash ?? `${dummySalt}:${"0".repeat(128)}`).split(":");
  const actual = await derive(password, salt);
  if (!timingSafeEqual(actual, Buffer.from(expected, "hex")) || !entry?.passwordHash) return null;
  const token = await issueAccountSession(entry.id, Date.now(), entry.passwordHash);
  return { user: account(entry), token };
}

export async function connectGoogleAccount(input: { subject: string; email: string; linkId?: string; linkSession?: string; allowNew: boolean }): Promise<Account> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.subject) || !normalizeAccountEmail(input.email)) throw new AccountError(400, "Google hat keine bestätigte E-Mail geliefert.");
  const email = normalizeAccountEmail(input.email)!;
  let connected!: Account;
  await directory().update(state => {
    const linked = state.accounts.find(entry => entry.googleSubject === input.subject);
    if (input.linkId) {
      const entry = entryForSession(state, input.linkSession, Date.now());
      if (!entry || entry.id !== input.linkId || entry.email !== email || (linked && linked.id !== entry.id) || (entry.googleSubject && entry.googleSubject !== input.subject)) {
        throw new AccountError(409, "Dieses Google-Konto kann hier nicht verknüpft werden. Prüfe die E-Mail deines AffenTerminal-Kontos.");
      }
      entry.googleSubject = input.subject;
      connected = account(entry);
    } else if (linked) {
      connected = account(linked);
    } else {
      if (state.accounts.some(row => row.email === email)) throw new AccountError(409, "Melde dich zuerst mit deinem Konto an und verknüpfe Google unter Konto.");
      if (!input.allowNew) throw new AccountError(403, "Öffne für den ersten Google-Zugang den Workspace mit dem Website-Passwort.");
      const entry = addAccount(state, email);
      entry.googleSubject = input.subject;
      connected = account(entry);
    }
  });
  return connected;
}

function mintSession(id: string, now: number) {
  const token = `${id}.${randomBytes(32).toString("hex")}`;
  return { token, record: { hash: digest(token), expires: now + SESSION_SECONDS * 1000 } };
}

export async function createAccountSession(id: string, now = Date.now()): Promise<string> {
  return issueAccountSession(id, now);
}

async function issueAccountSession(id: string, now: number, verifiedPasswordHash?: string): Promise<string> {
  if (!validWorkspaceProfile(id)) throw new AccountError(401, "Konto nicht verfügbar.");
  const { token, record } = mintSession(id, now);
  await directory().update(state => {
    const entry = state.accounts.find(row => row.id === id);
    if (!entry || (verifiedPasswordHash && entry.passwordHash !== verifiedPasswordHash)) throw new AccountError(401, "E-Mail oder Passwort ist ungültig.");
    entry.sessions = [record, ...entry.sessions.filter(session => session.expires > now)].slice(0, 12);
  });
  return token;
}

function entryForSession(state: Directory, token: string | undefined, now: number): Entry | null {
  if (!token || !sessionPattern.test(token)) return null;
  const entry = state.accounts.find(row => row.id === token.slice(0, 32));
  const hash = digest(token);
  return entry?.sessions.some(session => session.hash === hash && session.expires > now) ? entry : null;
}

export async function readAccountSession(token?: string, now = Date.now()): Promise<Account | null> {
  if (!token || !sessionPattern.test(token)) return null;
  const entry = entryForSession(await directory().read(), token, now);
  return entry ? account(entry) : null;
}

export async function revokeAccountSession(token?: string): Promise<void> {
  if (!token || !sessionPattern.test(token)) return;
  const hash = digest(token);
  await directory().update(state => {
    const entry = state.accounts.find(row => row.id === token.slice(0, 32));
    if (entry) entry.sessions = entry.sessions.filter(session => session.hash !== hash);
  });
}

export async function revokeOtherAccountSessions(token: string) {
  const hash = digest(token);
  await directory().update(state => {
    const entry = entryForSession(state, token, Date.now());
    if (!entry) throw new AccountError(401, "Melde dich für diese Änderung neu an.");
    entry.sessions = entry.sessions.filter(session => session.hash === hash);
  });
}

export async function changeAccountPassword(token: string, current: string, next: string) {
  if (!acceptablePassword(next)) throw new AccountError(400, "Das neue Passwort muss mindestens 10 Zeichen lang sein.");
  if (!current || Buffer.byteLength(current) > 512) throw new AccountError(400, "Gib dein aktuelles Passwort ein.");
  const saved = entryForSession(await directory().read(), token, Date.now());
  if (!saved?.passwordHash) throw new AccountError(403, "Für dieses Konto ist derzeit kein Passwort hinterlegt.");
  const [salt, expected] = saved.passwordHash.split(":");
  if (!timingSafeEqual(await derive(current, salt), Buffer.from(expected, "hex"))) throw new AccountError(401, "Das aktuelle Passwort ist ungültig.");
  if (current === next) throw new AccountError(400, "Wähle ein neues Passwort.");

  const passwordHash = await newPasswordHash(next);
  const fresh = mintSession(saved.id, Date.now());
  await directory().update(state => {
    const entry = entryForSession(state, token, Date.now());
    if (!entry || entry.passwordHash !== saved.passwordHash) throw new AccountError(409, "Deine Sitzung hat sich geändert. Lade die Kontoseite neu.");
    entry.passwordHash = passwordHash;
    entry.sessions = [fresh.record];
  });
  return { user: account(saved), token: fresh.token };
}
