"use client";
import { useEffect } from "react";
import { marketService } from "@/lib/market/service";
import { useChartStore } from "@/stores/useChartStore";

/** Visible consumers share the service's minute cache and in-flight requests. */
export function useQuoteRanges(symbols: readonly string[]) {
  const key = [...new Set(symbols)].sort().join("|");
  const ready = useChartStore(state => key.split("|").filter(symbol => state.quotes[symbol]?.metrics && !state.quotes[symbol].simulated).join("|"));
  const epoch = useChartStore(state => state.feedEpoch);
  useEffect(() => {
    const symbolsList = ready.split("|").filter(Boolean);
    if (!symbolsList.length) return;
    const refresh = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      for (const symbol of symbolsList) void marketService.requestQuoteRange(symbol);
    };
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [ready, epoch]);
}
