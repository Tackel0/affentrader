import type { Tick } from "@/types/trading";
import type { TradeArchiveRead, TradeArchiveSelection } from "@/types/tradeArchive";
import { isArchivableTrade } from "./tradeArchive";
import type { NativeIndicatorContext } from "@luxalgo/vela";

export const MAX_STUDY_ARCHIVE_TRADES = 100_000;
export interface LoadedStudyArchive { selection: TradeArchiveSelection; count: number; first: number; last: number }
interface Entry { summary: LoadedStudyArchive; trades: readonly Tick[]; ids: Map<string, Tick>; failure?: string; live?: readonly Tick[]; merged?: readonly Tick[]; replay?: ReplayStudyInput }
export interface ReplayStudyInput { trades: readonly Tick[]; through: number; label: string }
const identical = (a: Tick, b: Tick) => a.symbol === b.symbol && a.id === b.id && a.time === b.time && a.price === b.price && a.quantity === b.quantity && a.side === b.side && a.seq === b.seq && a.simulated === b.simulated
  && (a.tradeCount === undefined || b.tradeCount === undefined || a.tradeCount === b.tradeCount);
const order = (a: Tick, b: Tick) => a.time - b.time || (a.seq ?? Number.MAX_VALUE) - (b.seq ?? Number.MAX_VALUE) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Explicit, session-only study inputs. Never publishes events into the market service. */
export class StudyTradeSource {
  private entries = new Map<string, Entry>();
  private revisions = new Map<string, number>();
  private listeners = new Map<string, Set<() => void>>();
  revision(symbol: string) { return this.revisions.get(symbol) ?? 0; }
  loaded(): LoadedStudyArchive[] { return [...this.entries.values()].map(({ summary }) => ({ ...summary, selection: { ...summary.selection } })); }
  subscribe(symbol: string, changed: () => void): () => void {
    const listeners = this.listeners.get(symbol) ?? new Set(); listeners.add(changed); this.listeners.set(symbol, listeners);
    return () => { listeners.delete(changed); if (!listeners.size) this.listeners.delete(symbol); };
  }
  private changed(symbol: string) {
    this.revisions.set(symbol, this.revision(symbol) + 1);
    for (const changed of [...this.listeners.get(symbol) ?? []]) { try { changed(); } catch { /* One destroyed study cannot prevent another from resetting. */ } }
  }
  install(snapshot: TradeArchiveRead, live: readonly Tick[] = []) {
    const { symbol, from, to } = snapshot.selection;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from || to >= 8.64e15 || snapshot.coverage !== "observed-only" || !snapshot.trades.length)
      throw new Error("Choose a nonempty observed execution interval for native studies.");
    if (snapshot.trades.length > MAX_STUDY_ARCHIVE_TRADES) throw new Error("Native studies accept at most 100,000 archived executions. Select a shorter interval; nothing was loaded.");
    const total = this.loaded().filter(item => item.selection.symbol !== symbol).reduce((sum, item) => sum + item.count, snapshot.trades.length);
    if (total > 250_000) throw new Error("Loaded study archives exceed 250,000 executions across markets. Remove another selection first.");
    const ids = new Map<string, Tick>();
    for (const tick of snapshot.trades) {
      if (!isArchivableTrade(tick) || tick.symbol !== symbol || tick.time < from || tick.time >= to || ids.has(tick.id)) throw new Error("Invalid or duplicate archived execution; the previous study source was retained.");
      ids.set(tick.id, Object.freeze({ id: tick.id, symbol: tick.symbol, time: tick.time, price: tick.price, quantity: tick.quantity, side: tick.side, simulated: false,
        ...(tick.seq === undefined ? {} : { seq: tick.seq }), ...(tick.tradeCount === undefined ? {} : { tradeCount: tick.tradeCount }) }));
    }
    const trades = Object.freeze([...ids.values()].sort(order));
    const summary = { selection: { symbol, from, to }, count: trades.length, first: trades[0].time, last: trades.at(-1)!.time };
    const entry: Entry = { summary, trades, ids };
    // Validate overlap and capacity before replacing a working selection.
    this.combine(entry, symbol, live); this.entries.set(symbol, entry); this.changed(symbol);
  }
  clear(symbol: string) { if (this.entries.delete(symbol)) this.changed(symbol); }
  observe(tick: Tick) {
    const entry = this.entries.get(tick.symbol), recorded = entry?.ids.get(tick.id);
    if (entry && recorded && !tick.simulated && !identical(recorded, tick) && !entry.failure) {
      entry.failure = "Archived/live execution ID conflict. Remove or reload the archived selection; no conflicting quantities were combined.";
      this.changed(tick.symbol);
    }
  }
  label(symbol: string, live: readonly Tick[]): string {
    const entry = this.entries.get(symbol);
    return entry && !live.reduce<Tick | undefined>((last, tick) => !last || tick.time > last.time ? tick : last, undefined)?.simulated
      ? `Includes ${entry.summary.count.toLocaleString("en-US")} archived observations; gaps possible` : "";
  }
  read(symbol: string, live: readonly Tick[]): readonly Tick[] {
    const entry = this.entries.get(symbol); return entry ? this.combine(entry, symbol, live) : live;
  }
  replay(symbol: string, through: number | null): ReplayStudyInput | undefined {
    const entry = this.entries.get(symbol);
    if (!entry || through === null || !Number.isSafeInteger(through) || through < 0 || through >= 8.64e15) return undefined;
    if (entry.replay?.through === through) return entry.replay;
    let low = 0, high = entry.trades.length;
    while (low < high) { const middle = (low + high) >>> 1; if (entry.trades[middle].time < through) low = middle + 1; else high = middle; }
    const trades = Object.freeze(entry.trades.slice(0, low));
    return entry.replay = Object.freeze({ trades, through, label: `REPLAY · ${trades.length.toLocaleString("en-US")} archived observations before ${new Date(through).toISOString()} · partial coverage; gaps unknown` });
  }
  private combine(entry: Entry, symbol: string, live: readonly Tick[]): readonly Tick[] {
    // A simulated stream is a separate source, including when its timestamps overlap real history.
    const latest = live.reduce<Tick | undefined>((last, tick) => !last || tick.time > last.time ? tick : last, undefined);
    if (latest?.simulated) return live;
    if (entry.failure) throw new Error(entry.failure);
    if (entry.live === live && entry.merged) return entry.merged;
    const additional = new Map<string, Tick>();
    for (const tick of live) {
      if (tick.simulated) continue;
      if (!isArchivableTrade(tick) || tick.symbol !== symbol) throw new Error("Invalid live execution in archived study input.");
      const previous = entry.ids.get(tick.id) ?? additional.get(tick.id);
      if (previous && !identical(previous, tick)) throw new Error("Archived/live execution ID conflict; no partial study source was returned.");
      if (!previous) additional.set(tick.id, tick);
    }
    if (entry.trades.length + additional.size > MAX_STUDY_ARCHIVE_TRADES) throw new Error("Archived plus live study input exceeds 100,000 executions. Select a shorter archived interval.");
    const suffix = [...additional.values()].sort(order), merged: Tick[] = [];
    let a = 0, b = 0;
    while (a < entry.trades.length || b < suffix.length) {
      if (b >= suffix.length || a < entry.trades.length && order(entry.trades[a], suffix[b]) <= 0) merged.push(entry.trades[a++]);
      else merged.push(suffix[b++]);
    }
    entry.live = live; entry.merged = Object.freeze(merged);
    return entry.merged;
  }
}
export const studyTradeSource = new StudyTradeSource();
export interface StudyArchiveOptions {
  revision?: (symbol: string) => string | number;
  subscribe?: (symbol: string, changed: () => void) => () => void;
  label?: (symbol: string) => string;
  replay?: (context: NativeIndicatorContext) => ReplayStudyInput | undefined;
}
