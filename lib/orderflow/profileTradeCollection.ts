import type { Tick } from "@/types/trading";
import { MAX_PROFILE_TRADES } from "./volumeProfileModel";

const MOBILE_PROFILE_TRADES = 8000;
function isCompactTouchDevice(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 768px) and (pointer: coarse)").matches;
}

/** Indicator-owned executions, independent of the market service's short display tape. */
export class ProfileTradeCollection {
  private trades = new Map<string, Tick>();
  private cached?: readonly Tick[];
  private source?: boolean;
  private last = -Infinity;
  private failure?: Error;
  private readonly capacity: number;
  private readonly rolling: boolean;
  revision = 0;
  rejected = 0;
  epoch = 0;
  constructor(capacity?: number) {
    const mobileDefault = capacity === undefined && isCompactTouchDevice();
    this.capacity = capacity ?? (mobileDefault ? MOBILE_PROFILE_TRADES : MAX_PROFILE_TRADES);
    this.rolling = mobileDefault;
  }
  add(input: readonly Tick[]): void {
    if (this.failure) throw this.failure;
    for (const tick of [...input].sort((a, b) => a.time - b.time)) {
      if (typeof tick.id !== "string" || !tick.id || !Number.isFinite(tick.time) || Math.abs(tick.time) >= 8640000000000000 ||
        !Number.isFinite(tick.price) || tick.price <= 0 || !Number.isFinite(tick.quantity) || tick.quantity <= 0 ||
        tick.side !== "buy" && tick.side !== "sell" || typeof tick.simulated !== "boolean") { this.rejected++; this.revision++; continue; }
      if (this.source !== undefined && this.source !== tick.simulated) {
        if (tick.time < this.last) { this.rejected++; this.revision++; continue; }
        this.trades.clear(); this.cached = undefined; this.rejected = 0; this.revision++; this.epoch++; this.last = -Infinity;
      }
      this.source = tick.simulated;
      if (this.trades.has(tick.id)) continue;
      if (this.trades.size >= this.capacity) {
        if (this.rolling) {
          const oldest = this.trades.keys().next().value;
          if (oldest !== undefined) this.trades.delete(oldest);
        } else {
          this.failure = new Error("SVP collection reached 100,000 executions. Remove and re-add the study to restart collection; no observed session volume was truncated.");
          throw this.failure;
        }
      }
      this.trades.set(tick.id, { ...tick }); this.last = Math.max(this.last, tick.time);
      this.cached = undefined; this.revision++;
    }
  }
  snapshot(): readonly Tick[] {
    if (this.failure) throw this.failure;
    return this.cached ??= [...this.trades.values()];
  }
  get size() { return this.trades.size; }
}
