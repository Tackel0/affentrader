import { bucketStart, nextBucket } from "@/lib/market/intervals";
import { sessionCalendar, SessionCalendarError, type SessionClock, type SessionWindow } from "./sessionCalendar";

export type SessionPeriod = "Day" | "Week" | "Month";
export interface PeriodSessionClock extends SessionClock { sessionPeriod?: SessionPeriod }
export const validSessionPeriod = (value: unknown): value is SessionPeriod => value === "Day" || value === "Week" || value === "Month";
/** Day preserves the existing custom wall-clock calendar. Week/month are UTC
 * Monday/first-of-month periods and deliberately ignore day-hour restrictions. */
export function periodSessionCalendar(style: PeriodSessionClock, symbol?: string): ReturnType<typeof sessionCalendar> {
  const period = style.sessionPeriod ?? "Day";
  if (!validSessionPeriod(period)) throw new SessionCalendarError("Choose Day, Week or Month for the session period.");
  if (period === "Day") return sessionCalendar(style, symbol);
  const timeframe = period === "Week" ? "1W" : "1M";
  const at = (time: number): SessionWindow => {
    if (!Number.isSafeInteger(time) || Math.abs(time) >= 8640000000000000) throw new SessionCalendarError("Session period exceeds the supported calendar.", "precision");
    const start = bucketStart(timeframe, time), end = nextBucket(timeframe, start);
    if (![start, end].every(Number.isSafeInteger) || Math.abs(start) >= 8640000000000000 || Math.abs(end) >= 8640000000000000)
      throw new SessionCalendarError("Session period exceeds the supported calendar.", "precision");
    return { start, end, date: new Date(start).toISOString().slice(0, 10) };
  };
  return { at, forDate(date: string) {
    const time = Date.parse(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date)
      throw new SessionCalendarError("Choose a valid session calendar date.");
    return at(time);
  } };
}
