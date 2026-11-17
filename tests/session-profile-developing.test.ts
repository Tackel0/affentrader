import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import type { NativeIndicatorContext, RendererLayerArgs } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { buildSessionVolumeProfiles } from "@/lib/orderflow/volumeProfileModel";
import { defaultVolumeProfile, resolveVolumeProfile, volumeProfileInputs } from "@/lib/orderflow/volumeProfileSettings";
import { rollingProfileInputs, resolveRollingProfile } from "@/lib/orderflow/rollingProfile";
import { packSessionTrades, type SessionProfileRequest, type SessionProfileResponse, type SessionProfileExecutor } from "@/lib/orderflow/sessionProfileJobs";
import { sessionProfileDescriptor } from "@/lib/orderflow/volumeProfileIndicator";
import { paintVolumeProfiles, type VolumeProfileChannel } from "@/lib/orderflow/volumeProfileRenderer";
import { publishSessionProfileSurface, readSessionProfileSurfaces, clearSessionProfileSurface } from "@/lib/orderflow/sessionProfileReadout";

const start = Date.UTC(2026, 10, 4), minute = 60000, symbol = "KRK:BTC/USD";
const style = { ...defaultVolumeProfile(), rowSize: 1, showHistogram: false, showLabels: false, showPoc: false, showValueArea: false,
  showDevelopingPoc: true, showDevelopingValueArea: true, valueAreaPercent: 100 };
const tick = (id: string, offset: number, price: number, quantity = 1): Tick => ({ id, symbol, time: start + offset, price, quantity, side: "buy", simulated: false });
const trades = [tick("a", 1000, 100, 3), tick("b", 2000, 101), tick("c", minute + 1000, 102, 9), tick("d", minute + 1000, 100)];
const build = (input = trades, options = style, timeframe = "1m") => buildSessionVolumeProfiles(input, options, symbol, undefined, timeframe);

it("emits one cumulative point per observed candle after all equal-time trades", () => {
  expect(build().sessions[0].developing).toEqual([
    { time: start, through: start + minute, poc: 100.5, val: 100, vah: 102, volume: 4, executions: 2 },
    { time: start + minute, through: start + 2 * minute, poc: 102.5, val: 100, vah: 103, volume: 14, executions: 4 },
  ]);
});

it("matches an independent prefix histogram oracle on the common session grid", () => {
  const input = Array.from({ length: 400 }, (_, i) => tick(String(i), i * 17000, 100 + i % 13, i % 7 + 1));
  const session = build(input).sessions[0];
  for (const point of session.developing!) {
    const prefix = input.filter(t => t.time < point.through), totals = Array(session.rows.length).fill(0) as number[];
    for (const t of prefix) totals[Math.floor(t.price) - 100] += t.quantity;
    const maximum = Math.max(...totals), center = (totals.length - 1) / 2;
    const candidates = totals.map((value, index) => ({ value, index })).filter(v => v.value === maximum)
      .sort((a, b) => Math.abs(a.index - center) - Math.abs(b.index - center) || a.index - b.index);
    expect(point.poc).toBe(100.5 + candidates[0].index);
    expect(point.volume).toBe(prefix.reduce((sum, t) => sum + t.quantity, 0));
    expect(point.executions).toBe(prefix.length);
  }
});

it.each(["Day", "Week", "Month"] as const)("ends the %s path at the observed final profile levels", sessionPeriod => {
  const session = build(trades, { ...style, sessionPeriod }).sessions[0], point = session.developing!.at(-1)!;
  expect(point.poc).toBe(session.rowGrid![session.valueArea.poc].center);
  expect(point.val).toBe(session.rowGrid![session.valueArea.low].lower);
  expect(point.vah).toBe(session.rowGrid![session.valueArea.high].upper);
  expect(point.volume).toBe(session.valueArea.total);
});

it("uses only the revealed Replay prefix while allowing auto-grid rebins after later extrema", () => {
  const options = { ...style, rowSize: 0, rows: 2 };
  const initial = build([tick("a", 1000, 100)], options).sessions[0].developing![0];
  const later = build([tick("a", 1000, 100), tick("future", minute, 500, 1000)], options).sessions[0].developing!;
  expect(later[0].volume).toBe(1); expect(later[0].executions).toBe(1);
  expect(later[0].poc).not.toBe(initial.poc);
  expect(build([tick("a", 1000, 100)], options).sessions[0].developing![0]).toEqual(initial);
});

it("filters session windows, deduplicates and clamps buckets crossing a session boundary", () => {
  const options = { ...style, tradingHours: "Custom" as const, customStart: 1, customEnd: 3 };
  const model = build([tick("before", 0, 99), trades[2], trades[2], tick("last", 2 * minute, 101), tick("after", 3 * minute, 900)], options, "5m");
  expect(model.sessions[0].developing).toEqual([{ time: start + minute, through: start + 3 * minute,
    poc: 102.5, val: 101, vah: 103, volume: 10, executions: 2 }]);
});

