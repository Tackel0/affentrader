"use client";
import { useSyncExternalStore } from "react";
import { createChartReadoutStore, type ChartReadout } from "@/lib/chart/dataWindow";
import { getPrimaryChart, indicatorHandles, subscribePrimaryChart } from "./useVelaChart";
import { subscribeFootprintSurfaces } from "@/lib/orderflow/footprintReadout";
import { readTpoSurface } from "@/lib/orderflow/tpoReadout";
import { readSeriesPreferences } from "@/lib/chart/seriesPreferences";
import { tpoSnapshotDraft } from "@/lib/alerts/tpoDraft";
import { tpoAlertSettings } from "@/lib/alerts/tpo";
import type { TpoAlertCandidate } from "@/types/trading";
import { resolveZone } from "@/lib/timezones";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { completedReplayBoundary } from "@/lib/chart/replayClock";
import { rangeProfileSourceStamp } from "@/lib/orderflow/executionRangeSource";
import { visibleProfileSettings } from "@/lib/orderflow/visibleProfile";
import { visibleProfileStyleKey } from "@/lib/orderflow/visibleProfileReadout";
import { depthSourceKey } from "@/lib/orderflow/depthHeatmapReadout";
const readoutStore = createChartReadoutStore(subscribePrimaryChart, {
  read() {
    const state = useChartStore.getState();
    const chart = getPrimaryChart();
    const visibleProfileStyles: Record<string, string> = {};
    for (const study of state.indicators) {
      const handle = indicatorHandles.get(study.id);
      if (study.definitionId !== "vpvr" || !handle?.visible) continue;
      try { visibleProfileStyles[handle.id] = visibleProfileStyleKey(visibleProfileSettings(study.inputs)); } catch { visibleProfileStyles[handle.id] = "invalid"; }
    }
    return { symbol: state.symbol, timeframe: state.timeframe, zone: resolveZone(state.timezone, state.symbol),
      depthSource: depthSourceKey(state.marketEpochs[state.symbol] ?? 0, state.feedMode, state.dataSources[`${state.symbol}:${state.timeframe}`]),
      profileSourceStamp: rangeProfileSourceStamp(state.symbol, state.timeframe), visibleProfileStyles,
      chartType: state.chartType, marketEpoch: state.marketEpochs[state.symbol] ?? 0,
      replay: useWorkspaceStore.getState().replay.active, replayThrough: chart ? completedReplayBoundary(chart.replay.state, state.timeframe) : null, recovering: !!state.candleRecoveries[`${state.symbol}:${state.timeframe}`], error: state.chartError,
      indicatorIds: Object.fromEntries([...indicatorHandles].filter(([, handle]) => handle.visible).map(([id, handle]) => [id, handle.id])) };
  },
  subscribe(listener) {
    const offChart = useChartStore.subscribe((state, previous) => {
      const key = `${state.symbol}:${state.timeframe}`;
      if (state.symbol !== previous.symbol || state.timeframe !== previous.timeframe || state.timezone !== previous.timezone ||
        state.chartType !== previous.chartType || state.feedMode !== previous.feedMode || state.indicators !== previous.indicators ||
        state.chartError !== previous.chartError || state.marketEpochs[state.symbol] !== previous.marketEpochs[state.symbol] ||
        state.dataSources[key] !== previous.dataSources[key] || state.candleRecoveries[key] !== previous.candleRecoveries[key]) listener();
    });
    const offWorkspace = useWorkspaceStore.subscribe((state, previous) => {
      if (state.replay.active !== previous.replay.active || state.replay.cursorTime !== previous.replay.cursorTime) listener();
    });
    const offFootprint = subscribeFootprintSurfaces(listener);
    return () => { offChart(); offWorkspace(); offFootprint(); };
  },
});
const subscribeNothing = () => () => {};
const emptyLegendRows = () => undefined;
export function useChartReadout(enabled = true) {
  return useSyncExternalStore(enabled ? readoutStore.subscribe : subscribeNothing,
    enabled ? readoutStore.getSnapshot : readoutStore.getServerSnapshot, readoutStore.getServerSnapshot);
}

export function useIndicatorLegendRows(id: string) {
  return useSyncExternalStore(readoutStore.subscribe, () => readoutStore.getLegendRows(id), emptyLegendRows);
}
export function openTpoSnapshotAlert(candidate: TpoAlertCandidate): void {
  const state = useChartStore.getState(), chart = getPrimaryChart(), key = `${state.symbol}:${state.timeframe}`;
  const refuse = () => { state.toast("TPO reference unavailable", "The selected completed profile changed. Inspect the current values."); };
  if (!chart || state.chartType !== "tpo" || state.chartError || state.candleRecoveries[key] ||
    useWorkspaceStore.getState().replay.active || chart.replay.state.active || chart.market.symbol !== state.symbol || chart.market.timeframe !== state.timeframe) { refuse(); return; }
  const native = chart.renderer.dataWindowReadout() as ChartReadout;
  const style = readSeriesPreferences(chart.renderer.getConfig())?.tpo;
  const readout = readTpoSurface("primary", { symbol: state.symbol, timeframe: state.timeframe, epoch: state.marketEpochs[state.symbol] ?? 0,
    replay: false, seriesRange: native.seriesRange, style }, native.barTime);
  const enabled = style?.[candidate.level === "poc" ? "extendPoc" : candidate.level === "vah" ? "extendVah" : "extendVal"];
  const source = state.dataSources[key];
  const draft = source && enabled ? tpoSnapshotDraft(candidate, readout.alertCandidates ?? [], source) : null;
  if (!draft) { refuse(); return; }
  state.set({ alertDraft: draft });
}
export function openTpoFollowingAlert(): void {
  const state = useChartStore.getState(), chart = getPrimaryChart(), key = `${state.symbol}:${state.timeframe}`;
  const refuse = () => { state.toast("TPO alert unavailable", "Wait for the current live TPO profile outside Replay."); };
  if (!chart || state.chartType !== "tpo" || state.chartError || state.candleRecoveries[key] || !state.dataSources[key] ||
    useWorkspaceStore.getState().replay.active || chart.replay.state.active || chart.market.symbol !== state.symbol || chart.market.timeframe !== state.timeframe) { refuse(); return; }
  const style = readSeriesPreferences(chart.renderer.getConfig())?.tpo, native = chart.renderer.dataWindowReadout() as ChartReadout;
  const view = readTpoSurface("primary", { symbol: state.symbol, timeframe: state.timeframe, epoch: state.marketEpochs[state.symbol] ?? 0,
    replay: false, seriesRange: native.seriesRange, style }, native.barTime);
  if (!style || view.status !== "ready") { refuse(); return; }
  state.set({ alertDraft: { symbol: state.symbol, timeframe: state.timeframe, name: "Following TPO reference", ruleCondition: {
    op: "leaf", leaf: { type: "tpo", level: "poc", direction: "crossing", settings: tpoAlertSettings(style, state.symbol) } } } });
}
