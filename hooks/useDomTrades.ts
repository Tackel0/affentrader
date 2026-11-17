"use client";
import { useEffect, useState } from "react";
import { DomTrades } from "@/lib/orderflow/domTrades";
import { marketService } from "@/lib/market/service";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { usePaperStore } from "@/stores/usePaperStore";

function scope() {
  const s = useChartStore.getState();
  const replay = useWorkspaceStore.getState().replay.active || usePaperStore.getState().mode === "replay";
  const source = s.dataSources[`${s.symbol}:${s.timeframe}`];
  return { symbol: s.symbol, enabled: !replay && s.feedMode !== "simulation" && source === "exchange",
    key: JSON.stringify([s.symbol, s.feedMode, s.feedEpoch, s.marketEpochs[s.symbol] ?? 0, source, replay]) };
}
export function useDomTrades() {
  useChartStore(s => JSON.stringify([s.symbol, s.feedMode, s.feedEpoch, s.marketEpochs[s.symbol] ?? 0, s.dataSources[`${s.symbol}:${s.timeframe}`]]));
  useWorkspaceStore(s => s.replay.active);
  usePaperStore(s => s.mode);
  const current = scope();
  const [collection, setCollection] = useState<{key:string; model:DomTrades} | null>(null);
  useEffect(() => {
    if (!current.enabled) { setCollection(null); return; }
    const model = new DomTrades(current.symbol, Date.now());
    setCollection({key:current.key, model});
    return marketService.onTick(trade => {
      if (scope().key === current.key) model.add(trade, Date.now());
    });
  }, [current.key, current.enabled, current.symbol]);
  return collection?.key === current.key ? collection.model : null;
}
