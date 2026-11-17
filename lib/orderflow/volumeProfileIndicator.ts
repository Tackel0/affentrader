import type { NativeIndicator, NativeIndicatorContext, NativeIndicatorDescriptor, InputValue } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { providerOf } from "@/lib/symbolId";
import { buildSessionVolumeProfiles } from "./volumeProfileModel";
import { profileTradingCalendar, profileCalendarKey, profileSessionSource } from "./profileTradingHours";
import { tpoTradingHoursBasis } from "./tpoTradingHours";
import { defaultVolumeProfile, resolveVolumeProfile, volumeProfileInputs } from "./volumeProfileSettings";
import type { VolumeProfilePayload, VolumeProfileChannel } from "./volumeProfileRenderer";
import { ProfileTradeCollection } from "./profileTradeCollection";
import { sessionProfileJobs, type SessionProfileExecutor } from "./sessionProfileJobs";
import type { ReplayStudyInput, StudyArchiveOptions } from "./studyTradeSource";

let ownerSequence = 0;
export const BACKGROUND_SESSION_TRADES = 10000;
export function sessionProfileDescriptor(readTrades: (symbol: string) => readonly Tick[], subscribe?: (symbol: string, changed: (tick?: Tick) => void) => () => void,
  jobs: SessionProfileExecutor = sessionProfileJobs, sourceEpoch: (symbol: string) => number = () => 0, archive: StudyArchiveOptions = {}): NativeIndicatorDescriptor {
  return { type: "af-session-profile", title: "Session Volume Profile · collected trades", shortTitle: "SVP", overlay: true, paneHint: "price", multiInstance: true,
    inputsSchema: volumeProfileInputs, defaultInputs: () => ({ ...defaultVolumeProfile() }), create: () => {
      let context: NativeIndicatorContext | undefined, inputs: Record<string, InputValue> = {}, active = false;
      let previousTrades: readonly Tick[] | undefined, previousSettings = "", payload: VolumeProfilePayload | undefined;
      let calendar: ReturnType<typeof profileTradingCalendar> | undefined, previousCalendar = "";
      let collection = new ProfileTradeCollection(), modelKey = "", model: VolumeProfilePayload["model"];
      let previousRevision = -1, failure = "";
      const owner = ++ownerSequence;
      let pending = false, calculation = 0, configuration = "", workerError = "";
      let epoch = -1, archiveRevision: string | number | undefined;
      const cancelCalculation = () => { calculation++; pending = false; jobs.cancel(owner); };
      const channel: VolumeProfileChannel = {}; let published = false;
      let unsubscribe: (() => void) | undefined, offArchive: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined, generation = 0;
      const detach = () => { generation++; cancelCalculation(); unsubscribe?.(); unsubscribe = undefined; offArchive?.(); offArchive = undefined; if (timer !== undefined) clearTimeout(timer); timer = undefined; };
      const attach = () => {
        if (!context || unsubscribe || offArchive) return;
        const token = generation;
        offArchive = archive.subscribe?.(context.symbol, () => { if (active && token === generation) compute(); });
        if (!context.live || !subscribe) return;
        unsubscribe = subscribe(context.symbol, tick => {
          if (token !== generation || !active) return;
          if (tick && !failure) try { collection.add([tick]); } catch (error) { failure = error instanceof Error ? error.message : "Invalid collected executions."; }
          if (timer !== undefined) return;
          const delay = Math.max(16, Math.min(250, Math.ceil(collection.size / 1000) * 2));
          timer = setTimeout(() => { timer = undefined; if (token === generation) compute(); }, delay);
        });
      };
      const compute = () => {
        if (!active || !context) return;
        const signature = JSON.stringify([inputs, context.timeframe]);
        const sourceCalendar = profileSessionSource(context.symbol, context.session), calendarSignature = JSON.stringify([sourceCalendar?.revision,sourceCalendar?.mode]);
        let replay: ReplayStudyInput | undefined, readError = "";
        try { replay = context.live ? undefined : archive.replay?.(context); } catch (error) { readError = error instanceof Error ? error.message : "Invalid Replay input."; }
        const observedEpoch = sourceEpoch(context.symbol), observedArchive = JSON.stringify([archive.revision?.(context.symbol) ?? 0, context.live, replay?.through]);
        if (epoch !== observedEpoch || archiveRevision !== observedArchive) {
          archiveRevision = observedArchive;
          cancelCalculation(); epoch = observedEpoch; collection = new ProfileTradeCollection(); model = undefined; modelKey = "";
          configuration = ""; failure = ""; workerError = ""; payload = undefined; previousTrades = undefined;
        }
        let trades: readonly Tick[];
        try { trades = context.live ? readTrades(context.symbol) : replay?.trades ?? []; } catch (error) { trades = []; failure = error instanceof Error ? error.message : "Invalid archived study source."; }
        if (readError) failure = readError;
        if (!payload || trades !== previousTrades || signature !== previousSettings || calendarSignature !== previousCalendar || collection.revision !== previousRevision || failure) {
          let style = defaultVolumeProfile();
          try {
            style = resolveVolumeProfile(inputs);
            if (!context.live && !replay) { cancelCalculation(); model = undefined; configuration = ""; payload = { style, message: readError || "Replay: load recorded executions and wait for a completed-bar clock. Session volume profiles are unavailable." }; }
            else {
              // MarketService clears its tape at an explicit source reset; a rolling tape remains nonempty.
              if (!failure && !trades.length && collection.size) { cancelCalculation(); collection = new ProfileTradeCollection(); model = undefined; modelKey = ""; configuration = ""; workerError = ""; }
              if (failure) throw new Error(failure);
              if (trades !== previousTrades) collection.add(trades);
              // Keep timezone assignments across tick-only revisions, not across setting or market changes.
              const calendarKey = profileCalendarKey(style,context.symbol,sourceCalendar);
              if (!calendar || calendarKey !== clockKey) { calendar = profileTradingCalendar(style, context.symbol,sourceCalendar); clockKey = calendarKey; }
              const retained = collection.snapshot();
              const nextConfiguration = JSON.stringify([calendarKey, style.rows, style.rowSize, style.valueAreaPercent, !!style.showDevelopingPoc, !!style.showDevelopingValueArea, context.timeframe, collection.epoch]);
              if (configuration !== nextConfiguration) { cancelCalculation(); model = undefined; modelKey = ""; workerError = ""; configuration = nextConfiguration; }
              const nextKey = JSON.stringify([collection.revision, collection.rejected, calendarKey, style.rows, style.rowSize, style.valueAreaPercent, !!style.showDevelopingPoc, !!style.showDevelopingValueArea, context.timeframe]);
              if (!model || nextKey !== modelKey) {
                if (retained.length > (style.showDevelopingPoc || style.showDevelopingValueArea ? 1000 : BACKGROUND_SESSION_TRADES)) {
                  if (!pending && !workerError) {
                    pending = true;
                    const token = ++calculation, capturedCollection = collection, epoch = collection.epoch, rejected = collection.rejected;
                    jobs.submit(owner, retained, style, context.symbol, response => {
                      if (!active || !context || token !== calculation || collection !== capturedCollection || collection.epoch !== epoch) return;
                      if (calendarKey !== profileCalendarKey(style,context.symbol,profileSessionSource(context.symbol,context.session))) { cancelCalculation();payload=undefined;compute();return; }
                      pending = false;
                      if (response.error || !response.model) { workerError = response.error || "The session profile worker returned no model."; model = undefined; }
                      else { model = { ...response.model, discarded: response.model.discarded + rejected }; modelKey = nextKey; }
                      payload = undefined; compute();
                    },sourceCalendar,context.timeframe);
                  }
                } else {
                  model = buildSessionVolumeProfiles(retained, style, context.symbol, calendar, context.timeframe);
                  model = { ...model, discarded: model.discarded + collection.rejected }; modelKey = nextKey;
                }
              }
              if (workerError) throw new Error(workerError);
              payload = { style, model, pending, hoursBasis:tpoTradingHoursBasis(style,context.symbol,sourceCalendar), sourceLabel: replay?.label ?? archive.label?.(context.symbol), ...(!model ? { message: `Calculating session profile · ${retained.length.toLocaleString("en-US")} collected trades…` } : !model.sessions.length ? { message: replay ? "No recorded executions revealed inside these sessions." : model.retained ? "No collected trades fall inside these sessions." :
                ["yahoo", "alpaca"].includes(providerOf(context.symbol)) ? "This market has no classified trade feed. Use a Binance, Kraken or Hyperliquid market for session volume profiles." :
                  "Collecting trades. Session volume profiles use the retained trade stream only." } : {}) };
            }
          } catch (error) { cancelCalculation(); model = undefined; modelKey = ""; payload = { style, message: `SVP unavailable: ${error instanceof Error ? error.message : "Invalid profile data."}` }; }
          previousTrades = trades; previousSettings = signature; previousRevision = collection.revision; previousCalendar=calendarSignature;
        }
        channel.current = payload;
        channel.context = { id: context.id, symbol: context.symbol, timeframe: context.timeframe, epoch, live: context.live, ...(!context.live && replay ? { replayThrough: replay.through } : {}) };
        if (!published) { context.pushData(channel); published = true; } else channel.repaint?.();
        context.setStatus(pending ? "loading" : context.live && !payload.message ? "live" : "idle");
      };
      let clockKey = "";
      const instance: NativeIndicator = {
        start(ctx, values) { detach(); context = ctx; inputs = values; active = true; payload = undefined; previousTrades = undefined;
          collection = new ProfileTradeCollection(); model = undefined; modelKey = ""; failure = ""; previousRevision = -1; calendar = undefined; clockKey = ""; configuration = ""; workerError = "";
          epoch = -1; ctx.emit({}); compute(); attach(); },
        onBars: compute, onViewport() {},
        setInputs(values) { inputs = values; compute(); },
        suspend() { active = false; detach(); channel.current = undefined; context?.pushData(null); published = false; },
        resume() { active = true; previousTrades = undefined; workerError = ""; compute(); attach(); },
        stop() { active = false; detach(); channel.current = undefined; context?.pushData(null); published = false; payload = undefined; previousTrades = undefined;
          collection = new ProfileTradeCollection(); model = undefined; modelKey = ""; calendar = undefined; context = undefined; },
      };
      return instance;
    } };
}
