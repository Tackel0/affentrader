import type { PineAlertSnapshot, PineFrame, PineSeriesLoader, PineAlertResult } from "@/types/pineAlerts";
import { nextBucket } from "@/lib/market/intervals";
import { PineSandbox } from "./pineSandbox";
/** Finalizes an observed bar before evaluating its successor, including on a polled server. */
export class PineSession {
  private sandbox: PineSandbox;
  private last?: number;
  private simulated?: boolean;
  private snapshot: PineAlertSnapshot;
  constructor(snapshot: PineAlertSnapshot, private readonly seed = 0x7f4a7c15) { this.snapshot = structuredClone(snapshot); this.sandbox = new PineSandbox(this.snapshot, 5000, seed); }
  async observe(frame: PineFrame, loader?: PineSeriesLoader): Promise<PineAlertResult> {
    const simulated = Boolean(frame.series.simulated);
    if (this.simulated !== undefined && this.simulated !== simulated) { this.sandbox.dispose(); this.sandbox = new PineSandbox(this.snapshot, 5000, this.seed); this.last = undefined; }
    this.simulated = simulated;
    const signals: PineAlertResult["signals"] = [];
    const newest = frame.series.bars.at(-1)?.time;
    if (newest === undefined) throw new Error("No Pine alert history available.");
    if (frame.closedBar === undefined && this.last !== undefined && newest > this.last && nextBucket(frame.series.timeframe, this.last) <= frame.now && frame.series.bars.some(bar => bar.time === this.last)) {
      signals.push(...(await this.sandbox.run({ ...frame, closedBar: this.last }, loader)).signals);
    }
    const result = await this.sandbox.run(frame, loader);
    this.last = Math.max(this.last ?? 0, frame.closedBar ?? newest);
    return { ...result, signals: [...signals, ...result.signals] };
  }
  dispose() { this.sandbox.dispose(); }
}
