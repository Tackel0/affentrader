import { nextBucket } from "@/lib/market/intervals";
import type { DepthHeatmapCell } from "./depthHeatmap";
import type { DepthHeatmapChannel } from "./depthHeatmapIndicator";

type Identity = NonNullable<DepthHeatmapChannel["identity"]>;
interface DepthSurface {
  owner: DepthHeatmapChannel;
  identity: Identity;
  cells: readonly DepthHeatmapCell[];
}
const surfaces = new Map<string, DepthSurface>();

export const depthSourceKey = (epoch: number, mode: string, source: string | undefined) =>
  JSON.stringify([epoch, mode, source]);

export function publishDepthSurface(cell: string, surface: DepthSurface) {
  surfaces.set(cell, surface);
}

export function clearDepthSurface(cell: string, owner: DepthHeatmapChannel) {
  if (surfaces.get(cell)?.owner === owner) surfaces.delete(cell);
}

export function depthHeatmapReadout(
  cell: string, identity: Identity, candleTime: number, price: number,
) {
  const surface = surfaces.get(cell);
  if (!surface || !Number.isFinite(candleTime) || !Number.isFinite(price) || !identity.live && identity.replayThrough === null) return undefined;
  const drawn = surface.identity;
  if (drawn.symbol !== identity.symbol || drawn.timeframe !== identity.timeframe ||
    drawn.live !== identity.live || drawn.source !== identity.source || drawn.replayThrough !== identity.replayThrough) return undefined;
  const end = Math.min(nextBucket(identity.timeframe, candleTime), identity.replayThrough ?? Infinity);
  // Find the last row strictly before the candle or Replay boundary.
  let lo = 0, hi = surface.cells.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (surface.cells[mid].from < end) lo = mid + 1;
    else hi = mid;
  }
  const index = lo - 1;
  const latest = surface.cells[index];
  if (!latest || latest.from < candleTime) return null;
  let lowest = Infinity, highest = -Infinity;
  let topBid: DepthHeatmapCell | undefined, topAsk: DepthHeatmapCell | undefined;
  // The heatmap model emits each snapshot's rows contiguously in receipt order.
  for (let i = index; i >= 0 && surface.cells[i].from === latest.from; i--) {
    const row = surface.cells[i];
    if (price >= row.lower && price < row.upper) {
      return { receivedAt: row.from, displayedUntil: Math.min(row.to, end), lower: row.lower, upper: row.upper, bid: row.bid, ask: row.ask };
    }
    lowest = Math.min(lowest, row.lower);
    highest = Math.max(highest, row.upper);
    if (row.bid > 0 && (!topBid || row.lower > topBid.lower)) topBid = row;
    if (row.ask > 0 && (!topAsk || row.lower < topAsk.lower)) topAsk = row;
  }
  return { receivedAt: latest.from, lowest, highest, topBid, topAsk, bid: undefined, ask: undefined };
}
