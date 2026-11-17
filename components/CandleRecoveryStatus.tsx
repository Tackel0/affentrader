"use client";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";

export function CandleRecoveryStatus({ symbol, timeframe, hidden = false }: { symbol: string; timeframe: string; hidden?: boolean }) {
  const recovery = useChartStore(state => state.candleRecoveries[`${symbol}:${timeframe}`]);
  if (hidden || !recovery) return null;
  const unavailable = recovery.status === "unavailable";
  return <div className="candle-recovery-status" role="status" aria-label="Candle history recovery" title={recovery.message}>
    {unavailable ? <TriangleAlert size={13} /> : <LoaderCircle size={13} className="spin" />}
    <span>{unavailable ? "Interrupted history unavailable" : recovery.status === "retrying" ? "Recovering candles · retrying" : recovery.status === "refreshing" ? "Waiting for fresh candles…" : "Recovering missing candles…"}</span>
    {unavailable && <button type="button" onClick={() => window.location.reload()}>Reload chart</button>}
  </div>;
}
