import { marketSessions, type MarketSessionCalendar } from "@/lib/market/sessionWindows";
import type { VolumeProfilePreferences } from "./volumeProfileSettings";
import { tpoTradingCalendar } from "./tpoTradingHours";
/** Session VP shares TPO's documented windows. A chart-scoped source mode
 * prevents another chart's regular/extended selection from changing Full day. */
export function profileSessionSource(symbol: string, session?: string): MarketSessionCalendar | undefined {
  const source = marketSessions(symbol);
  return source ? { ...source, mode: session === "extended" ? "extended" : "regular" } : undefined;
}
export const profileTradingCalendar = (style: VolumeProfilePreferences, symbol: string, source?: MarketSessionCalendar) => tpoTradingCalendar(style, symbol, source);
export function profileCalendarKey(style: VolumeProfilePreferences, symbol: string, source?: MarketSessionCalendar) {
  return JSON.stringify([symbol, style.sessionPeriod ?? "Day", style.tradingHours ?? "Full day", style.customStart ?? 0, style.customEnd ?? 0,
    style.sessionZone, style.sessionStartMinutes, style.sessionMinutes, style.weekdaysOnly, source?.revision, source?.mode]);
}
