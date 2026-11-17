import type { OHLCV } from "@/types/trading";
import { IEX_TICKER, iexSymbol } from "@/lib/symbolId";
export const SIP_HISTORY_DELAY_MS = 16 * 60000;
export interface AlpacaCredentials { key: string; secret: string }
export interface IexTrade { symbol: string; price: number; quantity: number; time: number; id: string }
export interface IexBar { symbol: string; bar: OHLCV; daily: boolean; correction: boolean }
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export function validAlpacaCredentials(value: unknown): value is AlpacaCredentials {
  return object(value) && typeof value.key === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value.key) && typeof value.secret === "string" && /^[A-Za-z0-9_\-+/=]{8,256}$/.test(value.secret);
}
export function alpacaTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value); return Number.isFinite(time) && time > 0 ? time : null;
}
export function parseIexOhlcv(value: unknown): OHLCV | null {
  if (!object(value)) return null;
  const time = alpacaTime(value.t), numbers = [value.o, value.h, value.l, value.c, value.v];
  if (time === null || numbers.some(value => typeof value !== "number" || !Number.isFinite(value)) || Math.min(value.o as number, value.h as number, value.l as number, value.c as number) <= 0 || (value.v as number) < 0) return null;
  const [open, high, low, close, volume] = numbers as number[];
  if (low > Math.min(open, close) || high < Math.max(open, close) || high < low) return null;
  return { time, open, high, low, close, volume };
}
export function parseIexTrade(value: unknown): IexTrade | null {
  if (!object(value) || value.T !== "t" || typeof value.S !== "string" || !IEX_TICKER.test(value.S)) return null;
  const time = alpacaTime(value.t);
  if (time === null || typeof value.p !== "number" || !Number.isFinite(value.p) || value.p <= 0 || typeof value.s !== "number" || !Number.isFinite(value.s) || value.s <= 0 || typeof value.i !== "number" && typeof value.i !== "string" || typeof value.i === "number" && !Number.isFinite(value.i)) return null;
  // IEX executions carry no aggressor flag. Never manufacture a buy/sell Tick.
  return { symbol: iexSymbol(value.S), time, price: value.p, quantity: value.s, id: String(value.i) };
}
export function parseIexBar(value: unknown): IexBar | null {
  if (!object(value) || !["b", "u", "d"].includes(String(value.T)) || typeof value.S !== "string" || !IEX_TICKER.test(value.S)) return null;
  const bar = parseIexOhlcv(value); return bar ? { symbol: iexSymbol(value.S), bar, daily: value.T === "d", correction: value.T === "u" } : null;
}
export function alpacaError(code: number): string {
  return ({ 400: "Alpaca rejected the request.", 401: "Alpaca authentication failed. Check the API key and secret.", 402: "Alpaca authentication is required.", 403: "IEX data is not permitted for these credentials.", 404: "Alpaca authentication timed out.", 405: "Alpaca's symbol subscription limit was reached.", 406: "Alpaca's connection limit was reached. Close the other IEX stream and reconnect.", 407: "Alpaca cannot serve this stream fast enough. Reconnect with fewer symbols.", 409: "IEX data is not enabled for this account.", 429: "Alpaca rate limit reached. Retry later." } as Record<number, string>)[code] ?? "Alpaca market data is unavailable.";
}