it("keeps options independent and excludes developing controls from rolling profiles", () => {
  expect(resolveVolumeProfile({}).showDevelopingPoc).toBe(false);
  for (const key of ["showDevelopingPoc", "showDevelopingValueArea"] as const) {
    expect(volumeProfileInputs().find(i => i.key === key)).toMatchObject({ tab: "Style", defval: false });
    expect(rollingProfileInputs().some(i => i.key === key)).toBe(false);
    expect(resolveRollingProfile({ [key]: true })[key]).toBe(false);
  }
  expect(build(trades, { ...style, showDevelopingPoc: false }).sessions[0].developing).toHaveLength(2);
  expect(build(trades, { ...style, showDevelopingPoc: false, showDevelopingValueArea: false }).sessions[0].developing).toBeUndefined();
  expect(() => build(trades, style, "100T")).toThrow(/time-based/);
});

it("runs identical developing math in the shipped worker with the requested interval", () => {
  let result: SessionProfileResponse | undefined;
  const scope: { onmessage?: (event: { data: SessionProfileRequest }) => void; postMessage: (r: SessionProfileResponse) => void } = { postMessage(r) { result = r; } };
  runInNewContext(readFileSync("public/workers/session-profile.js", "utf8"), { self: scope, setTimeout, clearTimeout });
  scope.onmessage!({ data: { id: 1, values: packSessionTrades(trades), simulated: false, style, symbol, timeframe: "5m" } });
  expect(result?.error).toBeUndefined(); expect(result?.model).toEqual(build(trades, style, "5m"));
});

it("paints three independent dashed step paths bounded by the revealed chart", () => {
  const paths: { color: string; dash: number[]; path: number[] }[] = [], path: number[] = [];
  let dash: number[] = [];
  const ctx = { strokeStyle: "", save() {}, restore() {}, setLineDash(values: number[]) { dash = values; },
    beginPath() { path.length = 0; }, moveTo(...v: number[]) { path.push(...v); }, lineTo(...v: number[]) { path.push(...v); },
    stroke(this: { strokeStyle: string }) { paths.push({ color: this.strokeStyle, dash: [...dash], path: [...path] }); } } as unknown as CanvasRenderingContext2D;
  const args = { bars: [{ time: start }, { time: start + minute }], coords: { width: 500, timeToX: (t: number) => (t - start) / minute,
    priceToY: (p: number) => p }, bounds: { top: 0, height: 300 }, theme: {}, scale: {} } as unknown as RendererLayerArgs;
  paintVolumeProfiles(ctx, args, { style, model: build() }, () => true);
  expect(paths).toHaveLength(3); expect(paths.every(p => JSON.stringify(p.dash) === "[4,3]")).toBe(true);
  expect(paths[0]).toEqual({ color: style.pocColor, dash: [4, 3], path: [0, 101.5, 1, 101.5, 1, 103.5, 2, 103.5] });
  paths.length = 0;
  paintVolumeProfiles(ctx, args, { style: { ...style, showDevelopingPoc: false }, model: build() }, () => true);
  expect(paths).toHaveLength(2);
  paths.length = 0; paintVolumeProfiles(ctx, args, { style, model: build(), kind: "rolling" }, () => true);
  expect(paths).toHaveLength(0);
});

it("fences worker results after developing switches and interval changes", () => {
  const requests: { complete: (r: SessionProfileResponse) => void; timeframe?: string }[] = [];
  const jobs: SessionProfileExecutor = { cancel: vi.fn(), submit(_o, _t, _s, _m, complete, _c, timeframe) { requests.push({ complete, timeframe }); } };
  let channel: VolumeProfileChannel | undefined;
  const context = { id: "dev", symbol, timeframe: "1m", live: true, emit() {}, setStatus() {},
    pushData(value: VolumeProfileChannel) { channel = value; } } as unknown as NativeIndicatorContext;
  const input = Array.from({ length: 1001 }, (_, i) => tick(String(i), i * 1000, 100));
  const instance = sessionProfileDescriptor(() => input, undefined, jobs).create(); instance.start(context, style);
  expect(requests[0].timeframe).toBe("1m");
  (context as { timeframe: string }).timeframe = "5m"; instance.onBars();
  expect(requests[1].timeframe).toBe("5m");
  requests[0].complete({ id: 1, model: build() }); expect(channel?.current?.model).toBeUndefined();
  instance.setInputs({ ...style, showDevelopingPoc: false, showDevelopingValueArea: false });
  expect(channel?.current?.model?.sessions[0].developing).toBeUndefined();
  requests[1].complete({ id: 2, model: build() }); expect(channel?.current?.model?.sessions[0].developing).toBeUndefined();
  instance.stop();
});

it("explains the selected candle's cumulative prefix and rebinnable grid in the data window", () => {
  const token = Symbol(), context = { id: "dev", symbol, timeframe: "1m", epoch: 0, live: true };
  publishSessionProfileSurface("developing-test", token, { context, payload: { style, model: build() } });
  try {
    const rows = readSessionProfileSurfaces("developing-test", { ...context, replay: false }, start, ["dev"])[0].rows;
    expect(rows).toContainEqual({ label: "Developing POC", value: "100.5" });
    expect(rows).toContainEqual({ label: "Developing candle volume (cumulative)", value: "4" });
    expect(rows.find(row => row.label === "Developing basis")?.value).toContain("rebin earlier points");
  } finally { clearSessionProfileSurface("developing-test", token); }
});
