import type { InputValue, NativeIndicatorContext, NativeIndicatorDescriptor } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { ProfileTradeCollection } from "./profileTradeCollection";
import type { StudyArchiveOptions } from "./studyTradeSource";
import type { VolumeProfileChannel } from "./volumeProfileRenderer";
import { defaultRollingProfile, resolveRollingProfile, rollingProfileInputs, RollingProfileCache } from "./rollingProfile";

export function rollingProfileDescriptor(read: (symbol: string) => readonly Tick[], subscribe: (symbol: string, next: (tick: Tick) => void) => () => void,
  sourceEpoch: (symbol: string) => number = () => 0, archive: StudyArchiveOptions = {}): NativeIndicatorDescriptor {
  return { type: "af-rolling-profile", title: "Rolling Volume Profile", shortTitle: "Rolling VP", overlay: true, paneHint: "price", multiInstance: true,
    inputsSchema: rollingProfileInputs, defaultInputs: () => ({ ...defaultRollingProfile() }), create: () => {
      let context: NativeIndicatorContext | undefined, inputs: Record<string, InputValue> = {}, active = false, published = false, key = "", failure = "", generation = 0;
      let collection = new ProfileTradeCollection(), model = new RollingProfileCache(), previous: readonly Tick[] | undefined;
      let off: (() => void) | undefined, offArchive: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
      const channel: VolumeProfileChannel = {};
      const compute = () => {
        if (!active || !context) return;
        let style = defaultRollingProfile();
        try {
          const epoch = sourceEpoch(context.symbol), revision = archive.revision?.(context.symbol) ?? 0, replay = context.live ? undefined : archive.replay?.(context);
          channel.context = { id: context.id, symbol: context.symbol, timeframe: context.timeframe, epoch, revision, kind: "rolling", live: context.live, replayThrough: replay?.through };
          style = resolveRollingProfile(inputs);
          if (!context.live && !replay) throw new Error("Replay needs a loaded classified archive and completed-bar boundary.");
          const next = JSON.stringify(channel.context);
          if (next !== key) { key = next; collection = new ProfileTradeCollection(); model = new RollingProfileCache(); previous = undefined; failure = ""; }
          if (failure) throw new Error(failure);
          const trades = replay?.trades ?? read(context.symbol);
          if (trades !== previous) {
            try { collection.add(trades.filter(t => t.symbol === context!.symbol)); previous = trades; }
            catch (error) { failure = error instanceof Error ? error.message : "Invalid executions."; throw error; }
          }
          const result = model.read(context.bars(), collection.snapshot(), context.timeframe, style, context.symbol, replay?.through);
          const sourceLabel = replay?.label ?? archive.label?.(context.symbol);
          const summary = `${result.model.source === "simulation" ? "SIMULATED · " : ""}Partial classified rolling window · ${result.bars}/${style.bars} loaded bars · ${result.model.retained} observations${collection.rejected ? ` · ${collection.rejected} rejected` : ""}${sourceLabel ? ` · ${sourceLabel}` : ""}`;
          channel.current = { style, model: result.model, sourceLabel, kind: "rolling", maximumWidth: Number.MAX_VALUE,
            summary, ...(!result.model.retained ? { message: `${summary} · No observed executions inside the newest bars; missing history is unknown.` } : {}) };
          context.setStatus(context.live && result.model.retained ? "live" : "idle");
        } catch (error) {
          channel.current = { style, kind: "rolling", message: `Rolling Volume Profile unavailable: ${error instanceof Error ? error.message : "Invalid range."}` }; context.setStatus("idle");
        }
        if (!published) { context.emit({}); context.pushData(channel); published = true; } else channel.repaint?.();
      };
      const detach = () => { generation++; off?.(); off = undefined; offArchive?.(); offArchive = undefined; if (timer !== undefined) clearTimeout(timer); timer = undefined; };
      const attach = () => {
        if (!context || off || offArchive) return; const token = generation;
        offArchive = archive.subscribe?.(context.symbol, () => { if (active && token === generation) compute(); });
        if (context.live) off = subscribe(context.symbol, tick => {
          if (!active || token !== generation || tick.symbol !== context?.symbol) return;
          if (!failure) try { collection.add([tick]); } catch (error) { failure = error instanceof Error ? error.message : "Invalid executions."; }
          if (timer === undefined) timer = setTimeout(() => { timer = undefined; if (token === generation) compute(); }, 50);
        });
      };
      return {
        start(ctx, values) { detach(); context = ctx; inputs = values; active = true; published = false; key = ""; failure = ""; compute(); attach(); },
        onBars: compute, onViewport() {}, setInputs(values) { inputs = values; compute(); },
        suspend() { active = false; detach(); key = ""; previous = undefined; collection = new ProfileTradeCollection(); channel.current = undefined; context?.pushData(null); published = false; },
        resume() { active = true; compute(); attach(); },
        stop() { active = false; detach(); channel.current = undefined; channel.repaint = undefined; context?.pushData(null); context = undefined; previous = undefined; collection = new ProfileTradeCollection(); },
      };
    } };
}
