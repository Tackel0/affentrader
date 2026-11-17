import type { OHLCV, Vela } from "@luxalgo/vela";
import type { ReplayCommand } from "@/types/workspace";

interface ReplayEnvironment { symbol: string; timeframe: string; epoch: number; owner: string; bars: readonly OHLCV[] }
export interface ReplayCommandChart {
  market: Vela["market"];
  historyComplete(): Promise<void>;
  replay: { start(options: { from: number }): Promise<void>; play(intervalMs?: number): unknown; pause(): unknown; step(): unknown; stop(): unknown };
}
export interface ReplayCommandHost {
  pending(): ReplayCommand | null;
  claim(command: ReplayCommand): boolean;
  subscribe(listener: () => void): () => void;
  advance(): number;
  current(revision: number): boolean;
  environment(): ReplayEnvironment;
  present(bar: OHLCV | null): void;
  error(error: unknown): void;
}
/** Consume each published command synchronously, independently of React render batching. */
export function bindReplayCommands(chart: ReplayCommandChart, host: ReplayCommandHost): () => void {
  let disposed = false;
  const consume = () => {
    if (disposed) return;
    const command = host.pending(); if (!command || !host.claim(command)) return;
    const revision = host.advance(), requested = { ...chart.market }, initial = { ...host.environment() };
    const valid = () => !disposed && host.current(revision);
    const sameMarket = () => {
      const now = host.environment();
      return now.epoch === initial.epoch && now.owner === initial.owner && now.symbol === requested.symbol && now.timeframe === requested.timeframe &&
        chart.market.symbol === requested.symbol && chart.market.timeframe === requested.timeframe;
    };
    const run = async () => {
      const { action, from, intervalMs } = command;
      if (action === "start" || action === "seek") {
        await chart.historyComplete();
        if (!valid()) return;
        if (!sameMarket()) throw new Error("The chart changed while loading. Start Replay again on the selected chart.");
        const bars = host.environment().bars, selected = from ?? bars.at(-100)?.time ?? bars[0]?.time;
        if (selected === undefined) throw new Error("Load chart history before starting Replay.");
        await chart.replay.start({ from: selected });
        if (!valid() || !sameMarket()) return;
        host.present(bars.findLast(bar => bar.time <= selected) ?? null);
      } else if (action === "play") chart.replay.play(intervalMs ?? 1000);
      else if (action === "pause") chart.replay.pause();
      else if (action === "step") chart.replay.step();
      else chart.replay.stop();
    };
    void run().catch(error => { if (valid()) host.error(error); });
  };
  const off = host.subscribe(consume);
  consume();
  return () => { disposed = true; off(); };
}
