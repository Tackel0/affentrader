import type { Tick, OHLCV } from "@/types/trading";
import type { TpoSession } from "./tpoModel";
import type { TpoPreferences } from "./tpoSettings";
import { TpoMetricCollection, type TpoMetrics } from "./tpoMetrics";
interface Input { symbol: string; timeframe: string; epoch: string; replay: boolean; through?: number | null; sessions: readonly TpoSession[]; bars: readonly Pick<OHLCV, "time">[]; style: TpoPreferences }
interface Dependencies {
  trades(symbol: string): readonly Tick[];
  replay(symbol: string, timeframe: string, through: number | null): { trades: readonly Tick[] } | undefined;
  revision(symbol: string): string | number;
  subscribe(symbol: string, changed: () => void): () => void;
  ticks(receive: (tick: Tick) => void): () => void;
}
/** Independently owned native/overlay source. Live ticks cannot leak into a
 * Replay view; archive replacement and feed changes discard retained totals. */
export class TpoExecutionSource {
  private key?: string;
  private collection?: TpoMetricCollection;
  private off?: () => void;
  private offArchive?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private seeded = false;
  constructor(private deps: Dependencies, private repaint: () => void) {}
  reset() {
    this.key = undefined; this.collection = undefined;
    this.seeded = false;
    this.off?.(); this.offArchive?.(); this.off = this.offArchive = undefined;
    clearTimeout(this.timer); this.timer = undefined;
  }
  read(input: Input): TpoMetrics | undefined {
    if (!input.style.colorBy || input.style.colorBy === "Time") { this.reset(); return; }
    try {
      const key = JSON.stringify([input.symbol, input.timeframe, input.epoch, this.deps.revision(input.symbol), input.replay, input.replay ? input.through : null]);
      if (this.key !== key) {
        this.reset(); this.key = key; this.collection = new TpoMetricCollection(input.symbol);
        this.offArchive = this.deps.subscribe(input.symbol, () => { this.reset(); this.repaint(); });
        if (!input.replay) this.off = this.deps.ticks(tick => {
          if (this.key !== key || tick.symbol !== input.symbol) return;
          this.collection?.add([tick]);
          if (this.timer === undefined) this.timer = setTimeout(() => { this.timer = undefined; if (this.key === key) this.repaint(); }, 50);
        });
      }
      const replay = input.replay ? this.deps.replay(input.symbol, input.timeframe, input.through ?? null) : undefined;
      if (input.replay && !replay) return { sessions: new Map(), message: "Time coloring: Replay has no revealed archived classified executions." };
      if (!this.seeded) { this.collection!.add(replay ? replay.trades : this.deps.trades(input.symbol)); this.seeded = true; }
      return this.collection!.read(input.sessions, input.style, input.bars, input.timeframe, input.replay ? input.through ?? -Infinity : Infinity);
    } catch (error) { return { sessions: new Map(), message: `Time coloring: ${error instanceof Error ? error.message : "Invalid execution source."}` }; }
  }
}
