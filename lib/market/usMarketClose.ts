const NY_ZONE = "America/New_York";
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type UsMarketPhase = "premarket" | "regular" | "postmarket" | "closed";

interface NyParts {
  year: number;
  month: number;
  day: number;
  weekday: number; // 0 = Sun ... 6 = Sat
  hour: number;
  minute: number;
  second: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const WEEKDAY_DE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;

const nyPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NY_ZONE,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function readNyParts(ms: number): NyParts {
  const parts = nyPartsFormatter.formatToParts(new Date(ms));
  let year = 1970, month = 1, day = 1, weekday = 0, hour = 0, minute = 0, second = 0;
  for (const part of parts) {
    if (part.type === "year") year = Number(part.value);
    else if (part.type === "month") month = Number(part.value);
    else if (part.type === "day") day = Number(part.value);
    else if (part.type === "weekday") weekday = WEEKDAY_INDEX[part.value] ?? 0;
    else if (part.type === "hour") hour = Number(part.value) % 24;
    else if (part.type === "minute") minute = Number(part.value);
    else if (part.type === "second") second = Number(part.value);
  }
  return { year, month, day, weekday, hour, minute, second };
}

/**
 * Resolves a wall-clock `America/New_York` timestamp (YYYY-MM-DD HH:MM:00) to exact UTC epoch ms,
 * handling EST (-05:00) and EDT (-04:00) DST boundaries deterministically.
 */
function nyWallClockToUtcMs(year: number, month: number, day: number, hour: number, minute = 0): number {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  // Two-pass fixed-point offset resolution handles DST transitions accurately.
  let guess = targetAsUtc + 5 * HOUR_MS;
  for (let pass = 0; pass < 3; pass++) {
    const p = readNyParts(guess);
    const observedAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
    const diff = targetAsUtc - observedAsUtc;
    if (diff === 0) return guess;
    guess += diff;
  }
  return guess;
}

function shiftCalendarDate(year: number, month: number, day: number, deltaDays: number) {
  const d = new Date(Date.UTC(year, month - 1, day + deltaDays, 12, 0, 0, 0));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Returns the UTC epoch milliseconds of the latest completed US regular equity close
 * (16:00 America/New_York, Mon–Fri) at or before `now`.
 */
export function lastUsMarketCloseMs(now = Date.now()): number {
  const safeNow = Number.isFinite(now) ? now : Date.now();
  const p = readNyParts(safeNow);
  let deltaDays = 0;

  if (p.weekday === 0) {
    // Sunday -> Friday
    deltaDays = -2;
  } else if (p.weekday === 6) {
    // Saturday -> Friday
    deltaDays = -1;
  } else if (p.hour < 16) {
    // Weekday before 16:00 ET -> previous weekday (Monday -> Friday)
    deltaDays = p.weekday === 1 ? -3 : -1;
  }

  const target = shiftCalendarDate(p.year, p.month, p.day, deltaDays);
  return nyWallClockToUtcMs(target.year, target.month, target.day, 16, 0);
}

/** Classifies the current US equity session phase in `America/New_York`. */
export function usMarketPhase(now = Date.now()): UsMarketPhase {
  const safeNow = Number.isFinite(now) ? now : Date.now();
  const p = readNyParts(safeNow);
  if (p.weekday === 0 || p.weekday === 6) return "closed";
  const minutes = p.hour * 60 + p.minute;
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "regular";
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "premarket";
  if (minutes >= 16 * 60 && minutes < 20 * 60) return "postmarket";
  return "closed";
}

export interface UsCloseMove {
  change: number;
  changePercent: number;
}

/** Computes absolute and percentage move from `usClosePrice` to `currentPrice`. */
export function changeSinceUsClose(
  currentPrice: number | undefined | null,
  usClosePrice: number | undefined | null,
): UsCloseMove | null {
  if (
    typeof currentPrice !== "number"
    || typeof usClosePrice !== "number"
    || !Number.isFinite(currentPrice)
    || !Number.isFinite(usClosePrice)
    || currentPrice <= 0
    || usClosePrice <= 0
  ) {
    return null;
  }
  const change = currentPrice - usClosePrice;
  const changePercent = (change / usClosePrice) * 100;
  if (!Number.isFinite(change) || !Number.isFinite(changePercent)) return null;
  return { change, changePercent };
}

/** Concise German anchor label, e.g. `"US-Close Fr 16:00 ET"`. */
export function formatUsCloseAnchor(closeMs: number): string {
  if (!Number.isFinite(closeMs)) return "US-Close 16:00 ET";
  const p = readNyParts(closeMs);
  const dayLabel = WEEKDAY_DE[p.weekday] ?? "";
  return `US-Close ${dayLabel} 16:00 ET`;
}

export const US_CLOSE_CACHE_TTL_MS = 12 * HOUR_MS;
export const US_CLOSE_LOOKBACK_MS = 3 * DAY_MS;
