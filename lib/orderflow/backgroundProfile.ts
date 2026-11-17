import type { OHLCV } from "@luxalgo/vela";
import type { FixedProfileOptions, FixedProfileResult } from "./fixedProfileModel";
import { copyProfileBars, profileJobs, sameProfileBars, type ProfileJobs, type ProfileExecutionInput } from "./profileJobs";
import { copyExecutions, sameExecutions } from "./executionRangeProfile";

let ownerSequence = 0;
interface Snapshot { bars: OHLCV[]; signature: string; result: FixedProfileResult | null; error?: string; pending: boolean; execution?: ProfileExecutionInput }
const sameExecutionInput = (a?: ProfileExecutionInput, b?: ProfileExecutionInput) => a === undefined && b === undefined || !!a && !!b && a.timeframe === b.timeframe && sameExecutions(a.trades, b.trades);
/** Never expose the previous range while a new snapshot is pending. */
export class BackgroundProfile {
  private readonly owner = ++ownerSequence;
  private snapshot?: Snapshot;
  constructor(private readonly jobs: Pick<ProfileJobs, "submit"> = profileJobs) {}
  read(bars: readonly OHLCV[], options: FixedProfileOptions, context: string,
    current: () => { bars: readonly OHLCV[]; options: FixedProfileOptions; context: string; execution?: ProfileExecutionInput } | null,
    repaint: () => void, execution?: ProfileExecutionInput): { result: FixedProfileResult | null; notice?: string } {
    const signature = JSON.stringify([options, context]);
    if (!this.snapshot || this.snapshot.signature !== signature || !sameProfileBars(this.snapshot.bars, bars) || !sameExecutionInput(this.snapshot.execution, execution)) {
      const snapshot: Snapshot = { bars: copyProfileBars(bars), signature, result: null, pending: true, ...(execution ? { execution: { timeframe: execution.timeframe, trades: copyExecutions(execution.trades) } } : {}) };
      this.snapshot = snapshot;
      this.jobs.submit(this.owner, snapshot.bars, options, response => {
        if (this.snapshot !== snapshot) return;
        let now: ReturnType<typeof current>; try { now = current(); } catch { now = null; }
        if (!now || JSON.stringify([now.options, now.context]) !== signature || !sameProfileBars(snapshot.bars, now.bars) || !sameExecutionInput(snapshot.execution, now.execution)) {
          this.snapshot = undefined; return;
        }
        snapshot.pending = false; snapshot.result = response.result ?? null; snapshot.error = response.error;
        repaint();
      }, snapshot.execution);
    }
    return { result: this.snapshot.result, notice: this.snapshot.pending ? `Calculating ${execution ? "classified" : "developing"} profile · ${execution ? `${execution.trades.length} observations` : `${bars.length} loaded bars`}…` : this.snapshot.error };
  }
}
