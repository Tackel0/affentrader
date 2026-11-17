import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { JsonStore } from "./storage";

export const MAX_SCRIPT_BYTES = 200_000;
export const MAX_SCRIPTS = 500;
export const MAX_VERSIONS = 25;

export type ScriptKind = "indicator" | "strategy" | "library";
export type Visibility = "public" | "invite";

export interface ScriptVersion {
  version: number;
  source: string;
  notes: string;
  publishedAt: number;
}

export interface ScriptRecord {
  id: string;
  title: string;
  description: string;
  author: string;
  kind: ScriptKind;
  tags: string[];
  visibility: Visibility;
  /** SHA-256 of the invite secret; the secret itself is shown once to the publisher. */
  inviteHash: string;
  versions: ScriptVersion[];
  /** SHA-256 of each anonymous liker's token. */
  likes: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ScriptSummary {
  id: string;
  title: string;
  description: string;
  author: string;
  kind: ScriptKind;
  tags: string[];
  visibility: Visibility;
  version: number;
  likes: number;
  updatedAt: number;
}

export interface ScriptDetail extends ScriptSummary {
  source: string;
  notes: string;
  versions: { version: number; notes: string; publishedAt: number }[];
  liked: boolean;
}

export class LibraryError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface LibraryFile {
  scripts: Record<string, ScriptRecord>;
}

export const library = new JsonStore<LibraryFile>("library", () => ({ scripts: {} }));

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Invite codes look like `<script id>.<secret>`: knowing one grants read access to one script. */
export function splitInvite(code: string): { id: string; secret: string } | null {
  const match = /^([a-f0-9-]{36})\.([a-f0-9]{24})$/.exec(code.trim().toLowerCase());
  return match ? { id: match[1], secret: match[2] } : null;
}

function canRead(record: ScriptRecord, invite?: string): boolean {
  if (record.visibility === "public") return true;
  const parts = invite ? splitInvite(invite) : null;
  return Boolean(parts && parts.id === record.id && safeEqual(hash(parts.secret), record.inviteHash));
}

const KINDS: ScriptKind[] = ["indicator", "strategy", "library"];

function clean(text: unknown, max: number): string {
  return typeof text === "string" ? text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "";
}

export interface ScriptInput {
  title?: unknown;
  description?: unknown;
  author?: unknown;
  kind?: unknown;
  tags?: unknown;
  visibility?: unknown;
  source?: unknown;
  notes?: unknown;
}

function checkSource(source: unknown): string {
  if (typeof source !== "string" || !source.trim()) throw new LibraryError(400, "The script source is empty.");
  if (Buffer.byteLength(source) > MAX_SCRIPT_BYTES) throw new LibraryError(413, "Scripts are limited to 200 KB.");
  if (!/\b(indicator|strategy|library)\s*\(/.test(source))
    throw new LibraryError(400, "Pine source needs an indicator(), strategy() or library() declaration.");
  return source;
}

function tagsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((t) => clean(t, 24).toLowerCase()).filter((t) => /^[a-z0-9][a-z0-9 +-]*$/.test(t)))].slice(0, 6);
}

function summary(record: ScriptRecord): ScriptSummary {
  const latest = record.versions.at(-1)!;
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    author: record.author,
    kind: record.kind,
    tags: record.tags,
    visibility: record.visibility,
    version: latest.version,
    likes: record.likes.length,
    updatedAt: record.updatedAt,
  };
}

function detail(record: ScriptRecord, likerToken?: string): ScriptDetail {
  const latest = record.versions.at(-1)!;
  return {
    ...summary(record),
    source: latest.source,
    notes: latest.notes,
    versions: record.versions.map(({ version, notes, publishedAt }) => ({ version, notes, publishedAt })),
    liked: likerToken ? record.likes.includes(hash(likerToken)) : false,
  };
}

/** Publish a new script. The invite code (for invite-only scripts) is returned exactly once. */
export async function publishScript(input: ScriptInput): Promise<{ script: ScriptDetail; invite?: string }> {
  const source = checkSource(input.source);
  const title = clean(input.title, 80);
  if (title.length < 3) throw new LibraryError(400, "Give the script a title of at least 3 characters.");
  const kind = KINDS.includes(input.kind as ScriptKind) ? (input.kind as ScriptKind) : "indicator";
  const visibility: Visibility = input.visibility === "invite" ? "invite" : "public";
  const id = randomUUID();
  const secret = randomBytes(12).toString("hex");
  const now = Date.now();
  const record: ScriptRecord = {
    id,
    title,
    description: clean(input.description, 2000),
    author: clean(input.author, 60) || "Anonymous",
    kind,
    tags: tagsOf(input.tags),
    visibility,
    inviteHash: visibility === "invite" ? hash(secret) : "",
    versions: [{ version: 1, source, notes: clean(input.notes, 500) || "Initial release", publishedAt: now }],
    likes: [],
    createdAt: now,
    updatedAt: now,
  };
  await library.update((file) => {
    if (Object.keys(file.scripts).length >= MAX_SCRIPTS)
      throw new LibraryError(507, "The script library is full. Delete a script first.");
    file.scripts[id] = record;
  });
  return { script: detail(record), invite: visibility === "invite" ? `${id}.${secret}` : undefined };
}

