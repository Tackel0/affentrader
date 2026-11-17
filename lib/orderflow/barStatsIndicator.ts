import type { InputValue, NativeIndicatorContext, NativeIndicatorDescriptor } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import type { StudyArchiveOptions } from "./studyTradeSource";
import { activeBarStats, BarStatsAccumulator, barStatLabels, barStatsInputs, defaultBarStats, resolveBarStats, type BarStatistics, type BarStatsSettings } from "./barStats";

export interface BarStatsChannel {
  stats?: readonly BarStatistics[]; style?: BarStatsSettings; message: string; repaint?: () => void;
  identity?: { symbol: string; timeframe: string; live: boolean; through: number | null; revision: string | number };
}
export function barStatsDescriptor(read: (symbol: string) => readonly Tick[], subscribe: (symbol: string, changed: (tick: Tick) => void) => () => void,
  archive: StudyArchiveOptions = {}): NativeIndicatorDescriptor {
  return { type: "af-bar-stats", title: "Bar Stats", shortTitle: "Bar Stats", overlay: false, paneHint: "new", multiInstance: true,
    inputsSchema: barStatsInputs, defaultInputs: () => ({ ...defaultBarStats() }), create: () => {
      let context: NativeIndicatorContext | undefined, inputs: Record<string, InputValue> = {}, active = false, published = false;
      let model: BarStatsAccumulator | undefined, key = "", failure = "", generation = 0;
      let off: (() => void) | undefined, offArchive: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
      const channel: BarStatsChannel = { message: "Waiting for classified trades." };
      const publish = () => { if (!context) return; if (!published) { published = true; context.pushData(channel); } else channel.repaint?.(); };
      const compute = () => {
        if (!active || !context) return;
        try {
          const style = resolveBarStats(inputs), replay = context.live ? undefined : archive.replay?.(context), revision = archive.revision?.(context.symbol) ?? 0;
          channel.identity = { symbol: context.symbol, timeframe: context.timeframe, live: context.live, through: replay?.through ?? null, revision };
          if (!context.live && !replay) { key = ""; model = undefined; throw new Error("Replay needs an explicitly loaded classified archive and completed-bar boundary."); }
          const next = JSON.stringify([context.symbol, context.timeframe, context.live, replay?.through, revision]);
          if (!model || next !== key) {
            key = next; failure = ""; model = new BarStatsAccumulator(context.symbol, context.timeframe);
            try { model.add(replay?.trades ?? read(context.symbol)); } catch (error) { failure = error instanceof Error ? error.message : "Invalid executions."; throw error; }
          }
          if (failure) throw new Error(failure);
          const stats = model.read();
          channel.stats = replay ? stats.filter(stat => stat.time < replay.through) : stats;
          channel.style = style;
          const rows = activeBarStats(style);
          context.emit({ paneAxis: rows.length ? { bands: rows.map((row, i) => ({ frac: (i + .5) / rows.length, label: barStatLabels[row] })) } : "none" });
          const coverage = model.coverage, label = replay?.label ?? archive.label?.(context.symbol);
          channel.message = `${coverage.simulated ? "SIMULATED · " : ""}Partial coverage · ${coverage.observations} execution observations · ${coverage.unknownCounts} without print counts${label ? ` · ${label}` : ""}`;
          if (!rows.length) channel.message += " · All statistic rows are hidden.";
          if (!coverage.observations) channel.message += " · Waiting for classified trades; candle volume cannot supply buy/sell statistics.";
          context.setStatus(context.live && coverage.observations ? "live" : "idle");
        } catch (error) {
          channel.stats = undefined; channel.style = undefined;
          channel.message = `Bar Stats unavailable: ${error instanceof Error ? error.message : "Invalid statistics."}`;
          context.emit({ paneAxis: "none" }); context.setStatus("idle");
        }
        publish();
      };
      const detach = () => { generation++; off?.(); off = undefined; offArchive?.(); offArchive = undefined;
        if (timer !== undefined) clearTimeout(timer); timer = undefined; };
      const attach = () => {
        if (!context || off || offArchive) return;
        const token = generation;
        offArchive = archive.subscribe?.(context.symbol, () => { if (active && token === generation) compute(); });
        if (context.live) off = subscribe(context.symbol, tick => {
          if (!active || token !== generation || tick.symbol !== context?.symbol) return;
          if (!failure) try { model?.add([tick]); } catch (error) { failure = error instanceof Error ? error.message : "Invalid executions."; }
          if (timer === undefined) timer = setTimeout(() => { timer = undefined; if (token === generation) compute(); }, 50);
        });
      };
      return {
        start(ctx, values) { detach(); context = ctx; inputs = values; model = undefined; key = ""; failure = ""; published = false; active = true; compute(); attach(); },
        onBars: compute, onViewport() {}, setInputs(values) { inputs = values; compute(); },
        suspend() { active = false; detach(); model = undefined; channel.stats = undefined; channel.style = undefined; context?.pushData(null); published = false; },
        resume() { active = true; compute(); attach(); },
        stop() { active = false; detach(); model = undefined; channel.stats = undefined; channel.style = undefined; channel.repaint = undefined; context?.pushData(null); context = undefined; published = false; },
      };
    } };
}
