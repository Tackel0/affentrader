import { marketSessions, type MarketSessionCalendar } from "@/lib/market/sessionWindows";
import { sessionCalendar, SessionCalendarError, type SessionClock, type SessionWindow } from "./sessionCalendar";
import { periodSessionCalendar, type SessionPeriod } from "./sessionPeriods";

export const TPO_TRADING_HOURS = ["Full day", "Regular hours (RTH)", "Extended hours (ETH)", "Pre-market", "Market", "Post-market", "London", "New York", "Asian", "Custom"] as const;
export type TpoTradingHours = typeof TPO_TRADING_HOURS[number];
export interface TpoTradingClock extends SessionClock { sessionPeriod?: SessionPeriod; tradingHours?: TpoTradingHours; customStart?: number; customEnd?: number }
export const validTpoTradingHours = (value: unknown): value is TpoTradingHours => TPO_TRADING_HOURS.includes(value as TpoTradingHours);
export const validHHMM = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2400 && value % 100 < 60;
const minutes = (value: number) => Math.floor(value / 100) * 60 + value % 100;
// Fixed UTC approximations, checked against Vela's public TPO control bundle.
const named = { "Pre-market": [540, 810], Market: [810, 1200], "Post-market": [1200, 0], London: [480, 990], "New York": [780, 1320], Asian: [0, 540] } as const;
export function tpoTradingCalendar(style: TpoTradingClock, symbol?: string, calendar?: MarketSessionCalendar): ReturnType<typeof sessionCalendar> {
  if ((style.sessionPeriod ?? "Day") !== "Day") return periodSessionCalendar(style, symbol);
  const hours = style.tradingHours ?? "Full day";
  if (!validTpoTradingHours(hours)) throw new SessionCalendarError("Choose a supported trading-hours window.");
  if (hours === "Custom" || hours in named) {
    if (hours === "Custom" && (!validHHMM(style.customStart ?? 0) || !validHHMM(style.customEnd ?? 0))) throw new SessionCalendarError("Custom hours must be valid UTC HHMM times (0000–2400).");
    const [start, end] = hours === "Custom" ? [minutes(style.customStart ?? 0) % 1440, minutes(style.customEnd ?? 0) % 1440] : named[hours as keyof typeof named];
    return sessionCalendar({ sessionZone: "UTC", sessionStartMinutes: start, sessionMinutes: (end - start + 1440) % 1440 || 1440, weekdaysOnly: false });
  }
  const source = calendar ?? marketSessions(symbol), mode = hours === "Regular hours (RTH)" ? "regular" : hours === "Extended hours (ETH)" ? "extended" : source?.mode;
  // Continuous/no-calendar venues retain the existing configurable clock.
  if (!source?.regular.length) return periodSessionCalendar(style, symbol);
  const windows = mode === "extended" ? source.extended : source.regular;
  if (!windows.length) throw new SessionCalendarError("The source has no extended-hours calendar for this history. Load extended chart history first.");
  const at = (time: number): SessionWindow | null => {
    if (!Number.isSafeInteger(time)) throw new SessionCalendarError("Session history contains an unsupported date.", "precision");
    let lo = 0, hi = windows.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (windows[mid][0] <= time) lo = mid + 1; else hi = mid; }
    const w = windows[lo - 1];
    return w && time < w[1] ? { start: w[0], end: w[1], date: new Date(w[0]).toISOString().slice(0, 10) } : null;
  };
  return { at, forDate(date: string) {
    const window = windows.find(w => new Date(w[0]).toISOString().slice(0, 10) === date);
    if (!window) throw new SessionCalendarError("No source trading window is available for this date.");
    return { start: window[0], end: window[1], date };
  } };
}
export function tpoTradingHoursBasis(style: TpoTradingClock, symbol?: string, calendar?: MarketSessionCalendar) {
  if ((style.sessionPeriod ?? "Day") !== "Day") return "UTC calendar period; daily trading-hour filters do not apply";
  const hours = style.tradingHours ?? "Full day";
  if (hours === "Custom" || hours in named) return "Fixed UTC window; not an exchange holiday/DST calendar";
  return (calendar ?? marketSessions(symbol))?.regular.length ? "Source-resolved trading windows; no holiday/DST extrapolation" : "No source calendar; configured day-clock fallback";
}
