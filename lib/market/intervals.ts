/**
 * Chart interval model. An interval id is `<n><unit>` where the unit is
 * s (seconds), m (minutes), h (hours), D (days), W (weeks), M (months) or
 * T (ticks, i.e. a fixed number of trades per bar).
 */
export type IntervalUnit = "s" | "m" | "h" | "D" | "W" | "M" | "T";

export interface Interval {
  /** Canonical id, e.g. `45s`, `15m`, `1h`, `3D`, `100T`. */
  id: string;
  unit: IntervalUnit;
  value: number;
  /** Nominal duration in ms; 0 for tick intervals. Months are 30 days. */
  ms: number;
}

const DAY = 86_400_000;
const UNIT_MS: Record<Exclude<IntervalUnit, "T">, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  D: DAY,
  W: 7 * DAY,
  M: 30 * DAY,
};
const LIMITS: Record<IntervalUnit, number> = {
  s: 59,
  m: 1439,
  h: 168,
  D: 365,
  W: 52,
  M: 12,
  T: 10_000,
};
/** 1970-01-01 is a Thursday; Binance weeks start on Monday (1970-01-05). */
const WEEK_OFFSET = 4 * DAY;

/** Binance spot kline intervals, finest first, with their api spelling. */
export const NATIVE_INTERVALS: { id: string; api: string; ms: number }[] = [
  { id: "1s", api: "1s", ms: 1000 },
  { id: "1m", api: "1m", ms: 60_000 },
  { id: "3m", api: "3m", ms: 180_000 },
  { id: "5m", api: "5m", ms: 300_000 },
  { id: "15m", api: "15m", ms: 900_000 },
  { id: "30m", api: "30m", ms: 1_800_000 },
  { id: "1h", api: "1h", ms: 3_600_000 },
  { id: "2h", api: "2h", ms: 7_200_000 },
  { id: "4h", api: "4h", ms: 14_400_000 },
  { id: "6h", api: "6h", ms: 21_600_000 },
  { id: "8h", api: "8h", ms: 28_800_000 },
  { id: "12h", api: "12h", ms: 43_200_000 },
  { id: "1D", api: "1d", ms: DAY },
  { id: "1W", api: "1w", ms: 7 * DAY },
  { id: "1M", api: "1M", ms: 30 * DAY },
];

export const PRESET_INTERVALS = [
  "1s",
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1D",
] as const;

/** Intervals offered in the quick picker; users can add any valid custom id. */
export const QUICK_INTERVALS = [
  "1s",
  "5s",
  "15s",
  "30s",
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "1D",
  "1W",
  "1M",
  "100T",
  "500T",
  "1000T",
];

export function parseInterval(raw: string): Interval | null {
  const text = raw.trim();
  if (!text) return null;
  const match = /^(\d{1,5})\s*([a-zA-Z]*)$/.exec(text);
  if (!match) {
    const named: Record<string, string> = { D: "1D", W: "1W", M: "1M" };
    return Object.hasOwn(named, text) ? parseInterval(named[text]) : null;
  }
  const value = Number(match[1]);
  const spelled = match[2];
  let unit: IntervalUnit;
  if (spelled === "") unit = "m";
  else if (spelled === "s" || /^sec(ond)?s?$/i.test(spelled)) unit = "s";
  else if (spelled === "m" || /^min(ute)?s?$/i.test(spelled)) unit = "m";
  else if (spelled === "h" || /^(hr|hour)s?$/i.test(spelled)) unit = "h";
  else if (spelled === "H") unit = "h";
  else if (spelled === "d" || spelled === "D" || /^days?$/i.test(spelled))
    unit = "D";
  else if (spelled === "w" || spelled === "W" || /^weeks?$/i.test(spelled))
    unit = "W";
  else if (spelled === "M" || /^(mo|mon|month)s?$/i.test(spelled)) unit = "M";
  else if (spelled === "t" || spelled === "T" || /^ticks?$/i.test(spelled))
    unit = "T";
  else return null;
  if (!Number.isInteger(value) || value < 1 || value > LIMITS[unit]) return null;
  // Whole hours spelled in minutes become hours, e.g. 60 → 1h, 240 → 4h.
  if (unit === "m" && value % 60 === 0 && value / 60 <= LIMITS.h) {
    return parseInterval(`${value / 60}h`);
  }
  return {
    id: `${value}${unit}`,
    unit,
    value,
    ms: unit === "T" ? 0 : value * UNIT_MS[unit],
  };
}