/** Add a version and/or change metadata. Switching to invite-only mints a fresh code. */
export async function updateScript(
  id: string,
  input: ScriptInput,
): Promise<{ script: ScriptDetail; invite?: string }> {
  let invite: string | undefined;
  let result!: ScriptRecord;
  await library.update((file) => {
    const record = file.scripts[id];
    if (!record) throw new LibraryError(404, "Script not found.");
    if (input.title !== undefined) {
      const title = clean(input.title, 80);
      if (title.length < 3) throw new LibraryError(400, "Give the script a title of at least 3 characters.");
      record.title = title;
    }
    if (input.description !== undefined) record.description = clean(input.description, 2000);
    if (input.tags !== undefined) record.tags = tagsOf(input.tags);
    if (input.visibility === "public") {
      record.visibility = "public";
      record.inviteHash = "";
    } else if (input.visibility === "invite") {
      // A new code every time makes "regenerate invite" a one-field change and revokes old links.
      const secret = randomBytes(12).toString("hex");
      record.visibility = "invite";
      record.inviteHash = hash(secret);
      invite = `${id}.${secret}`;
    }
    if (input.source !== undefined) {
      const source = checkSource(input.source);
      const latest = record.versions.at(-1)!;
      if (source !== latest.source) {
        record.versions.push({
          version: latest.version + 1,
          source,
          notes: clean(input.notes, 500) || `Version ${latest.version + 1}`,
          publishedAt: Date.now(),
        });
        if (record.versions.length > MAX_VERSIONS) record.versions.splice(0, record.versions.length - MAX_VERSIONS);
      }
    }
    record.updatedAt = Date.now();
    result = structuredClone(record);
  });
  return { script: detail(result), invite };
}

export async function deleteScript(id: string): Promise<boolean> {
  let removed = false;
  await library.update((file) => {
    removed = id in file.scripts;
    delete file.scripts[id];
  });
  return removed;
}

export interface ListOptions {
  query?: string;
  kind?: string;
  sort?: string;
  limit?: number;
}

/** Public scripts only: invite-only scripts never appear in listings. */
export async function listScripts(options: ListOptions = {}): Promise<ScriptSummary[]> {
  const file = await library.read();
  const query = (options.query ?? "").trim().toLowerCase();
  let rows = Object.values(file.scripts).filter((r) => r.visibility === "public");
  if (options.kind && KINDS.includes(options.kind as ScriptKind)) rows = rows.filter((r) => r.kind === options.kind);
  if (query)
    rows = rows.filter((r) =>
      [r.title, r.description, r.author, ...r.tags].some((text) => text.toLowerCase().includes(query)),
    );
  rows.sort((a, b) => (options.sort === "popular" ? b.likes.length - a.likes.length || b.updatedAt - a.updatedAt : b.updatedAt - a.updatedAt));
  return rows.slice(0, Math.min(100, Math.max(1, options.limit ?? 50))).map(summary);
}

/** Every script (public and invite-only); used by the publisher with the server key. */
export async function mine(): Promise<ScriptSummary[]> {
  const file = await library.read();
  return Object.values(file.scripts).sort((a, b) => b.updatedAt - a.updatedAt).map(summary);
}

export async function getScript(
  id: string,
  access: { invite?: string; token?: string; owner?: boolean } = {},
): Promise<ScriptDetail> {
  const record = (await library.read()).scripts[id];
  // Same message for missing and forbidden so invite-only ids cannot be probed.
  if (!record || !(access.owner || canRead(record, access.invite))) throw new LibraryError(404, "Script not found.");
  return detail(record, access.token);
}

/** Resolve a pasted invite code to its script. */
export async function openInvite(code: string, token?: string): Promise<ScriptDetail> {
  const parts = splitInvite(code);
  if (!parts) throw new LibraryError(400, "That is not a valid invite code.");
  return getScript(parts.id, { invite: code, token });
}

export function validToken(token: unknown): token is string {
  return typeof token === "string" && /^[a-f0-9]{32,64}$/.test(token);
}

/** Anonymous like/unlike. One token counts once. */
export async function setLike(
  id: string,
  token: string,
  liked: boolean,
  invite?: string,
): Promise<{ likes: number; liked: boolean }> {
  let likes = 0;
  await library.update((file) => {
    const record = file.scripts[id];
    if (!record || !canRead(record, invite)) throw new LibraryError(404, "Script not found.");
    const key = hash(token);
    const has = record.likes.includes(key);
    if (liked && !has) record.likes.push(key);
    if (!liked && has) record.likes = record.likes.filter((l) => l !== key);
    likes = record.likes.length;
  });
  return { likes, liked };
}
