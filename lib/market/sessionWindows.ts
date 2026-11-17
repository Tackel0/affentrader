export type MarketWindow = readonly [number, number];
export interface MarketSessionWindows { regular: MarketWindow[]; extended: MarketWindow[] }
export interface MarketSessionCalendar extends MarketSessionWindows { mode: "regular" | "extended"; revision: number | string }
interface Snapshot extends MarketSessionCalendar { revision: number }
const calendars = new Map<string, Snapshot>();
let revision = 0;
const valid = (window: MarketWindow) => window.length === 2 && window.every(Number.isSafeInteger) && window[0] < window[1];
export function registerMarketSessions(symbol: string, value: MarketSessionWindows, mode: Snapshot["mode"]) {
  const prior = calendars.get(symbol);
  const source = value.regular.filter(valid);
  if (!source.length) return;
  const first = Math.floor(Math.min(...source.map(w => w[0])) / 86400000) * 86400000;
  const through = (Math.floor(Math.max(...source.map(w => w[0])) / 86400000) + 1) * 86400000;
  // Replace the source-covered dates, including removed holiday windows and
  // moved openings. Retain only older pages outside this response's coverage.
  const merge = (key: keyof MarketSessionWindows) => [...new Map([...(prior?.[key] ?? []).filter(w => w[0] < first || w[0] >= through), ...value[key].filter(valid)].map(w => [w[0], [...w] as MarketWindow])).values()]
    .sort((a, b) => a[0] - b[0]).slice(-5000);
  const next = { regular: merge("regular"), extended: merge("extended"), mode };
  if (JSON.stringify(next) === JSON.stringify(prior && { regular: prior.regular, extended: prior.extended, mode: prior.mode })) return;
  calendars.set(symbol, { ...next, revision: ++revision });
  if (calendars.size > 128) calendars.delete(calendars.keys().next().value!);
}
export const marketSessions = (symbol?: string) => symbol ? calendars.get(symbol) : undefined;
export function clearMarketSessions() { calendars.clear(); revision++; }

/** Keep source-resolved windows, never infer a holiday, UTC offset or early close. */
export function parseYahooSessionWindows(value: unknown): MarketSessionWindows | undefined {
  if (!value || typeof value !== "object") return;
  const raw = value as Record<string, unknown>;
  const read = (v: unknown): MarketWindow[] => {
    if (!Array.isArray(v)) return [];
    return v.flatMap(day => Array.isArray(day) ? day : [day]).flatMap(row => {
      if (!row || typeof row !== "object") return [];
      const { start, end } = row as Record<string, unknown>;
      return typeof start === "number" && typeof end === "number" && valid([start * 1000, end * 1000]) ? [[start * 1000, end * 1000] as MarketWindow] : [];
    }).sort((a, b) => a[0] - b[0]);
  };
  const regular = read(Array.isArray(value) ? value : raw.regular), pre = read(raw.pre), post = read(raw.post);
  if (!regular.length) return;
  const extended = regular.flatMap(window => {
    const before = pre.find(p => p[1] === window[0]), after = post.find(p => p[0] === window[1]);
    return before && after ? [[before[0], after[1]] as MarketWindow] : [];
  });
  return { regular, extended };
}
