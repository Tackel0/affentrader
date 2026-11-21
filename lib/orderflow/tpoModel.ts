import type { OHLCV } from "@/types/trading";
import { intervalMs, isTickInterval, parseInterval } from "@/lib/market/intervals";
import { SessionCalendarError, type SessionWindow } from "./sessionCalendar";
import { priceStep } from "./math";
import { buildTpoRows, TpoProfileError, tpoValueArea, type TpoRow } from "./tpoMath";
import { defaultTpo, tpoIbMinutes, type TpoPreferences } from "./tpoSettings";
import { executionPriceGrid } from "./priceGrid";
import { tpoInitialBalanceMinutes, type TpoInitialBalance } from "./tpoInitialBalance";
import { tpoStructure, type TpoStructure } from "./tpoStructure";
import { tpoTradingCalendar } from "./tpoTradingHours";
import { marketSessions, type MarketSessionCalendar } from "@/lib/market/sessionWindows";
import { scopedTpoOperations } from "./tpoOperations";
import { tpoMarkers, type TpoMarkers } from "./tpoMarkers";
import { resolveZone } from "@/lib/timezones";

const MINUTE = 60000;
type Bar = Pick<OHLCV, "time" | "high" | "low"> & Partial<Pick<OHLCV, "open" | "close">>;
export type TpoSessionWindow = SessionWindow;
export interface TpoSession extends TpoSessionWindow {
  markers?: TpoMarkers;
  members?: TpoSessionWindow[];
  expanded?: boolean;
  periodSpans?: { first: number; count: number; start: number; end: number }[];
  rows: TpoRow[];
  step: number;
  valueArea: NonNullable<ReturnType<typeof tpoValueArea>>;
  partialStart: boolean;
  initialBalance: TpoInitialBalance;
  structure: TpoStructure;
  completion: { status: "developing" | "incomplete" | "complete"; expectedBars: number; missingSlots: number };
  coverage: { firstBar: number; lastBar: number; loadedBars: number; missingSlots: number; observedBlocks: number };
}
export function tpoCalendar(preferences: TpoPreferences, symbol?: string, source?: MarketSessionCalendar) {
  const calendar = tpoTradingCalendar(preferences, symbol, source);
  const guarded = <T>(read: () => T): T => {
    try { return read(); } catch (error) {
      if (error instanceof SessionCalendarError) throw new TpoProfileError(error.reason, error.message);
      throw error;
    }
  };
  return { at: (time: number) => guarded(() => calendar.at(time)), forDate: (date: string) => guarded(() => calendar.forDate(date)) };
}
function groupSessions(bars: readonly Bar[], calendar: ReturnType<typeof tpoCalendar>) {
  const groups = new Map<number, { window: TpoSessionWindow; bars: Bar[] }>();
  for (const bar of bars) {
    if (!Number.isFinite(bar.time)) throw new TpoProfileError("precision", "TPO history contains an invalid bar time.");
    const window = calendar.at(bar.time); if (!window) continue;
    let group = groups.get(window.start); if (!group) { group = { window, bars: [] }; groups.set(window.start, group); }
    group.bars.push(bar);
  }
  return [...groups.values()].sort((a, b) => a.window.start - b.window.start);
}
export function buildTpoSessions(bars: readonly Bar[], preferences: TpoPreferences, timeframe: string, symbol?: string,
  calendar = tpoCalendar(preferences, symbol)): TpoSession[] {
  const duration = intervalMs(timeframe), block = Number(preferences.blockMinutes) * MINUTE;
  if (!parseInterval(timeframe) || isTickInterval(timeframe) || duration <= 0 || duration > block || block % duration !== 0)
    throw new TpoProfileError("interval", "Choose time bars that divide the TPO block length (for example 5m, 15m or 30m for a 30-minute block).");
  let totalCells = 0;
  let revealedUntil = -Infinity; for (const bar of bars) revealedUntil = Math.max(revealedUntil, bar.time);
  const ops = scopedTpoOperations(preferences, timeframe, symbol), groups = groupSessions(bars, calendar);
  const composites: typeof groups[] = [];
  for (const group of groups) {
    const previous = composites.at(-1)?.at(-1);
    if (previous && ops.links.some(([a, b]) => a === previous.window.start && b === group.window.start)) composites.at(-1)!.push(group);
    else composites.push([group]);
  }
  return composites.map(parts => {
    const windows = parts.map(p => p.window), window = { ...windows[0], end: windows.at(-1)!.end }, source = parts.flatMap(p => p.bars);
    source.sort((a, b) => a.time - b.time);
    if (parts.some(p => p.window.start % duration !== 0 || p.bars.some(bar => (bar.time - p.window.start) % duration !== 0 || bar.time + duration > p.window.end)))
      throw new TpoProfileError("interval", "These bars cross a TPO session boundary. Choose a finer interval or align the session start and length.");
    let high = -Infinity, low = Infinity;
    for (const bar of source) { high = Math.max(high, bar.high); low = Math.min(low, bar.low); }
    const base = priceStep(Math.abs(high));
    const step = preferences.rowSize || executionPriceGrid(base).row(Math.max(1, Math.ceil((high - low) / preferences.targetRows / base))).lower;
    let first = 0;
    const spans = windows.map(w => { const span = { first, count: Math.ceil((w.end - w.start) / block), start: w.start, end: w.end }; first += span.count; return span; });
    const mapped = parts.length === 1 ? source : parts.flatMap((p, i) => p.bars.map(bar => ({ ...bar,
      time: window.start + (spans[i].first + Math.floor((bar.time - p.window.start) / block)) * block })));
    const rows = buildTpoRows(mapped, step, block, window.start), valueArea = tpoValueArea(rows, preferences.valueAreaPercent);
    totalCells += valueArea?.total ?? 0;
    if (totalCells > 1000000) throw new TpoProfileError("capacity", "Loaded history exceeds 1,000,000 TPO cells. Increase the row size or block length.");
    if (!valueArea) throw new TpoProfileError("precision", "This session has no valid TPO observations.");
    const firstBar = source[0].time, lastBar = source.at(-1)!.time, loadedBars = new Set(source.map(bar => bar.time)).size;
    const expectedBars = windows.reduce((sum, w) => sum + Math.ceil((w.end - w.start) / duration), 0), ended = revealedUntil >= window.end;
    const dueAt = (time: number) => windows.reduce((sum, w) => sum + Math.min(Math.ceil((w.end - w.start) / duration), Math.max(0, Math.floor((time - w.start) / duration) + 1)), 0);
    const due = dueAt(revealedUntil);
    const missingSlots = Math.max(0, due - loadedBars);
    const status = missingSlots || windows.some(w => (w.end - w.start) % duration !== 0) ? "incomplete" : ended ? "complete" : "developing";
    return { ...window, markers: tpoMarkers(source, window.start, low, high), ...(parts.length > 1 ? { members: windows, periodSpans: spans } : {}),
      ...(ops.expanded.some(p => p[0] === window.start) ? { expanded: ops.expanded.find(p => p[0] === window.start)![1] } : {}), rows, step, valueArea, partialStart: firstBar > window.start,
      initialBalance: tpoInitialBalanceMinutes(source, window.start, window.end, tpoIbMinutes(preferences), duration, revealedUntil),
      structure: tpoStructure(rows, step),
      completion: { status, expectedBars, missingSlots },
      coverage: { firstBar, lastBar, loadedBars, missingSlots: dueAt(lastBar) - loadedBars,
        observedBlocks: new Set(mapped.map(bar => Math.floor((bar.time - window.start) / block))).size } };
  });
}
/** Defaults show up to three loaded sessions, retaining session anchors instead of moving profiles with the viewport. */
export function tpoWindow(bars: readonly { time: number }[], preferences = defaultTpo(), symbol?: string) {
  if (!bars.length) return;
  const fallback = () => ({ from: bars[Math.max(0, bars.length - 150)].time, to: bars.at(-1)!.time + 30 * MINUTE });
  let calendar: ReturnType<typeof tpoCalendar>;
  try { calendar = tpoCalendar(preferences, symbol); }
  catch (error) {
    // Initial viewport selection runs before an independent layer's calendar
    // arrives. Keep the host's normal framing; the profile reports its own load
    // or validation state rather than crashing the React workspace.
    if (error instanceof SessionCalendarError || error instanceof TpoProfileError) return fallback();
    throw error;
  }
  const sessions = new Map<number, TpoSessionWindow>();
  for (const bar of bars) { const session = calendar.at(bar.time); if (session) sessions.set(session.start, session); }
  const starts = [...sessions.keys()].sort((a, b) => a - b);
  if (!starts.length) return fallback();
  const from = Math.max(bars[0].time, starts[Math.max(0, starts.length - 3)]), last = bars.at(-1)!.time;
  return { from, to: Math.max(from + MINUTE, last + 30 * MINUTE) };
}

