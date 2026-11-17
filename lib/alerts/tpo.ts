import type { OHLCV } from "@/types/trading";
import type { TpoAlertCondition, TpoAlertObservation, TpoAlertSettings } from "@/types/tpoAlerts";
import type { MarketView } from "./rules";
import { defaultTpo, validTpo } from "@/lib/orderflow/tpoSettings";
import { buildTpoSessions, tpoCalendar, type TpoSession } from "@/lib/orderflow/tpoModel";
import { tpoReferenceLevels } from "@/lib/orderflow/tpoReferenceLevels";
import { intervalMs, isTickInterval, isValidInterval, nextBucket } from "@/lib/market/intervals";
import { MAX_HISTORY_BARS } from "@/lib/market/klines";
import { conditionMatches } from "./engine";
import { marketSessions, type MarketSessionCalendar } from "@/lib/market/sessionWindows";
import { tpoExplicitTape } from "@/lib/orderflow/tpoCandleSource";
import { periodSessionCalendar } from "@/lib/orderflow/sessionPeriods";

const fields = ["rowSize", "targetRows", "blockMinutes", "sessionZone", "sessionStartMinutes", "sessionMinutes", "weekdaysOnly", "valueAreaPercent"] as const;
const optionalFields = ["sessionPeriod", "tradingHours", "customStart", "customEnd"] as const;
export function tpoAlertSettings(value: TpoAlertSettings = defaultTpo(), symbol?: string): TpoAlertSettings {
  const settings = Object.fromEntries([...fields, ...optionalFields.filter(key => Object.hasOwn(value, key))].map(key => [key, value[key]])) as unknown as TpoAlertSettings;
  const source = marketSessions(symbol);
  if (settings.tradingHours === "Full day" && (settings.sessionPeriod ?? "Day") === "Day" && source?.regular.length)
    settings.tradingHours = source.mode === "extended" ? "Extended hours (ETH)" : "Regular hours (RTH)";
  return settings;
}
const profileMinutes = (s: TpoAlertSettings) => s.sessionPeriod === "Month" ? 31 * 1440 : s.sessionPeriod === "Week" ? 7 * 1440
  : s.tradingHours && s.tradingHours !== "Full day" ? 1440 : s.sessionMinutes;
