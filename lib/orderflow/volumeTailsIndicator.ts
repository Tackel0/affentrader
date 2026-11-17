import type { InputValue, NativeIndicatorContext, NativeIndicatorDescriptor } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { ProfileTradeCollection } from "./profileTradeCollection";
import type { StudyArchiveOptions } from "./studyTradeSource";
import { defaultTails, resolveTails, tailsIds, tailsInputs, tailsTitles, type TailsKind, type TailsSettings } from "./volumeTails";
import { profileSessionSource } from "./profileTradingHours";
import { tpoTradingHoursBasis } from "./tpoTradingHours";
import type { MarketSessionCalendar } from "@/lib/market/sessionWindows";

export interface TailsChannel {
  trades?: readonly Tick[]; style?: TailsSettings; message: string; repaint?: () => void;
  calendar?: MarketSessionCalendar;
  identity?: { symbol: string; timeframe: string; live: boolean; through: number | null; revision: string | number };
}
export function tailsDescriptor(kind: TailsKind, read: (symbol: string) => readonly Tick[], subscribe: (symbol: string, changed: (tick: Tick) => void) => () => void,
  archive: StudyArchiveOptions = {}): NativeIndicatorDescriptor {
  return { type: tailsIds[kind], title: tailsTitles[kind], shortTitle: { visible: "Visible Tails", rolling: "Rolling Tails", session: "Session Tails" }[kind], overlay: true, paneHint: "price", multiInstance: true,
    inputsSchema: () => tailsInputs(kind), defaultInputs: () => ({ ...defaultTails() }), create: () => {
      let context: NativeIndicatorContext | undefined, inputs: Record<string, InputValue> = {}, active = false, published = false;
      let collection = new ProfileTradeCollection(), key = "", failure = "", previous: readonly Tick[] | undefined, generation = 0;
      let off: (() => void) | undefined, offArchive: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
      const channel: TailsChannel = { message: "Waiting for classified executions." };
      const compute = () => {
        if (!active || !context) return;
        try {
          const style = resolveTails(inputs), replay = context.live ? undefined : archive.replay?.(context), revision = archive.revision?.(context.symbol) ?? 0;
          const source = kind === "session" ? profileSessionSource(context.symbol, context.session) : undefined;
          channel.calendar = source ? { ...source, regular: source.regular.map(w => [w[0], w[1]] as const), extended: source.extended.map(w => [w[0], w[1]] as const) } : undefined;
          channel.identity = { symbol: context.symbol, timeframe: context.timeframe, live: context.live, through: replay?.through ?? null, revision };
          if (!context.live && !replay) throw new Error("Replay needs a loaded classified archive and completed-bar boundary.");
          const next = JSON.stringify(channel.identity);
          if (next !== key) { key = next; collection = new ProfileTradeCollection(); previous = undefined; failure = ""; }
          if (failure) throw new Error(failure);
          const input = replay?.trades ?? read(context.symbol);
          if (input !== previous) {
            try { collection.add(input.filter(t => t.symbol === context!.symbol)); previous = input; }
            catch (error) { failure = error instanceof Error ? error.message : "Invalid executions."; throw error; }
          }
          channel.trades = collection.snapshot(); channel.style = style;
          const label = replay?.label ?? archive.label?.(context.symbol);
          channel.message = `${channel.trades.some(t => t.simulated) ? "SIMULATED · " : ""}Partial classified history · ${channel.trades.length} observed executions${label ? ` · ${label}` : ""}`;
          if (kind === "session") channel.message += ` · ${tpoTradingHoursBasis({ ...style, sessionPeriod: style.session }, context.symbol, channel.calendar)}`;
          if (collection.rejected) channel.message += ` · ${collection.rejected} invalid observations rejected`;
          if (!channel.trades.length) channel.message += " · Waiting for classified trades; candle volume cannot supply buy/sell tails.";
          context.setStatus(context.live && channel.trades.length ? "live" : "idle");
        } catch (error) {
          channel.trades = undefined; channel.style = undefined;
          channel.message = `Volume Tails unavailable: ${error instanceof Error ? error.message : "Invalid source."}`; context.setStatus("idle");
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
        start(ctx, values) { detach(); context = ctx; inputs = values; key = ""; collection = new ProfileTradeCollection(); previous = undefined; failure = ""; active = true; published = false; compute(); attach(); },
        onBars: compute, onViewport() {}, setInputs(values) { inputs = values; compute(); },
        suspend() { active = false; detach(); key = ""; previous = undefined; collection = new ProfileTradeCollection(); channel.trades = undefined; channel.style = undefined; context?.pushData(null); published = false; },
        resume() { active = true; compute(); attach(); },
        stop() { active = false; detach(); channel.trades = undefined; channel.style = undefined; channel.repaint = undefined; context?.pushData(null); context = undefined; published = false; collection = new ProfileTradeCollection(); previous = undefined; },
      };
    } };
}
