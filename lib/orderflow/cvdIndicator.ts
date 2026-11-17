import type { InputValue, NativeIndicatorContext, NativeIndicatorDescriptor } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { providerOf } from "@/lib/symbolId";
import { CvdAccumulator } from "./cvdModel";
import { cvdClockKey, cvdInputs, defaultCvd, resolveCvd } from "./cvdSettings";
import type { StudyArchiveOptions } from "./studyTradeSource";
import { cvdSeries, emptyCvdSeries } from "./cvdOutput";

export interface CvdNotice { message: string }
export function cvdDescriptor(read: (symbol: string) => readonly Tick[], subscribe: (symbol: string, changed: (tick: Tick) => void) => () => void, archive: StudyArchiveOptions = {}, barOnly = false): NativeIndicatorDescriptor {
  const resolve = (values: Record<string, unknown>) => {
    const style = resolveCvd(values);
    return barOnly ? { ...style, anchor: "All data" as const, calculation: "Bar delta" as const, plot: "Histogram" as const } : style;
  };
  const output = (bars: Parameters<typeof cvdSeries>[0], style: ReturnType<typeof resolve>) => {
    const series = cvdSeries(bars, style);
    if (barOnly) { series[0].id = "volume-delta"; series[0].title = "Volume Delta"; }
    return series;
  };
  return { type: barOnly ? "af-volume-delta" : "af-cvd", title: barOnly ? "Volume Delta" : "Cumulative Volume Delta", shortTitle: barOnly ? "Vol Δ" : "CVD", overlay: false, paneHint: "new",
    inputsSchema: () => barOnly ? cvdInputs().filter(input => ["mode", "upColor", "downColor"].includes(input.key))
      .map(input => ({ ...input, ...(["upColor", "downColor"].includes(input.key) ? { title: input.key === "upColor" ? "Up color" : "Down color" } : {}) })) : cvdInputs(),
    defaultInputs: () => barOnly ? { mode: "Total", upColor: defaultCvd().upColor, downColor: defaultCvd().downColor } : ({ ...defaultCvd() }), create: () => {
      let context: NativeIndicatorContext | undefined, values: Record<string, InputValue> = {}, accumulator: CvdAccumulator | undefined;
      let key = "", active = false, unsubscribe: (() => void) | undefined, offArchive: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined, generation = 0, failure = "";
      const checked = <T,>(calculate: () => T): T => {
        try { return calculate(); } catch (error) { failure = error instanceof Error ? error.message : "Invalid trade data."; throw error; }
      };
      const detach = () => { generation++; unsubscribe?.(); unsubscribe = undefined; offArchive?.(); offArchive = undefined; if (timer !== undefined) clearTimeout(timer); timer = undefined; };
      const unavailable = (message: string) => {
        if (!context) return;
        let style = resolve({}); try { style = resolve(values); } catch { /* Invalid inputs still clear every prior plotted quantity. */ }
        const empty = emptyCvdSeries(context.bars(), style);
        if (barOnly) { empty[0].id = "volume-delta"; empty[0].title = "Volume Delta"; }
        context.emit({ series: empty }); context.pushData({ message }); context.setStatus("idle");
      };
      const emit = () => {
        if (!context || !active) return;
        try {
          const replay = context.live ? undefined : archive.replay?.(context);
          const style = resolve(values), next = JSON.stringify([context.symbol, context.timeframe, cvdClockKey(style), archive.revision?.(context.symbol) ?? 0, context.live, replay?.through]);
          if (!context.live && !replay) { accumulator = undefined; key = ""; unavailable("Replay: CVD unavailable without a loaded archive and completed-bar clock."); return; }
          if (!accumulator || next !== key) { accumulator = new CvdAccumulator(context.timeframe, style, context.symbol); key = next; failure = ""; checked(() => accumulator!.add(replay ? replay.trades : read(context!.symbol))); }
          if (failure) throw new Error(failure);
          const coverage = accumulator.coverage, bars = checked(() => accumulator!.candles(context!.bars(), style.calculation, style.mode)).map(bar => replay && bar.time >= replay.through ? { ...bar, open: NaN, high: NaN, low: NaN, close: NaN, volume: 0 } : bar);
          context.emit({ series: output(bars, style) });
          const message = coverage.first === null ? ["yahoo", "alpaca"].includes(providerOf(context.symbol)) ? "No classified trade feed for this market." : "Collecting classified trades inside the selected sessions…" :
            `${coverage.source === "simulation" ? "SIMULATED · " : ""}Partial history · ${coverage.trades.toLocaleString("en-US")} trades · from ${new Date(coverage.first).toISOString().slice(0, 19).replace("T", " ")} UTC${coverage.rejected ? ` · ${coverage.rejected} rejected` : ""}`;
          const sourceLabel = replay?.label ?? archive.label?.(context.symbol);
          const averageNotice = style.mode === "Average" ? ` · Average sizes: ${coverage.unknownCounts} observations without print counts; missing/unsafe counts stay gaps${coverage.aggregates ? " · Aggregate-prefix extrema; constituent-print wicks unobserved" : " · Observed print-prefix extrema"}` : "";
          context.pushData({ message: (sourceLabel ? `${replay && coverage.first === null ? "No recorded executions revealed inside these sessions" : message} · ${sourceLabel} · Equal-time path uses sequence/ID order` : message) + averageNotice }); context.setStatus(coverage.first === null || !context.live ? "idle" : "live");
        } catch (error) {
          unavailable(`${barOnly ? "Volume Delta" : "CVD"} unavailable: ${error instanceof Error ? error.message : "Invalid data."}`);
        }
      };
      const attach = () => {
        if (!context || unsubscribe || offArchive) return;
        const token = generation;
        offArchive = archive.subscribe?.(context.symbol, () => { if (active && token === generation) emit(); });
        if (!context.live) return;
        unsubscribe = subscribe(context.symbol, tick => {
          if (!active || token !== generation || tick.symbol !== context?.symbol) return;
          if (!failure) try { accumulator?.add([tick]); } catch (error) { failure = error instanceof Error ? error.message : "Invalid trade data."; }
          if (timer === undefined) timer = setTimeout(() => { timer = undefined; if (token === generation) emit(); }, 50);
        });
      };
      return {
        start(ctx, inputs) { detach(); context = ctx; values = inputs; accumulator = undefined; key = ""; failure = ""; active = true; emit(); attach(); },
        onBars: emit, onViewport() {}, setInputs(inputs) { values = inputs; emit(); },
        suspend() { active = false; detach(); accumulator = undefined; context?.pushData(null); },
        resume() { active = true; emit(); attach(); },
        stop() { active = false; detach(); context?.pushData(null); context = undefined; accumulator = undefined; },
      };
    } };
}
