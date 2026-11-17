import type { InputValue, NativeIndicatorContext, NativeIndicatorDescriptor } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import type { StudyArchiveOptions } from "./studyTradeSource";
import { FootprintHistory } from "./footprintHistory";
import { bubbleInputs, defaultBubbles, resolveBubbles, type BubbleSettings } from "./volumeBubbles";
import { priceGridTick, type PriceGridLoader, type PriceGridMetadata } from "@/lib/market/priceGridMetadata";
import { priceStep } from "./math";

export interface BubblesChannel {
  history?: FootprintHistory; style?: BubbleSettings; message: string; repaint?: () => void;
  priceTick?: number; priceTickSource?: string;
  identity?: { symbol: string; timeframe: string; live: boolean; through: number | null; revision: string | number };
}
export function bubblesDescriptor(read: (symbol: string) => readonly Tick[], subscribe: (symbol: string, changed: (tick: Tick) => void) => () => void,
  archive: StudyArchiveOptions = {}, loadGrid?: PriceGridLoader): NativeIndicatorDescriptor {
  return { type: "af-volume-bubbles", title: "Volume Bubbles", shortTitle: "Bubbles", overlay: true, paneHint: "price", multiInstance: true,
    inputsSchema: bubbleInputs, defaultInputs: () => ({ ...defaultBubbles() }), create: () => {
      let context: NativeIndicatorContext | undefined, values: Record<string, InputValue> = {}, active = false, published = false;
      let key = "", generation = 0, failure = "", off: (() => void) | undefined, offArchive: (() => void) | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let grid: PriceGridMetadata | undefined, gridPending = false, gridError = "", gridAt = 0;
      const channel: BubblesChannel = { message: "Waiting for classified executions." };
      const publish = () => { if (!context) return; if (!published) { published = true; context.pushData(channel); } else channel.repaint?.(); };
      const compute = () => {
        if (!active || !context) return;
        try {
          const style = resolveBubbles(values), replay = context.live ? undefined : archive.replay?.(context);
          const revision = archive.revision?.(context.symbol) ?? 0;
          channel.identity = { symbol: context.symbol, timeframe: context.timeframe, live: context.live, through: replay?.through ?? null, revision };
          if (!context.live && !replay) throw new Error("Replay needs a loaded classified execution archive and a completed-bar clock.");
          const nextKey = JSON.stringify([context.symbol, context.timeframe, context.live, replay?.through, revision]);
          if (key !== nextKey) {
            key = nextKey; failure = "";
            channel.history = new FootprintHistory(context.timeframe);
            channel.history.add(replay?.trades ?? read(context.symbol));
          }
          if (failure) throw new Error(failure);
          if (!channel.history) throw new Error(failure || "Execution history is unavailable.");
          channel.style = style;
          const coverage = channel.history.coverage;
          channel.priceTick = undefined; channel.priceTickSource = undefined;
          if (style.tickSize > 0) { channel.priceTick = style.tickSize; channel.priceTickSource = "Explicit price tick override"; }
          else if (coverage.simulated) {
            const price = context.bars().at(-1)?.close;
            if (price && price > 0) { channel.priceTick = priceStep(price); channel.priceTickSource = "SIMULATED display precision estimate"; }
          } else {
            if (loadGrid && !gridPending && Date.now() >= gridAt) {
              gridPending = true; const token = generation, symbol = context.symbol;
              void Promise.resolve().then(() => loadGrid(symbol)).then(value => {
                if (!active || !context || token !== generation || context.symbol !== symbol) return;
                if (value.symbol !== symbol) throw new Error("Price-grid metadata belongs to another market.");
                grid = value; gridError = ""; gridPending = false; gridAt = Date.now() + 300000; compute();
              }).catch(error => {
                if (!active || !context || token !== generation || context.symbol !== symbol) return;
                grid = undefined; gridPending = false; gridAt = Date.now() + 30000;
                gridError = error instanceof Error ? error.message : "Price-grid metadata is unavailable."; compute();
              });
            }
            if (grid) try { channel.priceTick = priceGridTick(grid, context.bars().at(-1)?.close); channel.priceTickSource = grid.source; }
            catch (error) { gridError = error instanceof Error ? error.message : "Waiting for chart price."; }
          }
          channel.message = `${coverage.simulated ? "SIMULATED · " : ""}Partial coverage · ${coverage.trades} collected executions${coverage.dropped ? ` · ${coverage.dropped} older executions evicted` : ""}${coverage.rejected ? ` · ${coverage.rejected} rejected` : ""}`;
          channel.message += channel.priceTick ? ` · Price tick ${channel.priceTick} · ${channel.priceTickSource}`
            : ` · ${gridError ? `Price grid unavailable: ${gridError}` : "Waiting for market price-grid metadata"}. Set a price tick override if needed.`;
          if (!context.live && !style.tickSize) channel.message += " · Current venue precision; historical rule changes are not reconstructed";
          const label = replay?.label ?? archive.label?.(context.symbol); if (label) channel.message += ` · ${label}`;
          if (!coverage.trades) channel.message += " · Waiting for classified executions; candles cannot supply buy/sell volume.";
          context.setStatus(gridPending && !channel.priceTick ? "loading" : context.live && coverage.trades && channel.priceTick ? "live" : "idle");
        } catch (error) {
          failure = error instanceof Error ? error.message : "Invalid bubble data.";
          channel.history = undefined; channel.style = undefined;
          channel.message = `Volume Bubbles unavailable: ${failure}`; context.setStatus("idle");
        }
        publish();
      };
      const detach = () => { generation++; gridPending = false; off?.(); off = undefined; offArchive?.(); offArchive = undefined;
        if (timer !== undefined) clearTimeout(timer); timer = undefined; };
      const attach = () => {
        if (!context) return;
        const token = generation;
        offArchive = archive.subscribe?.(context.symbol, () => { if (active && token === generation) compute(); });
        if (context.live) off = subscribe(context.symbol, tick => {
          if (!active || token !== generation || tick.symbol !== context?.symbol) return;
          try { channel.history?.add([tick]); } catch (error) { failure = error instanceof Error ? error.message : "Invalid bubble data."; }
          if (timer === undefined) timer = setTimeout(() => { timer = undefined; if (token === generation) compute(); }, 50);
        });
      };
      return {
        start(ctx, inputs) { detach(); context = ctx; values = inputs; active = true; published = false; key = ""; channel.history = undefined;
          grid = undefined; gridError = ""; gridAt = 0; ctx.emit({}); compute(); attach(); },
        onBars() { compute(); }, onViewport() {}, setInputs(inputs) { values = inputs; if (failure) key = ""; compute(); },
        suspend() { active = false; detach(); channel.history = undefined; channel.style = undefined; key = ""; context?.pushData(null); published = false; },
        resume() { active = true; compute(); attach(); },
        stop() { active = false; detach(); channel.history = undefined; channel.style = undefined; channel.repaint = undefined; context?.pushData(null); context = undefined; published = false; },
      };
    } };
}
