import { bucketStart } from "./intervals";
import type { OHLCV } from "@/types/trading";

const SILENCE = 20000, EVIDENCE_AGE = 10000, CONFIRMATION = 5000, MAX_CHANNELS = 1000;
interface Channel {
  symbol: string; timeframe: string; requestedAt: number; candleAt?: number;
  candle?: { time: number; count: number }; executionEvidenceAt?: number;
  missingCandlesSince?: number; missingTradesSince?: number;
  probeAt?: number;
}
export interface HyperliquidChannelIssue { key: string; symbol: string; missing: "candle" | "trades"; message: string }
/** Activity evidence, not a claim that a quiet market must continuously trade. */
export class HyperliquidChannelHealth {
  private channels = new Map<string, Channel>();
  private trades = new Map<string, number>();
  reset() { this.channels.clear(); this.trades.clear(); }
  watch(key: string, symbol: string, timeframe: string, now: number) {
    if (this.channels.has(key) || this.channels.size >= MAX_CHANNELS) return;
    this.channels.set(key, { symbol, timeframe, requestedAt: now });
  }
  trade(symbol: string, eventTime: number, receivedAt: number) {
    if (!Number.isFinite(eventTime) || !Number.isFinite(receivedAt) || eventTime > receivedAt + 1000 || receivedAt - eventTime > EVIDENCE_AGE) return;
    if (!this.trades.has(symbol) && this.trades.size >= MAX_CHANNELS) return;
    this.trades.set(symbol, receivedAt);
  }
  candle(key: string, time: number, count: number, receivedAt: number) {
    const channel = this.channels.get(key);
    if (!channel || !Number.isSafeInteger(count) || count < 0 || !Number.isFinite(receivedAt) || time !== bucketStart(channel.timeframe, receivedAt)) return;
    const previous = channel.candle;
    if (previous && (time > previous.time && count > 0 || time === previous.time && count > previous.count)) channel.executionEvidenceAt = receivedAt;
    channel.candle = { time, count }; channel.candleAt = receivedAt; channel.missingCandlesSince = undefined;
  }
  check(now: number): HyperliquidChannelIssue | null {
    const fresh = (at: number | undefined) => at !== undefined && at <= now && now - at <= EVIDENCE_AGE;
    for (const [key, channel] of this.channels) {
      const tradeAt = this.trades.get(channel.symbol);
      if (fresh(tradeAt) && now - (channel.candleAt ?? channel.requestedAt) > SILENCE) {
        channel.missingCandlesSince ??= now;
        if (now - channel.missingCandlesSince >= CONFIRMATION) return { key, symbol: channel.symbol, missing: "candle", message: "Native candle channel is silent while recent classified executions continue." };
      } else channel.missingCandlesSince = undefined;
      if (fresh(channel.executionEvidenceAt) && now - (tradeAt ?? channel.requestedAt) > SILENCE) {
        channel.missingTradesSince ??= now;
        if (now - channel.missingTradesSince >= CONFIRMATION) return { key, symbol: channel.symbol, missing: "trades", message: "Classified trade channel is silent while current candle execution counts increase." };
      } else channel.missingTradesSince = undefined;
    }
    return null;
  }
  isQuiet(key: string, now: number): boolean {
    const channel = this.channels.get(key);
    return !!channel && now - Math.max(channel.requestedAt, channel.candleAt ?? 0, this.trades.get(channel.symbol) ?? 0) > 45000;
  }
  quietCandidates(now: number): string[] {
    return [...this.channels].filter(([key, channel]) => this.isQuiet(key, now) && (channel.probeAt === undefined || now - channel.probeAt >= 60000)).map(([key]) => key);
  }
  probing(key: string, now: number) { const channel = this.channels.get(key); if (channel) channel.probeAt = now; }
}

/** Only source-confirmed traded data proves a native stream fell behind. */
export function hyperliquidStreamBehind(current: OHLCV | undefined, observed: readonly OHLCV[], now: number): boolean {
  if (!current) return false;
  return observed.some(bar => [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) && bar.time <= now && bar.volume > 0 &&
    bar.low > 0 && bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close) &&
    (bar.time > current.time || bar.time === current.time && bar.volume >= current.volume &&
      (bar.volume > current.volume || bar.open !== current.open || bar.high !== current.high || bar.low !== current.low || bar.close !== current.close)));
}
