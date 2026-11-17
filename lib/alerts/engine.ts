import type { AlertCondition, PriceAlert } from "@/types/trading";
import { bucketStart, isTickInterval } from "@/lib/market/intervals";
import { closesOnly, isExpired, oneShot } from "./schedule";
import { scopeStopped } from "./rateLimit";
export function conditionMatches(
  condition: AlertCondition,
  previous: number,
  current: number,
  price: number,
  upperPrice?: number,
): boolean {
  if (![previous, current, price].every(Number.isFinite)) return false;
  const up = previous < price && current >= price;
  const down = previous > price && current <= price;
  if (condition === "crossing") return up || down;
  if (condition === "crossing_up") return up;
  if (condition === "crossing_down") return down;
  if (
    upperPrice === undefined ||
    !Number.isFinite(upperPrice) ||
    upperPrice <= price
  )
    return false;
  const wasInside = previous >= price && previous <= upperPrice;
  const isInside = current >= price && current <= upperPrice;
  return condition === "entering_band"
    ? !wasInside && isInside
    : wasInside && !isInside;
}
export class AlertEvaluator {
  private previous = new Map<
    string,
    { price: number; simulated: boolean; time: number; signature: string; firedAt?: number; firedBar?: number }
  >();
  constructor(private barAt?: (symbol: string, timeframe: string) => number | undefined) {}
  evaluate(
    alerts: PriceAlert[],
    symbol: string,
    price: number,
    time: number,
    simulated: boolean,
    frequency: "tick" | "close",
    timeframe?: string,
    observedAt = time,
  ): string[] {
    const fired: string[] = [];
    const currentIds = new Set(alerts.map((a) => a.id));
    for (const id of this.previous.keys())
      if (!currentIds.has(id)) this.previous.delete(id);
    for (const alert of alerts) {
      if (
        alert.symbol !== symbol ||
        (closesOnly(alert) ? "close" : "tick") !== frequency ||
        (frequency === "close" && alert.timeframe !== timeframe)
      )
        continue;
      const signature = JSON.stringify([
        alert.condition,
        alert.price,
        alert.upperPrice,
        alert.status,
        alert.frequency,
        alert.timeframe,
        alert.trigger,
        alert.expiresAt,
        alert.rate?.resetAt,
      ]);
      const prev = this.previous.get(alert.id);
      if (prev && (time < prev.time || frequency === "close" && time === prev.time)) continue;
      const gates = prev?.signature === signature && prev.simulated === simulated ? prev : { firedAt: alert.lastTriggeredAt, firedBar: alert.lastTriggeredBar };
      const next = { ...gates, price, time, simulated, signature };
      this.previous.set(alert.id, next);
      if (
        alert.status !== "active" ||
        !prev ||
        prev.simulated !== simulated ||
        prev.signature !== signature
        || isExpired(alert, observedAt) || scopeStopped(alert, symbol) || oneShot(alert) && prev.firedAt !== undefined
      )
        continue;
      const bar = frequency === "close" ? time : this.barAt?.(symbol, alert.timeframe) ?? (isTickInterval(alert.timeframe) ? undefined : bucketStart(alert.timeframe, time));
      const ready = (alert.trigger !== "once_per_bar" || bar !== undefined && bar !== prev.firedBar) &&
        (alert.trigger !== "once_per_minute" || prev.firedAt === undefined || observedAt - prev.firedAt >= 60_000);
      if (ready &&
        conditionMatches(
          alert.condition,
          prev.price,
          price,
          alert.price,
          alert.upperPrice,
        )
      )
        { fired.push(alert.id); next.firedAt = observedAt; next.firedBar = bar; }
    }
    return fired;
  }
  reset() {
    this.previous.clear();
  }
  firedBar(id: string) { return this.previous.get(id)?.firedBar; }
}
