import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { buildTpoSessions } from "@/lib/orderflow/tpoModel";
import { defaultTpo } from "@/lib/orderflow/tpoSettings";
import { paintTpoSessions } from "@/lib/orderflow/tpoRenderer";
import { tpoSessionLayout } from "@/lib/orderflow/tpoLayout";
import { tpoCellAtPoint } from "@/lib/orderflow/tpoHover";
import { tpoSessionHit } from "@/lib/orderflow/tpoSessionMenu";
const duration = 3600000, bar = { time: 0, open: 100, high: 102, low: 99, close: 101, volume: 1 };
const style = { ...defaultTpo(), sessionMinutes: 60, rowSize: 1, candlesVisible: false }, sessions = buildTpoSessions([bar], style, "15m");
function args(width: number, invert: boolean): RendererLayerArgs {
  return { bars: [bar], bounds: { top: 0, height: 500 }, scale: {}, theme: { textColor: "#000", upColor: "#0f0", downColor: "#f00" }, priceStyle: "tpo", cursor: null,
    coords: { width: 1000, timeToX: (t: number) => 100 + t / duration * width, priceToY: (p: number) => invert ? p * 2 : 400 - p * 2, pxPerBar: () => 1, visibleTimeRange: () => ({ from: 0, to: duration }) } } as unknown as RendererLayerArgs;
}
it.each([false, true])("paints compressed range/VA/POC rails on an inverted=%s scale with truthful hit testing", invert => {
  const boxes: number[][] = [], ctx = { save() {}, restore() {}, fillRect: (...p: number[]) => boxes.push(p) } as unknown as CanvasRenderingContext2D;
  const frame = args(5, invert); paintTpoSessions(ctx, frame, sessions, style);
  expect(boxes).toHaveLength(3); expect(boxes.every(box => box[2] > 0 && box[3] > 0)).toBe(true);
  const y = frame.coords.priceToY(101, frame.scale, frame.bounds);
  expect(tpoCellAtPoint(frame, sessions, style, 102.5, y)).toBeNull();
  expect(tpoSessionHit({ args: frame, sessions, style, symbol: "BTCUSDT", timeframe: "15m" }, 102.5, y)).toBe(0);
  expect(tpoSessionLayout(args(13.9, invert), sessions[0], style).rail).toBe(true);
  expect(tpoSessionLayout(args(14, invert), sessions[0], style).rail).toBe(false);
});
it("keeps host candle painting separate from the profile's independent source candles", () => {
  const boxes: number[][] = [], ctx = { save() {}, restore() {}, fillRect: (...p: number[]) => boxes.push(p), beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} } as unknown as CanvasRenderingContext2D;
  const frame = args(5, false); frame.bars = [bar, { ...bar, time: 900000 }];
  paintTpoSessions(ctx, frame, sessions, { ...style, candlesVisible: true }, undefined, [bar]);
  expect(boxes).toHaveLength(4); // Three profile rail bands, one actual host candle.
});
