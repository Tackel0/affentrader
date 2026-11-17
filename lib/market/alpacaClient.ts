import type { OHLCV } from "@/types/trading";
import { aggregateBars } from "./aggregation";
import { bucketStart, parseInterval } from "./intervals";
import { alpacaCredentials, useAlpacaStore } from "@/stores/useAlpacaStore";
import { alpacaError, parseIexBar, parseIexTrade, SIP_HISTORY_DELAY_MS, type AlpacaCredentials, type IexBar, type IexTrade } from "./alpaca";
import { tickerOf } from "@/lib/symbolId";
export const IEX_HISTORY_LIMIT = 20_000;
export function iexHistoryPlan(timeframe: string, count: number) {
  const interval = parseInterval(timeframe);
  if (!interval || interval.unit === "T" || interval.ms < 60_000) throw new Error("IEX charts support minute and longer intervals; second and tick histories are unavailable.");
  const daily = ["D", "W", "M"].includes(interval.unit), sourceMs = daily ? 86_400_000 : 60_000;
  return { daily, native: daily ? "1Day" : "1Min", wanted: Math.min(IEX_HISTORY_LIMIT, Math.max(1, Math.ceil((count + 1) * interval.ms / sourceMs))) };
}
export function aggregateIexBars(bars: OHLCV[], timeframe: string): OHLCV[] {
  // Preserve the provider's exchange-local daily opening timestamp at the native resolution.
  if (timeframe === "1D" || timeframe === "1m") return bars.map(bar => ({ ...bar }));
  const result = aggregateBars(bars, timeframe);
  // A bounded source window can begin mid-bucket; do not replace a previously complete older aggregate with that fragment.
  return bars.length >= IEX_HISTORY_LIMIT && bars[0].time !== bucketStart(timeframe, bars[0].time) ? result.slice(1) : result;
}
export async function loadIexBars(symbol: string, timeframe: string, count: number, end = Date.now(), fetcher: typeof fetch = fetch) {
  const feed = symbol.startsWith("SIP:") ? "sip" : "iex";
  if (feed === "sip") end = Math.min(end, Date.now() - SIP_HISTORY_DELAY_MS);
  const plan = iexHistoryPlan(timeframe, count), credentials = alpacaCredentials(), epoch = useAlpacaStore.getState().epoch;
  const rows = new Map<number, OHLCV>(), tokens = new Set<string>(); let pageToken: string | undefined;
  do {
    if (epoch !== useAlpacaStore.getState().epoch) throw new Error("The IEX session changed during history loading.");
    const response = await fetcher("/api/alpaca", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ credentials, ticker: tickerOf(symbol), feed, timeframe: plan.native, end, limit: Math.min(10_000, plan.wanted - rows.size), pageToken }), signal: AbortSignal.timeout(25_000) });
    const payload = await response.json().catch(() => ({})) as { bars?: OHLCV[]; nextPage?: string | null; error?: string };
    if (!response.ok) throw new Error(payload.error ?? alpacaError(response.status));
    if (!Array.isArray(payload.bars)) throw new Error("Invalid IEX history response.");
    for (const bar of payload.bars) if (bar.time <= end) rows.set(bar.time, bar);
    const next = payload.nextPage;
    if (!next || tokens.has(next) || !payload.bars.length) break;
    tokens.add(next); pageToken = next;
  } while (rows.size < plan.wanted && tokens.size < 10);
  if (epoch !== useAlpacaStore.getState().epoch) throw new Error("The IEX session changed during history loading.");
  const base = [...rows.values()].sort((a, b) => a.time - b.time).slice(-IEX_HISTORY_LIMIT);
  return { base, daily: plan.daily, bars: aggregateIexBars(base, timeframe).slice(-count) };
}
export interface IexStreamHost {
  credentials(): AlpacaCredentials;
  trade(value: IexTrade): void; bar(value: IexBar): void;
  status(value: "connecting" | "authenticated" | "reconnecting" | "error", message: string): void;
  subscription(symbols: string[], omitted: string[]): void;
  /** A reconnect invalidates candle continuity; minute messages cannot repair a disconnected interval. */
  gap(): void;
}
export class IexStream {
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private stopped = false; private epoch = 0; private attempts = 0; private authenticated = false;
  private desired: string[] = []; private sent: string[] = [];
  private seen = new Set<string>();
  constructor(private host: IexStreamHost, private factory: (url: string) => WebSocket = url => new WebSocket(url)) {}
  setSymbols(symbols: string[]) {
    const ordered = [...new Set(symbols)].filter(symbol => symbol.startsWith("IEX:"));
    this.desired = ordered.slice(0, 30).map(tickerOf);
    this.host.subscription(this.desired.map(symbol => `IEX:${symbol}`), ordered.slice(30)); this.sync();
  }
  private sync() {
    if (!this.authenticated || !this.socket || this.socket.readyState !== 1) return;
    const remove = this.sent.filter(symbol => !this.desired.includes(symbol)), add = this.desired.filter(symbol => !this.sent.includes(symbol));
    const send = (action: string, list: string[]) => { if (list.length) this.socket!.send(JSON.stringify({ action, trades: list, bars: list, updatedBars: list, dailyBars: list })); };
    send("unsubscribe", remove); send("subscribe", add); this.sent = [...this.desired];
  }
  start() {
    if (this.stopped || this.socket) return;
    const epoch = ++this.epoch; this.authenticated = false; this.sent = [];
    this.host.status(this.attempts ? "reconnecting" : "connecting", "");
    let socket: WebSocket;
    try { socket = this.factory("wss://stream.data.alpaca.markets/v2/iex"); } catch { this.schedule(epoch); return; }
    this.socket = socket;
    const current = () => !this.stopped && epoch === this.epoch && socket === this.socket;
    this.deadline = setTimeout(() => { if (current() && !this.authenticated) socket.close(); }, 12_000);
    socket.onopen = () => {
      if (!current()) return;
      try { const value = this.host.credentials(); socket.send(JSON.stringify({ action: "auth", key: value.key, secret: value.secret })); }
      catch { this.fail("Connect Alpaca IEX again to supply credentials."); }
    };
    socket.onmessage = event => {
      if (!current()) return;
      let messages: unknown; try { messages = JSON.parse(String(event.data)); } catch { return; }
      if (!Array.isArray(messages)) return;
      for (const raw of messages) {
        if (!current() || !raw || typeof raw !== "object") continue;
        const message = raw as Record<string, unknown>;
        if (message.T === "error") { this.fail(alpacaError(Number(message.code))); return; }
        if (message.T === "success" && message.msg === "authenticated") {
          if (this.deadline) clearTimeout(this.deadline); this.deadline = null;
          this.authenticated = true; this.attempts = 0; this.host.status("authenticated", ""); this.sync();
        }
        if (!this.authenticated || typeof message.S !== "string" || !this.desired.includes(message.S)) continue;
        const trade = parseIexTrade(message);
        if (trade) {
          const id = `${trade.symbol}:${trade.time}:${trade.id}`;
          if (!this.seen.has(id)) { this.seen.add(id); if (this.seen.size > 10_000) this.seen.delete(this.seen.values().next().value!); this.host.trade(trade); }
        }
        const bar = parseIexBar(message); if (bar) this.host.bar(bar);
      }
    };
    socket.onerror = () => { if (current()) socket.close(); };
    socket.onclose = () => { if (current()) { this.socket = null; this.authenticated = false; this.host.gap(); this.schedule(epoch); } };
  }
  private schedule(epoch: number) {
    if (this.stopped || epoch !== this.epoch) return;
    if (this.deadline) clearTimeout(this.deadline); this.deadline = null;
    this.host.status("reconnecting", "The IEX connection was interrupted. Candle history must reload after reconnect.");
    this.retry = setTimeout(() => { this.retry = null; if (!this.stopped && epoch === this.epoch) this.start(); }, Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5)));
  }
  private fail(message: string) { this.host.status("error", message); this.host.gap(); this.stop(); }
  stop() {
    this.stopped = true; this.epoch++; this.authenticated = false;
    this.seen.clear();
    if (this.retry) clearTimeout(this.retry); if (this.deadline) clearTimeout(this.deadline); this.retry = null; this.deadline = null;
    if (this.socket) { this.socket.onopen = this.socket.onmessage = this.socket.onclose = this.socket.onerror = null; this.socket.close(); this.socket = null; }
  }
}
