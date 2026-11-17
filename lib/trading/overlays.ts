import type { OverlayPrimitive } from "@/lib/chart/overlays";
import { unrealizedPnl, type Account } from "./broker";

const UP = "#089981";
const DOWN = "#f23645";
const ACCENT = "#2962ff";

function orderLabel(o: Account["orders"][number]): string {
  const type = o.type === "stop_limit" ? "STOP LIMIT" : o.type.toUpperCase();
  const kind = o.note?.startsWith("Take profit")
    ? "TP"
    : o.note?.startsWith("Stop loss")
      ? "SL"
      : `${o.side.toUpperCase()} ${type}`;
  return `${kind} ${o.quantity}`;
}

/** Lines and markers describing a paper account's activity on one symbol. */
export function tradingOverlays(
  account: Account,
  symbol: string,
  price: number | undefined,
  fillLimit = 60,
): OverlayPrimitive[] {
  const out: OverlayPrimitive[] = [];
  const position = account.positions.find((p) => p.symbol === symbol);
  if (position && position.quantity !== 0) {
    const pnl = price ? unrealizedPnl(position, price) : 0;
    out.push({
      kind: "hline",
      id: `position-${symbol}`,
      price: position.avgPrice,
      color: position.quantity > 0 ? UP : DOWN,
      width: 2,
      dash: [2, 3],
      label: `${position.quantity > 0 ? "LONG" : "SHORT"} ${Math.abs(position.quantity)} · ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT`,
    });
  }
  for (const order of account.orders) {
    if (order.symbol !== symbol || order.status !== "working") continue;
    const level =
      order.type === "limit" || (order.type === "stop_limit" && order.triggered)
        ? order.price
        : order.stopPrice;
    if (!level) continue;
    const protective = order.note?.startsWith("Take profit")
      ? UP
      : order.note?.startsWith("Stop loss")
        ? DOWN
        : order.side === "buy"
          ? ACCENT
          : "#ff9800";
    out.push({
      kind: "hline",
      id: order.id,
      orderId:order.id,
      price: level,
      color: protective,
      dash: [6, 4],
      label: orderLabel(order),
    });
  }
  const fills = account.fills.filter((f) => f.symbol === symbol).slice(-fillLimit);
  for (const fill of fills)
    out.push({
      kind: "marker",
      time: fill.time,
      price: fill.price,
      shape: fill.side === "buy" ? "triangleUp" : "triangleDown",
      color: fill.side === "buy" ? UP : DOWN,
      position: fill.side === "buy" ? "below" : "above",
      label: `${fill.side === "buy" ? "B" : "S"} ${fill.quantity}`,
    });
  return out;
}