export function isValidInterval(raw: string): boolean {
  return parseInterval(raw) !== null;
}

/** Canonical id for any accepted spelling; falls back to `fallback`. */
export function normalizeInterval(raw: string, fallback = "15m"): string {
  return parseInterval(raw)?.id ?? fallback;
}

export function isTickInterval(raw: string): boolean {
  return parseInterval(raw)?.unit === "T";
}

/** Duration in ms of a time interval; ticks have no duration (returns 1s). */
export function intervalMs(raw: string): number {
  const interval = parseInterval(raw);
  if (!interval) return 15 * 60_000;
  return interval.unit === "T" ? 1000 : interval.ms;
}

export function intervalLabel(raw: string): string {
  const interval = parseInterval(raw);
  if (!interval) return raw;
  const names: Record<IntervalUnit, string> = {
    s: "second",
    m: "minute",
    h: "hour",
    D: "day",
    W: "week",
    M: "month",
    T: "tick",
  };
  return `${interval.value} ${names[interval.unit]}${interval.value === 1 ? "" : "s"}`;
}

const bucketIntervals = new Map<string, Interval>();

function intervalForBucket(raw: string): Interval | null {
  const cached = bucketIntervals.get(raw);
  if (cached) return cached;
  const parsed = parseInterval(raw);
  if (parsed && raw.length <= 24) {
    if (bucketIntervals.size >= 256) bucketIntervals.delete(bucketIntervals.keys().next().value!);
    bucketIntervals.set(raw, parsed);
  }
  return parsed;
}

/** Start of the bar that contains `time` for a time interval. */
export function bucketStart(raw: string, time: number): number {
  const interval = intervalForBucket(raw);
  if (!interval || interval.unit === "T") return time;
  if (interval.unit === "W") {
    const span = interval.ms;
    return Math.floor((time - WEEK_OFFSET) / span) * span + WEEK_OFFSET;
  }
  if (interval.unit === "M") {
    const date = new Date(time);
    const months = date.getUTCFullYear() * 12 + date.getUTCMonth();
    const start = Math.floor(months / interval.value) * interval.value;
    return Date.UTC(Math.floor(start / 12), start % 12, 1);
  }
  return Math.floor(time / interval.ms) * interval.ms;
}

/** Start of the bar that follows the one beginning at `start`. */
export function nextBucket(raw: string, start: number): number {
  const interval = intervalForBucket(raw);
  if (!interval || interval.unit === "T") return start + 1000;
  if (interval.unit === "M") {
    const date = new Date(start);
    return Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + interval.value,
      1,
    );
  }
  return start + interval.ms;
}

export interface SourcePlan {
  /** Binance kline interval to request (api spelling). */
  api: string;
  /** Id of the native interval. */
  nativeId: string;
  nativeMs: number;
  /** True when bars must be resampled into the requested interval. */
  resample: boolean;
  /** Approximate number of native bars that make up one requested bar. */
  factor: number;
}

/**
 * Pick the cheapest exchange interval to build `raw` from: the interval
 * itself when Binance serves it, otherwise the coarsest native interval that
 * divides it evenly.
 */
export interface NativeSpec {
  id: string;
  api: string;
  ms: number;
}

export function planSource(
  raw: string,
  natives: readonly NativeSpec[] = NATIVE_INTERVALS,
): SourcePlan | null {
  const interval = parseInterval(raw);
  if (!interval || interval.unit === "T") return null;
  const exact = natives.find((n) => n.id === interval.id);
  if (exact)
    return {
      api: exact.api,
      nativeId: exact.id,
      nativeMs: exact.ms,
      resample: false,
      factor: 1,
    };
  let candidates = natives.filter((n) => n.id !== "1W" && n.id !== "1M");
  if (interval.unit === "M") candidates = natives.filter((n) => n.id === "1M");
  else if (interval.unit === "W" || interval.unit === "D")
    candidates = natives.filter((n) => n.id === "1D");
  const source =
    interval.unit === "M"
      ? candidates[0]
      : [...candidates].reverse().find((n) => interval.ms % n.ms === 0 && n.ms <= interval.ms);
  if (!source) return null;
  return {
    api: source.api,
    nativeId: source.id,
    nativeMs: source.ms,
    resample: true,
    factor: Math.max(1, Math.round(interval.ms / source.ms)),
  };
}
