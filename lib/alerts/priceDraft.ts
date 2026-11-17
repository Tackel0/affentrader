import type { AlertDraft, Quote, Timeframe } from "@/types/trading";
import { useChartStore } from "@/stores/useChartStore";

function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Threshold defaults come only from an observed matching quote or an explicit chart coordinate. */
export function priceAlertDraft(
  symbol: string,
  timeframe: Timeframe,
  quote?: Quote,
  selectedPrice?: number,
): AlertDraft {
  const manual = selectedPrice !== undefined;
  const observed = quote?.symbol === symbol && validPrice(quote.price) ? quote : undefined;
  const price = manual ? (validPrice(selectedPrice) ? selectedPrice : undefined) : observed?.price;
  return {
    symbol,
    timeframe,
    price,
    source: manual || price === undefined ? "manual" : observed?.simulated ? "simulation" : "market",
    observedAt: !manual && observed && Number.isFinite(observed.time) && observed.time > 0
      ? observed.time : undefined,
  };
}

export function currentPriceAlertDraft(
  selectedPrice?: number,
  symbol = useChartStore.getState().symbol,
): AlertDraft {
  const chart = useChartStore.getState();
  return priceAlertDraft(symbol, chart.timeframe, chart.quotes[symbol], selectedPrice);
}