/** Inspect all contributing fields: history repair may mutate an older bar in place. Display-only edits reuse the model. */
export function createTpoCache() {
  let snapshot: Bar[] = [], settings = "", calendar: ReturnType<typeof tpoCalendar> | undefined;
  let previousSource: MarketSessionCalendar | undefined;
  let result: TpoSession[] = [], failure: unknown;
  return { read(bars: readonly Bar[], preferences: TpoPreferences, timeframe: string, symbol: string, source?: MarketSessionCalendar) {
    const sessionSource = source ?? marketSessions(symbol);
    const nextSettings = JSON.stringify([timeframe, symbol, preferences.sessionPeriod ?? "Day", resolveZone(preferences.sessionZone, symbol), preferences.sessionStartMinutes, preferences.sessionMinutes,
      preferences.tradingHours ?? "Full day", preferences.customStart ?? 0, preferences.customEnd ?? 0, sessionSource?.revision,
      preferences.weekdaysOnly, preferences.blockMinutes, preferences.rowSize, preferences.targetRows, preferences.valueAreaPercent, tpoIbMinutes(preferences), scopedTpoOperations(preferences, timeframe, symbol)]);
    const settingsChanged = settings !== nextSettings || previousSource !== sessionSource;
    let structureChanged = snapshot.length !== bars.length, pricesChanged = false;
    for (let i = 0; i < bars.length && !structureChanged && !settingsChanged; i++) {
      const bar = bars[i], prior = snapshot[i];
      structureChanged = !Object.is(bar.time, prior.time) || !Object.is(bar.high, prior.high) || !Object.is(bar.low, prior.low);
      pricesChanged ||= !Object.is(bar.open, prior.open) || !Object.is(bar.close, prior.close);
    }
    if (settingsChanged || structureChanged) {
      if (settingsChanged) calendar = tpoCalendar(preferences, symbol, sessionSource);
      previousSource = sessionSource; settings = nextSettings; snapshot = bars.map(({ time, high, low, open, close }) => ({ time, high, low, open, close })); failure = undefined;
      try { result = buildTpoSessions(bars, preferences, timeframe, symbol, calendar); } catch (error) { failure = error; }
    } else if (pricesChanged) {
      // Quote-only updates affect the endpoint markers, not TPO visits, price
      // grids, POC/VA, structure or IB. Retain those expensive model objects.
      snapshot = bars.map(({ time, high, low, open, close }) => ({ time, high, low, open, close }));
      if (!failure) {
        const sources = new Map(groupSessions(bars, calendar!).map(group => [group.window.start, group.bars]));
        result = result.map(session => ({ ...session, markers: tpoMarkers((session.members ?? [session]).flatMap(w => sources.get(w.start) ?? []).sort((a, b) => a.time - b.time),
          session.start, session.markers!.low, session.markers!.high) }));
      }
    }
    if (failure) throw failure;
    return result;
  } };
}

