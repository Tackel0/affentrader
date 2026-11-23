import type { OHLCV } from "@luxalgo/vela";
import type { FixedProfileOptions, FixedProfileResult } from "./fixedProfileModel";
import type { Tick } from "@/types/trading";

export interface ProfileExecutionInput { trades: Tick[]; timeframe: string }
export interface ProfileRequest { id: number; owner: number; bars: OHLCV[]; options: FixedProfileOptions; execution?: ProfileExecutionInput }
export interface ProfileResponse { id: number; result?: FixedProfileResult | null; error?: string }
interface Job { request: ProfileRequest; complete: (response: ProfileResponse) => void }
/** One shared CPU worker; keep only the newest queued snapshot per drawing. */
export class ProfileJobs {
  private worker: Worker | null = null;
  private active: Job | null = null;
  private queued = new Map<number, Job>();
  private sequence = 0;
  private idleTimer?: ReturnType<typeof setTimeout>;
  constructor(private readonly createWorker: () => Worker) {}
  submit(owner: number, bars: OHLCV[], options: FixedProfileOptions, complete: Job["complete"], execution?: ProfileExecutionInput): void {
    const previous = this.queued.get(owner);
    this.queued.set(owner, { request: { id: ++this.sequence, owner, bars, options, ...(execution ? { execution } : {}) }, complete });
    if (previous) previous.complete({ id: previous.request.id, error: "Profile calculation superseded." });
    while (this.queued.size > 64 || [...this.queued.values()].reduce((sum, job) => sum + (job.request.execution?.trades.length ?? 0), 0) > 250000) {
      const oldest = this.queued.keys().next().value!;
      const dropped = this.queued.get(oldest)!; this.queued.delete(oldest);
      dropped.complete({ id: dropped.request.id, error: "Too many queued profiles; refresh this drawing." });
    }
    this.pump();
  }
  private clearIdleCleanup(): void {
    if (this.idleTimer !== undefined) { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
  }
  private scheduleIdleCleanup(): void {
    this.clearIdleCleanup();
    if (!this.worker || this.active || this.queued.size) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (!this.active && !this.queued.size && this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
    }, 15_000);
  }
  private pump(): void {
    if (this.active || !this.queued.size) {
      if (!this.active && !this.queued.size) this.scheduleIdleCleanup();
      return;
    }
    this.clearIdleCleanup();
    const owner = this.queued.keys().next().value!;
    const job = this.queued.get(owner)!; this.queued.delete(owner); this.active = job;
    try {
      if (!this.worker) {
        this.worker = this.createWorker();
        this.worker.onmessage = event => {
          const response = event.data as ProfileResponse;
          if (response.id !== this.active?.request.id) return;
          const finished = this.active; this.active = null;
          finished.complete(response); this.pump();
        };
        this.worker.onerror = () => this.fail("Background profile worker failed. Reload to retry.");
        this.worker.onmessageerror = () => this.fail("Background profile response could not be read.");
      }
      this.worker.postMessage(job.request);
    } catch (error) { this.fail(error instanceof Error ? error.message : "Background profile worker unavailable."); }
  }
  private fail(message: string): void {
    this.clearIdleCleanup();
    this.worker?.terminate(); this.worker = null;
    const jobs = [...(this.active ? [this.active] : []), ...this.queued.values()];
    this.active = null; this.queued.clear();
    for (const job of jobs) job.complete({ id: job.request.id, error: message });
  }
}
export const profileJobs = new ProfileJobs(() => new Worker("/workers/fixed-profile.js"));
export const profileFields = ["time", "open", "high", "low", "close", "volume"] as const;
export function sameProfileBars(a: readonly OHLCV[], b: readonly OHLCV[]): boolean {
  return a.length === b.length && a.every((bar, i) => profileFields.every(field => Object.is(bar[field], b[i][field])));
}
export function copyProfileBars(bars: readonly OHLCV[]): OHLCV[] {
  return bars.map(({ time, open, high, low, close, volume }) => ({ time, open, high, low, close, volume }));
}
