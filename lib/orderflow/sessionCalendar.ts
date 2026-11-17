import { resolveZone, wallDateTime, wallTimeCandidates } from "@/lib/timezones";

export interface SessionClock { sessionZone: string; sessionStartMinutes: number; sessionMinutes: number; weekdaysOnly: boolean }
export interface SessionWindow { start: number; end: number; date: string }
export class SessionCalendarError extends Error {
  constructor(message: string, readonly reason: "session" | "precision" = "session") { super(message); }
}
const DAY = 86400000, MINUTE = 60000;
const dateMinutes = (date: string, minutes: number) => new Date(Date.parse(`${date}T00:00:00Z`) + minutes * MINUTE).toISOString().slice(0, 16);

/** Wall-clock sessions; repeated hours remain distinct elapsed instants. */
export function sessionCalendar(preferences: SessionClock, symbol?: string) {
  const zone = resolveZone(preferences.sessionZone, symbol);
  const dates = new Map<string, SessionWindow>(), times = new Map<number, SessionWindow | null>();
  let selectedWindow: { window: SessionWindow; allowed: boolean } | null = null;
  const boundary = (local: string, last = false) => {
    for (let offset = 0; offset <= 180; offset++) {
      const next = new Date(Date.parse(`${local}:00Z`) + offset * MINUTE).toISOString().slice(0, 16);
      const choices = wallTimeCandidates(next, zone);
      if (choices.length) return last ? choices.at(-1)! : choices[0];
    }
    throw new SessionCalendarError(`The session boundary cannot be resolved in ${zone}. Choose another session time.`);
  };
  const forDate = (date: string) => {
    const existing = dates.get(date); if (existing) return existing;
    const start = boundary(dateMinutes(date, preferences.sessionStartMinutes));
    const end = boundary(dateMinutes(date, preferences.sessionStartMinutes + preferences.sessionMinutes), preferences.sessionMinutes < 1440);
    if (end <= start) throw new SessionCalendarError("The session end must follow its start.");
    const result = { start, end, date };
    if (dates.size >= 400) dates.delete(dates.keys().next().value!);
    dates.set(date, result); return result;
  };
  return { forDate,
    at(time: number): SessionWindow | null {
      if (!Number.isFinite(time) || Math.abs(time) > 8640000000000000) throw new SessionCalendarError("Session history contains an unsupported date.", "precision");
      if (selectedWindow && time >= selectedWindow.window.start && time < selectedWindow.window.end) return selectedWindow.allowed ? selectedWindow.window : null;
      if (times.has(time)) return times.get(time)!;
      const date = wallDateTime(time, zone).slice(0, 10), today = forDate(date);
      const result = time >= today.start ? today : forDate(new Date(Date.parse(`${date}T00:00:00Z`) - DAY).toISOString().slice(0, 10));
      const weekday = new Date(`${result.date}T00:00:00Z`).getUTCDay();
      const allowed = !preferences.weekdaysOnly || weekday !== 0 && weekday !== 6;
      const selected = time < result.end && allowed ? result : null;
      selectedWindow = { window: result, allowed };
      if (times.size >= 20000) times.delete(times.keys().next().value!);
      times.set(time, selected); return selected;
    } };
}
