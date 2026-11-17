import type { NativeIndicatorContext, NativeIndicatorDescriptor, InputValue } from "@luxalgo/vela";
import type { OrderBook } from "@/types/trading";
import { DepthHeatmapCollection, defaultDepthHeatmap, depthHeatmapSettings, depthHeatmapThrough, type DepthHeatmapColumn, type DepthHeatmapSettings } from "./depthHeatmap";
import { nativeReplayBoundary } from "@/lib/chart/replayClock";
import { replayDepth, REPLAY_DEPTH_RETENTION_MS } from "./replayDepth";
export interface DepthHeatmapChannel { columns?: readonly DepthHeatmapColumn[]; style?: DepthHeatmapSettings; message: string; repaint?: () => void; now: number; identity?: { symbol: string; timeframe: string; live: boolean; source: string; replayThrough: number | null } }
export interface DepthSource { key: string; enabled: boolean; reason: string }
export function depthHeatmapDescriptor(subscribe: (receive: (book: OrderBook) => void) => () => void, source: (symbol: string, timeframe: string) => DepthSource, now: () => number = Date.now): NativeIndicatorDescriptor {
  return { type: "af-depth-heatmap", title: "Liquidity Heatmap · observed depth", shortTitle: "Depth", overlay: true, paneHint: "price", multiInstance: false,
    defaultInputs: () => ({ ...defaultDepthHeatmap() }), inputsSchema: () => [
      { key: "sampleMs", title: "Sample interval (ms)", type: "int", defval: 1000, min: 250, max: 10000, step: 250 },
      { key: "retentionMinutes", title: "Retain minutes", type: "int", defval: 10, min: 1, max: 30 },
      { key: "rowSize", title: "Price row size (0 = observed spacing)", type: "float", defval: 0, min: 0, max: 1e12 },
      { key: "opacity", title: "Opacity %", type: "int", defval: 55, min: 1, max: 90 },
      { key: "bidColor", title: "Bid color", type: "color", defval: "#26a69a" }, { key: "askColor", title: "Ask color", type: "color", defval: "#ef5350" },
      { key: "logarithmic", title: "Log quantity intensity", type: "bool", defval: true },
    ], create: () => {
      let context: NativeIndicatorContext | undefined, inputs: Record<string, InputValue> = {}, active = false, published = false;
      let collection: DepthHeatmapCollection | undefined, key = "", off: (() => void) | undefined, timer: ReturnType<typeof setInterval> | undefined, generation = 0;
      let subscribedLive: boolean | undefined;
      let expiry: ReturnType<typeof setTimeout> | undefined;
      let expiryAt: number | undefined;
      let previousInputs: typeof inputs | undefined, style: DepthHeatmapSettings | undefined;
      const channel: DepthHeatmapChannel = { message: "Collecting observed depth snapshots.", now: now() };
      const detach = () => {
        generation++;
        off?.(); off = undefined; subscribedLive = undefined;
        if (timer !== undefined) clearInterval(timer);
        if (expiry !== undefined) clearTimeout(expiry);
        timer = undefined; expiry = undefined; expiryAt = undefined;
      };
      const attach = (live: boolean) => {
        if (subscribedLive === live) return;
        detach();
        subscribedLive = live;
        const current = generation;
        if (live) {
          off = subscribe(book => { if (current === generation && book.symbol === context?.symbol) compute(book); });
          timer = setInterval(() => { if (current === generation) compute(); }, 1000);
        } else {
          off = replayDepth.subscribe(() => { if (current === generation) compute(); });
        }
      };
      const scheduleExpiry = (at: number | undefined, wallTime: number) => {
        if (expiryAt === at) return;
        if (expiry !== undefined) clearTimeout(expiry);
        expiry = undefined;
        expiryAt = at;
        if (at === undefined) return;
        const current = generation;
        expiry = setTimeout(() => {
          expiry = undefined; expiryAt = undefined;
          if (current === generation) compute();
        }, Math.max(1, at - wallTime));
      };
      const compute = (book?: OrderBook) => {
        if (!active || !context) return;
        const { live, symbol, timeframe } = context;
        attach(live);
        const previous = { ...channel }, wallTime = now();
        channel.now = wallTime;
        let refreshAt: number | undefined;
        try {
          if (previousInputs !== inputs || !style) {
            style = depthHeatmapSettings(inputs);
            previousInputs = inputs;
          }
          const current = source(symbol, timeframe), replayThrough = live ? null : nativeReplayBoundary(context);
          const oldIdentity = previous.identity;
          if (oldIdentity?.symbol !== symbol || oldIdentity.timeframe !== timeframe || oldIdentity.live !== live ||
            oldIdentity.source !== current.key || oldIdentity.replayThrough !== replayThrough)
            channel.identity = { symbol, timeframe, live, source: current.key, replayThrough };
          const identity = JSON.stringify([symbol, timeframe, live, current.key, current.enabled, style.sampleMs, style.retentionMinutes]);
          if (key !== identity) { key = identity; collection = new DepthHeatmapCollection(symbol); }
          channel.style = style;
          if (!current.enabled) {
            channel.columns = undefined;
            channel.message = current.reason;
          } else if (!live) {
            if (replayThrough === null) channel.columns = undefined;
            else {
              const columns = replayDepth.window(symbol, replayThrough, wallTime, style.retentionMinutes);
              const old = previous.columns;
              channel.columns = old?.length === columns.length && columns.every((column, index) => old[index] === column)
                ? old : Object.freeze(columns);
              channel.now = replayThrough;
              refreshAt = replayThrough > wallTime ? replayThrough
                : columns.length ? columns[0].observedAt + REPLAY_DEPTH_RETENTION_MS + 1 : undefined;
            }
            channel.message = channel.columns?.length
              ? `${channel.columns.length} recorded depth snapshots · 1s sampling · partial coverage`
              : "Depth Replay unavailable for this window. Capture depth in Order flow before starting Replay.";
          }
          else {
            if (book) collection!.add(book, channel.now, style);
            channel.columns = collection!.read(channel.now, style);
            const last = channel.columns.at(-1);
            channel.message = `${channel.columns.length} sampled depth snapshots · top levels only · offered liquidity, not executed volume${last && channel.now - last.observedAt > 5000 ? " · STALE: no fresh depth" : last ? "" : " · collecting"}`;
          }
        } catch (error) { channel.columns = undefined; channel.message = `Depth unavailable: ${error instanceof Error ? error.message : "Invalid input."}`; }
        scheduleExpiry(refreshAt, wallTime);
        if (!published) { context.pushData(channel); published = true; }
        else if (previous.columns !== channel.columns || previous.style !== channel.style || previous.identity !== channel.identity ||
          previous.message !== channel.message || depthHeatmapThrough(previous.columns, previous.now) !== depthHeatmapThrough(channel.columns, channel.now)) channel.repaint?.();
      };
      return {
        start(ctx, values) { detach(); context = ctx; inputs = values; active = true; key = ""; published = false; ctx.emit({}); compute(); },
        onBars() { compute(); }, onViewport() {}, setInputs(values) { inputs = values; compute(); },
        suspend() { active = false; detach(); channel.columns = undefined; collection = undefined; key = ""; context?.pushData(null); published = false; },
        resume() { active = true; compute(); },
        stop() { active = false; detach(); channel.columns = undefined; channel.repaint = undefined; collection = undefined; key = ""; context?.pushData(null); context = undefined; published = false; },
      };
    } };
}
