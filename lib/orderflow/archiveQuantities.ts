import type { Tick } from "@/types/trading";
import { canonicalDecimal } from "./priceGrid";
/** Sum the source numbers' canonical decimal spellings; keep binary rounding out of accumulated quantities. */
export class ArchiveQuantities {
  private exponent = 0; private buy = 0n; private sell = 0n;
  add(tick: Pick<Tick, "quantity" | "side">) {
    if (!Number.isFinite(tick.quantity) || tick.quantity <= 0 || tick.side !== "buy" && tick.side !== "sell") throw new Error("Invalid classified quantity.");
    const value = canonicalDecimal(tick.quantity);
    if (value.exponent < this.exponent) { const factor = 10n ** BigInt(this.exponent - value.exponent); this.buy *= factor; this.sell *= factor; this.exponent = value.exponent; }
    const quantity = value.coefficient * 10n ** BigInt(value.exponent - this.exponent);
    if (tick.side === "buy") this.buy += quantity; else this.sell += quantity;
  }
  read() {
    const decimal = (coefficient: bigint): string => {
      if (coefficient === 0n) return "0";
      const negative = coefficient < 0n, digits = String(negative ? -coefficient : coefficient), point = digits.length + this.exponent;
      let text = point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
      if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
      return negative ? `-${text}` : text;
    };
    return { buyVolume: decimal(this.buy), sellVolume: decimal(this.sell), delta: decimal(this.buy - this.sell) };
  }
}