export function validateTpoCondition(value: unknown, timeframe?: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Invalid TPO condition.";
  const condition = value as TpoAlertCondition;
  if (condition.type !== "tpo" || Object.keys(value).some(key => !["type", "level", "direction", "settings", "symbol", "timeframe"].includes(key))) return "Invalid TPO condition fields.";
  if (!["poc", "vah", "val"].includes(condition.level) || !["crossing", "crossing_up", "crossing_down"].includes(condition.direction)) return "Invalid TPO level or direction.";
  const settings = condition.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings) || Object.keys(settings).some(key => ![...fields, ...optionalFields].includes(key as typeof fields[number])) ||
    !fields.every(key => Object.hasOwn(settings, key)) || !validTpo({ ...defaultTpo(), ...settings })) return "Invalid saved TPO profile settings.";
  if (timeframe !== undefined) {
    if (typeof timeframe !== "string") return "Invalid TPO alert interval.";
    const duration = intervalMs(timeframe), block = Number(settings.blockMinutes) * 60000;
    if (!isValidInterval(timeframe) || isTickInterval(timeframe) || duration <= 0 || duration > block || block % duration !== 0)
      return "TPO alerts need time bars that divide the saved TPO block length.";
    if (Math.ceil(profileMinutes(settings) * 60000 / duration) * 2 + 2 > MAX_HISTORY_BARS)
      return "This TPO session needs more history than the alert history limit. Choose a coarser interval or shorter session.";
  }
  return null;
}
export function tpoAlertHistory(settings: TpoAlertSettings, timeframe: string): number {
  return Math.min(MAX_HISTORY_BARS, Math.max(300, Math.ceil((3 * 86400000 + profileMinutes(settings) * 60000 * ((settings.sessionPeriod ?? "Day") === "Day" ? 1 : 3)) / Math.max(1, intervalMs(timeframe))) + 2));
}
type Bar = Pick<OHLCV, "time" | "high" | "low">;
interface Cached { bars: Bar[]; sessions: TpoSession[] }
const profiles = new Map<string, Cached>();
function profile(key: string, bars: readonly Bar[], condition: TpoAlertCondition, timeframe: string, symbol: string, calendar?: MarketSessionCalendar): readonly TpoSession[] {
  let cached = profiles.get(key);
  if (!cached || cached.bars.length !== bars.length || bars.some((bar, index) => bar.time !== cached!.bars[index].time || bar.high !== cached!.bars[index].high || bar.low !== cached!.bars[index].low)) {
    const style = { ...defaultTpo(), ...condition.settings };
    // Saved pre-trading-hours rules keep their original wall-clock semantics.
    cached = { bars: bars.map(({ time, high, low }) => ({ time, high, low })), sessions: Object.hasOwn(condition.settings, "tradingHours")
      ? buildTpoSessions(bars, style, timeframe, symbol, tpoCalendar(style, symbol, calendar))
      : buildTpoSessions(bars, style, timeframe, symbol, periodSessionCalendar(style, symbol)) };
  }
  profiles.delete(key); profiles.set(key, cached);
  if (profiles.size > 64) profiles.delete(profiles.keys().next().value!);
  return cached.sessions;
}
export const tpoObservationKey = (condition: TpoAlertCondition, symbol: string, timeframe: string) => JSON.stringify([symbol, timeframe, condition.level, condition.direction, tpoAlertSettings(condition.settings)]);
/** Future/forming OHLC cannot establish the next completed profile. Every changed reference starts a new observation baseline. */
export function evaluateTpo(condition: TpoAlertCondition, view: MarketView, symbol: string, timeframe: string): {
  met: boolean; incomplete: boolean; detail: string; key: string; sample?: TpoAlertObservation;
} {
  const key = tpoObservationKey(condition, symbol, timeframe), unavailable = (detail: string) => ({ met: false, incomplete: true, detail, key });
  const at = view.at ?? view.quote?.time, price = view.quote?.price;
  if (validateTpoCondition(condition, timeframe) || view.candleContext?.ready === false || !Number.isFinite(at) || !Number.isFinite(price) || !price || price <= 0)
    return unavailable("Waiting for current price and uninterrupted TPO history.");
  const independent = !view.quote?.simulated && tpoExplicitTape(symbol, condition.settings) && view.tpoSource ? view.tpoSource(condition.settings) : undefined;
  if (!view.quote?.simulated && tpoExplicitTape(symbol, condition.settings) && view.tpoSource && !independent)
    return unavailable("Waiting for independent TPO session history.");
  const bars = (independent?.bars ?? view.bars).filter(bar => nextBucket(timeframe, bar.time) <= at!);
  if (!bars.length) return unavailable("Waiting for closed TPO source candles.");
  const signature = JSON.stringify([symbol, timeframe, tpoAlertSettings(condition.settings), independent?.calendar?.revision ?? marketSessions(symbol)?.revision, view.candleContext?.generation ?? "", view.quote?.simulated ?? false]);
  let sessions: readonly TpoSession[];
  try { sessions = profile(signature, bars, condition, timeframe, symbol, independent?.calendar); }
  catch (error) { return unavailable(error instanceof Error ? error.message : "TPO source calendar is unavailable."); }
  // A confirmed final candle proves completion at its close even without a later forming candle in closeView.
  const session = sessions.findLast(value => value.end <= at! && value.completion.missingSlots === 0 &&
    value.coverage.loadedBars === value.completion.expectedBars && nextBucket(timeframe, value.coverage.lastBar) === value.end);
  if (!session) return unavailable("No fully covered completed TPO session is loaded.");
  const reference = tpoReferenceLevels({ ...session, completion: { ...session.completion, status: "complete" } })!;
  const level = reference[condition.level], identity = JSON.stringify([signature, reference.sessionStart, reference.from, level]);
  const sample: TpoAlertObservation = { reference: identity, price: price!, at: at! }, previous = view.previousTpo?.[key];
  const met = !!previous && previous.reference === identity && previous.at <= at! && conditionMatches(condition.direction, previous.price, price!, level);
  return { met, incomplete: false, key, sample,
    detail: `Price ${condition.direction.replaceAll("_", " ")} latest completed TPO ${condition.level.toUpperCase()} ${level} · source session ${new Date(reference.sessionStart).toISOString()}–${new Date(reference.from).toISOString()}` };
}
