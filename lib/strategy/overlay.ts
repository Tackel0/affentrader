import type { OverlayPrimitive } from "@/lib/chart/overlays";
import type { StrategyReport } from "@/types/strategy";

const UP = "#089981";
const DOWN = "#f23645";

/**
 * Chart markers for a backtest: an arrow at each entry and exit joined by a
 * line coloured by the trade's result. Only the newest `limit` trades are
 * drawn so a long history stays legible and fast.
 */
export function strategyOverlays(
  report: StrategyReport,
  focus: string | null = null,
  limit = 250,
): OverlayPrimitive[] {
  const out: OverlayPrimitive[] = [];
  for (const t of report.trades.slice(-limit)) {
    const win = t.netProfit >= 0;
    const color = win ? UP : DOWN;
    const focused = t.id === focus;
    out.push({
      kind: "marker",
      time: t.entryTime,
      price: t.entryPrice,
      shape: t.side === "long" ? "triangleUp" : "triangleDown",
      color: t.side === "long" ? UP : DOWN,
      position: t.side === "long" ? "below" : "above",
      label: focused ? `${t.side === "long" ? "Long" : "Short"} ${t.entryId}` : undefined,
    });
    if (t.exitTime !== null && t.exitPrice !== null) {
      out.push({
        kind: "segment",
        from: { time: t.entryTime, price: t.entryPrice },
        to: { time: t.exitTime, price: t.exitPrice },
        color,
        width: focused ? 3 : 1.2,
        dash: [4, 3],
        label: focused ? `${t.netProfit >= 0 ? "+" : ""}${t.netProfit.toFixed(2)}` : undefined,
      });
      out.push({
        kind: "marker",
        time: t.exitTime,
        price: t.exitPrice,
        shape: "circle",
        color,
        position: "at",
      });
    }
  }
  return out;
}
