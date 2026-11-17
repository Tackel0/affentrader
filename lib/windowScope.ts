/**
 * Pop-out windows are the same app opened with `?window=<id>`. Each one keeps
 * its own chart state (symbol, interval, layout, indicators) in storage keys
 * suffixed with its id, seeded from the main window when it opens. Everything
 * else (watchlists, alerts, paper account, portfolio…) stays shared.
 */
const WINDOWS_KEY = "affentrader-windows-v1";
const STALE_MS = 24 * 60 * 60 * 1000;

let cached: { key: string; id: string | null } | undefined;

/** Id of this isolated window scope (/terminal or ?window=...), or null in the main window. */
export function popoutId(): string | null {
  if (typeof window === "undefined") return null;
  const search = window.location.search ?? "";
  const pathname = window.location.pathname ?? "";
  const key = `${pathname}|${search}`;
  if (cached?.key === key) return cached.id;

  const raw = new URLSearchParams(search).get("window");
  let id = raw && /^[a-z0-9]{4,24}$/.test(raw) ? raw : null;
  if (!id && (pathname === "/terminal" || pathname.startsWith("/terminal/"))) {
    id = "affen-terminal";
  }
  cached = { key, id };
  return id;
}

export const isPopout = () => popoutId() !== null;

/** The storage key a per-window store should use; a new pop-out starts from the main window's copy. */
export function scopedName(base: string): string {
  const id = popoutId();
  if (!id) return base;
  const name = `${base}@${id}`;
  try {
    if (localStorage.getItem(name) === null) {
      const seed = localStorage.getItem(base);
      if (seed !== null) localStorage.setItem(name, seed);
    }
  } catch {
    /* storage unavailable: the pop-out starts from defaults */
  }
  return name;
}

export function newWindowId(): string {
  return [...crypto.getRandomValues(new Uint8Array(5))].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
}

type Registry = Record<string, number>;

function readRegistry(): Registry {
  try {
    const parsed = JSON.parse(localStorage.getItem(WINDOWS_KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Registry) : {};
  } catch {
    return {};
  }
}

/** Mark this pop-out as alive so its storage is not pruned. */
export function touchWindow() {
  const id = popoutId();
  if (!id) return;
  try {
    localStorage.setItem(WINDOWS_KEY, JSON.stringify({ ...readRegistry(), [id]: Date.now() }));
  } catch {
    /* best effort */
  }
}

/** Delete storage left behind by pop-outs that were closed more than a day ago. */
export function pruneWindows(now = Date.now()): string[] {
  const registry = readRegistry();
  const stale = Object.keys(registry).filter((id) => now - Number(registry[id]) > STALE_MS);
  if (!stale.length) return [];
  try {
    for (const id of stale) {
      delete registry[id];
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.endsWith(`@${id}`)) localStorage.removeItem(key);
      }
    }
    localStorage.setItem(WINDOWS_KEY, JSON.stringify(registry));
  } catch {
    /* best effort */
  }
  return stale;
}

export function popoutUrl(id: string, group: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("window", id);
  if (group !== "off") url.searchParams.set("link", group);
  return url.toString();
}

/** Open a new pop-out window; returns false when the browser blocked it. */
export function openPopout(group: string): boolean {
  const id = newWindowId();
  // Stores persist on every change, so the new window seeds from what is on screen now.
  const opened = window.open(popoutUrl(id, group), `affentrader-${id}`, "popup=yes,width=1280,height=820");
  return Boolean(opened);
}

/** Build URL for the standalone AffenTerminal external GUI window. */
export function affenTerminalUrl(view = "opps", ticker?: string, group = "red"): string {
  const url = new URL(window.location.href);
  url.pathname = "/terminal";
  url.search = "";
  url.hash = "";
  url.searchParams.set("window", newWindowId());
  if (group !== "off") url.searchParams.set("link", group);
  if (view) url.searchParams.set("view", view);
  if (ticker) url.searchParams.set("ticker", ticker.replace(/^YF:/i, "").trim().toUpperCase());
  return url.toString();
}

/** Open the standalone AffenTerminal GUI in a dedicated external browser window. */
export function openAffenTerminalWindow(view = "opps", ticker?: string, group = "red"): boolean {
  const opened = window.open(
    affenTerminalUrl(view, ticker, group),
    `affenterminal-${view || "main"}`,
    "popup=yes,width=1440,height=900,resizable=yes,scrollbars=yes",
  );
  return Boolean(opened);
}
