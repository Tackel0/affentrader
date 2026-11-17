import type { OrderBook } from "@/types/trading";

interface Level { price: number; quantity: number; checksumText: string }
const depth = 10;
const decimal = /^\d+(?:\.\d+)?$/;
const checksumDigits = (value: string) => value.replace(".", "").replace(/^0+/, "");

function crc32(text: string): number {
  let crc = -1;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i);
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}

export function parseKrakenBookMessage(text: string): unknown {
  return JSON.parse(text, (key, value, context?: { source?: string }) =>
    (key === "price" || key === "qty") && typeof value === "number" ? context?.source : value);
}

function applyLevels(previous: Level[], changes: unknown, bids: boolean): Level[] {
  if (!Array.isArray(changes)) throw new Error("Invalid Kraken book levels.");
  const levels = new Map(previous.map(level => [level.price, level]));
  for (const entry of changes) {
    const priceText = entry?.price, qtyText = entry?.qty;
    if (typeof priceText !== "string" || typeof qtyText !== "string" ||
      !decimal.test(priceText) || !decimal.test(qtyText)) throw new Error("Missing Kraken book precision.");
    const price = Number(priceText), quantity = Number(qtyText);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity)) throw new Error("Invalid Kraken price or quantity.");
    if (quantity === 0) levels.delete(price);
    else levels.set(price, { price, quantity, checksumText: checksumDigits(priceText) + checksumDigits(qtyText) });
  }
  return [...levels.values()].sort((a, b) => bids ? b.price - a.price : a.price - b.price).slice(0, depth);
}

export class KrakenBook {
  private bids: Level[] = [];
  private asks: Level[] = [];
  private ready = false;

  constructor(private readonly pair: string) {}

  apply(type: "snapshot" | "update", data: unknown, receivedAt: number): OrderBook | null {
    if (type === "update" && !this.ready) return null;
    this.ready = false;
    const payload = data as { symbol?: unknown; bids?: unknown; asks?: unknown; checksum?: unknown } | null;
    if (payload?.symbol !== this.pair) throw new Error("Mismatched Kraken book symbol.");
    const bids = applyLevels(type === "snapshot" ? [] : this.bids, payload.bids, true);
    const asks = applyLevels(type === "snapshot" ? [] : this.asks, payload.asks, false);
    const checksum = crc32([...asks, ...bids].map(level => level.checksumText).join(""));
    if (!bids.length || !asks.length || bids[0].price >= asks[0].price || checksum !== payload.checksum)
      throw new Error("Kraken book checksum or spread is invalid.");
    this.bids = bids;
    this.asks = asks;
    this.ready = true;
    const levels = (rows: Level[]) => rows.map(({ price, quantity }) => ({ price, quantity }));
    return { symbol: `KRK:${this.pair}`, time: receivedAt, simulated: false, bids: levels(bids), asks: levels(asks) };
  }
}
