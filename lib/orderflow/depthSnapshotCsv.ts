import type { DepthLevel } from "@/types/trading";
import { providerOf } from "@/lib/symbolId";

export const DEPTH_PREVIEW_LEVELS = 6;

export function depthSnapshotCsv(
  book: { bids: readonly DepthLevel[]; asks: readonly DepthLevel[] },
  metadata: { symbol: string; snapshotTime: number; observedAt?: number; replayThrough?: number; pausedAt?: number },
) {
  const iso = (time: number | undefined) => time === undefined ? "" : new Date(time).toISOString();
  const source = metadata.replayThrough === undefined ? "live" : "recorded_replay";
  const clock = providerOf(metadata.symbol) === "hyperliquid" ? "venue" : "local_receipt";
  const prefix = [metadata.symbol, source, iso(metadata.snapshotTime), clock, iso(metadata.observedAt), iso(metadata.replayThrough)];
  const rows = [["symbol", "source", "snapshot_utc", "snapshot_clock", "archive_received_utc", "replay_before_utc", "side", "rank", "price", "quantity", "view_paused_utc"]];
  for (const [side, levels] of [["bid", book.bids], ["ask", book.asks]] as const) {
    levels.slice(0, DEPTH_PREVIEW_LEVELS).forEach((level, index) => {
      rows.push([...prefix, side, String(index + 1), String(level.price), String(level.quantity), iso(metadata.pausedAt)]);
    });
  }
  return rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
}
