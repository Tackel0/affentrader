import type { InputValue, NativeIndicatorContext, NativeIndicatorDescriptor } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import type { StudyArchiveOptions } from "./studyTradeSource";
import { TradeCountAccumulator, countIds, countInputs, countSeries, countTitles, defaultCount, emptyCountSeries, resolveCount, type CountKind } from "./tradeCount";

export function tradeCountDescriptor(kind: CountKind, read: (symbol: string) => readonly Tick[],
  subscribe: (symbol: string, changed: (tick: Tick) => void) => () => void, archive: StudyArchiveOptions = {}): NativeIndicatorDescriptor {
  return { type: countIds[kind], title: countTitles[kind], shortTitle: kind === "total" ? "Trades" : kind === "delta" ? "Count Δ" : "CTCD", overlay: false,
    paneHint: "new", multiInstance: true, inputsSchema: () => countInputs(kind), defaultInputs: () => {
      const all = defaultCount(); return Object.fromEntries(countInputs(kind).map(input => [input.key, all[input.key as keyof typeof all]]));
    }, create: () => {
      let context: NativeIndicatorContext | undefined, inputs: Record<string, InputValue> = {}, active = false, key = "", failure = "";
      let model: TradeCountAccumulator | undefined, off: (() => void) | undefined, offArchive: (() => void) | undefined, generation = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const detach = () => { generation++; off?.(); off = undefined; offArchive?.(); offArchive = undefined;
        if (timer !== undefined) clearTimeout(timer); timer = undefined; };
      const compute = () => {
        if (!active || !context) return;
        let style = defaultCount();
        try {
          style = resolveCount(inputs);
          const replay = context.live ? undefined : archive.replay?.(context);
          if (!context.live && !replay) { model = undefined; key = ""; throw new Error("Replay requires a loaded count-carrying archive and a completed-bar boundary."); }
          const anchor = kind === "cumulative" ? style.anchor : "All data";
          const next = JSON.stringify([context.symbol, context.timeframe, anchor, context.live, replay?.through, archive.revision?.(context.symbol) ?? 0]);
          if (!model || key !== next) {
            key = next; failure = ""; model = new TradeCountAccumulator(context.symbol, context.timeframe, anchor);
            try { model.add(replay?.trades ?? read(context.symbol)); } catch (error) { failure = error instanceof Error ? error.message : "Invalid counts."; throw error; }
          }
          if (failure) throw new Error(failure);
          const bars = model.candles(context.bars(), kind).map(bar => replay && bar.time >= replay.through ? { ...bar, open: NaN, high: NaN, low: NaN, close: NaN, volume: 0 } : bar);
          context.emit({ series: countSeries(bars, kind, style) });
          const coverage = model.coverage, label = replay?.label ?? archive.label?.(context.symbol);
          context.pushData({ message: `${coverage.simulated ? "SIMULATED · " : ""}Partial coverage · ${coverage.observations} execution observations · ${coverage.unknown} without print counts; missing buckets remain gaps${label ? ` · ${label}` : ""} · Equal-time count path uses sequence/ID order` });
          context.setStatus(context.live && coverage.observations ? "live" : "idle");
        } catch (error) {
          context.emit({ series: emptyCountSeries(context.bars(), kind, style) });
          context.pushData({ message: `${countTitles[kind]} unavailable: ${error instanceof Error ? error.message : "Invalid count data."}` }); context.setStatus("idle");
        }
      };
      const attach = () => {
        if (!context || off || offArchive) return;
        const token = generation;
        offArchive = archive.subscribe?.(context.symbol, () => { if (active && token === generation) compute(); });
        if (context.live) off = subscribe(context.symbol, tick => {
          if (!active || token !== generation || tick.symbol !== context?.symbol) return;
          if (!failure) try { model?.add([tick]); } catch (error) { failure = error instanceof Error ? error.message : "Invalid count data."; }
          if (timer === undefined) timer = setTimeout(() => { timer = undefined; if (token === generation) compute(); }, 50);
        });
      };
      return {
        start(ctx, values) { detach(); context = ctx; inputs = values; active = true; model = undefined; key = ""; failure = ""; compute(); attach(); },
        onBars: compute, onViewport() {}, setInputs(values) { inputs = values; compute(); },
        suspend() { active = false; detach(); model = undefined; context?.pushData(null); },
        resume() { active = true; compute(); attach(); },
        stop() { active = false; detach(); model = undefined; context?.pushData(null); context = undefined; },
      };
    } };
}
