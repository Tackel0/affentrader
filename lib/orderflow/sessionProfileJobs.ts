import type { Tick } from "@/types/trading";
import type { VolumeProfilePreferences } from "./volumeProfileSettings";
import type { VolumeProfileModel } from "./volumeProfileModel";
import type { MarketSessionCalendar } from "@/lib/market/sessionWindows";

export interface SessionProfileRequest { id: number; values: Float64Array; simulated: boolean; style: VolumeProfilePreferences; symbol: string; calendar?: MarketSessionCalendar; timeframe?: string }
export interface SessionProfileResponse { id: number; model?: VolumeProfileModel; error?: string }
export interface SessionProfileExecutor {
  submit(owner: number, trades: readonly Tick[], style: VolumeProfilePreferences, symbol: string, complete: (response: SessionProfileResponse) => void, calendar?: MarketSessionCalendar, timeframe?: string): void;
  cancel(owner: number): void;
}
interface Job { id: number; owner: number; trades: readonly Tick[]; style: VolumeProfilePreferences; symbol: string; complete?: (response: SessionProfileResponse) => void; calendar?: MarketSessionCalendar; timeframe?: string }

/** IDs have already been deduplicated by the indicator-owned collector. Transfer numeric fields once. */
export function packSessionTrades(trades: readonly Tick[]): Float64Array {
  const values = new Float64Array(trades.length * 4);
  trades.forEach((trade, i) => { const offset = i * 4; values[offset] = trade.time; values[offset + 1] = trade.price;
    values[offset + 2] = trade.quantity; values[offset + 3] = trade.side === "buy" ? 1 : 0; });
  return values;
}
export function unpackSessionTrades(request: SessionProfileRequest): Tick[] {
  if (request.values.length % 4 || request.values.length > 400000) throw new Error("Invalid session profile execution snapshot.");
  return Array.from({ length: request.values.length / 4 }, (_, i) => ({ id: String(i), symbol: request.symbol,
    time: request.values[i * 4], price: request.values[i * 4 + 1], quantity: request.values[i * 4 + 2],
    side: request.values[i * 4 + 3] === 1 ? "buy" : "sell", simulated: request.simulated }));
}

/** One shared worker, one running job and at most one queued snapshot per study. */
export class SessionProfileJobs implements SessionProfileExecutor {
  private worker: Worker | null = null;
  private active: Job | null = null;
  private queued = new Map<number, Job>();
  private sequence = 0;
  private timeout?: ReturnType<typeof setTimeout>;
  constructor(private readonly createWorker: () => Worker) {}
  submit(owner: number, trades: readonly Tick[], style: VolumeProfilePreferences, symbol: string, complete: (response: SessionProfileResponse) => void, calendar?: MarketSessionCalendar, timeframe?: string): void {
    const old = this.queued.get(owner);
    const snapshot = calendar ? { ...calendar, regular: calendar.regular.map(w => [w[0],w[1]] as const), extended: calendar.extended.map(w => [w[0],w[1]] as const) } : undefined;
    this.queued.set(owner, { id: ++this.sequence, owner, trades, style: { ...style }, symbol, complete, calendar: snapshot, timeframe });
    old?.complete?.({ id: old.id, error: "Session profile calculation superseded." });
    while (this.queued.size > 32) {
      const first = this.queued.keys().next().value!, dropped = this.queued.get(first)!;
      this.queued.delete(first); dropped.complete?.({ id: dropped.id, error: "Too many queued session profiles. Hide another study and retry." });
    }
    this.pump();
  }
  cancel(owner: number): void {
    this.queued.delete(owner);
    if (this.active?.owner === owner) this.active.complete = undefined;
  }
  private pump(): void {
    if (this.active || !this.queued.size) return;
    const owner = this.queued.keys().next().value!, job = this.queued.get(owner)!;
    this.queued.delete(owner); this.active = job;
    try {
      if (!this.worker) {
        const worker = this.createWorker(); this.worker = worker;
        worker.onmessage = event => {
          if (this.worker !== worker) return;
          const response = event.data as SessionProfileResponse;
          if (response.id !== this.active?.id) return;
          const finished = this.active; this.active = null; clearTimeout(this.timeout); this.timeout = undefined;
          finished.complete?.(response); this.pump();
        };
        worker.onerror = () => { if (this.worker === worker) this.fail("Session profile worker failed. Hide and show the study to retry."); };
        worker.onmessageerror = () => { if (this.worker === worker) this.fail("Session profile worker returned an unreadable response."); };
      }
      const values = packSessionTrades(job.trades);
      const request: SessionProfileRequest = { id: job.id, values, simulated: job.trades[0]?.simulated ?? false, style: job.style, symbol: job.symbol, calendar: job.calendar, timeframe: job.timeframe };
      this.timeout = setTimeout(() => this.fail("Session profile calculation exceeded 30 seconds. Hide and show the study to retry."), 30000);
      this.worker.postMessage(request, [values.buffer]);
    } catch (error) { this.fail(error instanceof Error ? error.message : "Session profile worker unavailable."); }
  }
  private fail(message: string): void {
    this.worker?.terminate(); this.worker = null; clearTimeout(this.timeout); this.timeout = undefined;
    const jobs = [...(this.active ? [this.active] : []), ...this.queued.values()]; this.active = null; this.queued.clear();
    for (const job of jobs) job.complete?.({ id: job.id, error: message });
  }
}
export const sessionProfileJobs = new SessionProfileJobs(() => new Worker("/workers/session-profile.js"));
