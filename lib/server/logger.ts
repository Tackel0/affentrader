export type LogLevel = "info" | "warn" | "error";

const MAX_STRING_CHARS = 500;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 50;
const MAX_DEPTH = 4;

const SENSITIVE_KEY_PATTERN =
  /pass(?:word|hash|phrase)?|secret|token|cookie|auth(?:orization)?|x-affentrader-|credential|signature|p256dh|apca-api|api[-_]?key|private[-_]?key/i;

export function redactString(text: string): string {
  const redacted = text
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/\s:@]+)(?::([^/\s@]*))?@/g, (_m, scheme: string, _user: string, pass?: string) =>
      pass !== undefined ? `${scheme}[REDACTED]:[REDACTED]@` : `${scheme}[REDACTED]@`,
    )
    .replace(
      /([?&][a-z0-9_.-]*(?:api[_-]?key|apikey|token|secret|password|passwd|auth|signature|sig|key|credential|p256dh)=)([^&#\s]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/\b(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, "$1[REDACTED]");
  return redacted.length > MAX_STRING_CHARS
    ? `${redacted.slice(0, MAX_STRING_CHARS - 3)}...`
    : redacted;
}

export function redactForLog(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "string") return redactString(value);
  if (typeof value === "function" || typeof value === "symbol") return undefined;

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : "[Invalid Date]";
  }
  if (value instanceof URL) {
    return redactString(value.toString());
  }
  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      name: value.name || "Error",
      message: redactString(value.message || ""),
    };
    const code = (value as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") out.code = code;
    const status = (value as { status?: unknown }).status;
    if (typeof status === "number") out.status = status;
    return out;
  }

  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? "[Array]" : "[Object]";

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const slice = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactForLog(item, depth + 1, seen));
      if (value.length > MAX_ARRAY_ITEMS) {
        slice.push(`...(+${value.length - MAX_ARRAY_ITEMS} more)`);
      }
      return slice;
    }

    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS);
    for (const [key, item] of entries) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = "[REDACTED]";
      } else {
        const sanitized = redactForLog(item, depth + 1, seen);
        if (sanitized !== undefined) out[key] = sanitized;
      }
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

export function logEvent(level: LogLevel, event: string, meta?: Record<string, unknown>): void {
  const base = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(meta ? (redactForLog(meta) as Record<string, unknown>) : {}),
  };
  let line: string;
  try {
    line = JSON.stringify(base);
  } catch {
    line = JSON.stringify({ ts: new Date().toISOString(), level, event });
  }
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export function logInfo(event: string, meta?: Record<string, unknown>): void {
  logEvent("info", event, meta);
}

export function logWarn(event: string, meta?: Record<string, unknown>): void {
  logEvent("warn", event, meta);
}

export function logError(event: string, error?: unknown, meta?: Record<string, unknown>): void {
  logEvent("error", event, {
    ...(meta ?? {}),
    ...(error !== undefined ? { error } : {}),
  });
}
