import type { RendererLayerArgs } from "@luxalgo/vela";
import { defaultFootprint, footprintTextPlan, paintFootprintBar } from "@/lib/orderflow/footprint";
import type { FootprintBar, FootprintVolumeMode } from "@/types/trading";
import { footprintDisplayBar, type FootprintCellValues } from "@/lib/orderflow/footprintCells";
import { footprintRows } from "@/lib/orderflow/math";
declare global { interface Window { footprintReference: { paint: (...args: unknown[]) => void; plan: (...args: unknown[]) => number | null; prepare: (...args: unknown[]) => { rows: unknown[] } }; footprintReferenceHash: string } }
interface Variant { average: boolean; gradient: boolean; split: boolean; value: FootprintCellValues; auto: boolean; fit: boolean; size: number; filter: number; percent: number; va: boolean; poc: boolean; area: boolean; stroke: number; recolor: boolean }
interface Scenario { mode: FootprintVolumeMode; refMode: string; width: number; height: number; opacity: number; light: boolean; highlight: boolean; variant?: Variant }
const modes = [["bid-ask", "bidAskProfile"], ["bid-ask-ladder", "bidAskLadder"], ["total", "volume"], ["delta", "delta"], ["absolute-delta", "deltaAbs"]] as const;
const scenarios: Scenario[] = [];
for (const [mode, refMode] of modes) for (const width of [9, 10, 21, 22, 40, 80, 160]) for (const height of [1, 3, 13, 14, 19, 39]) for (const opacity of [.59, .6, 1]) for (const light of [false, true]) for (const highlight of [false, true]) scenarios.push({ mode, refMode, width, height, opacity, light, highlight });
let seed = 20261105; const choose = <T,>(values: readonly T[]): T => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return values[(seed >>> 8) % values.length]; }, bool = () => choose([false, true]);
for (let i = 0; i < 2000; i++) { const [mode, refMode] = choose(modes); scenarios.push({ mode, refMode, width: choose([9, 10, 21, 22, 40, 80, 160]), height: choose([1, 3, 13, 14, 19, 39]), opacity: choose([.02, .59, .6, 1]), light: bool(), highlight: bool(), variant: { average: bool(), gradient: bool(), split: bool(), value: choose(["auto", "bid-ask", "total", "delta", "trades", "bid-ask-trades"]), auto: bool(), fit: bool(), size: choose([6, 11, 24, 40]), filter: choose([0, 10, -5000, 20000]), percent: choose([1, 70, 100]), va: bool(), poc: bool(), area: bool(), stroke: choose([1, 2, 4, 10]), recolor: bool() } }); }
const refCanvas = document.querySelector<HTMLCanvasElement>("#reference")!, appCanvas = document.querySelector<HTMLCanvasElement>("#actual")!;
const reference = window.footprintReference;
function render(test: Scenario) {
  const a = appCanvas.getContext("2d", { willReadFrequently: true })!, r = refCanvas.getContext("2d", { willReadFrequently: true })!;
  for (const c of [appCanvas, refCanvas]) c.width = 400;
  const background = test.light ? "#ffffff" : "#131722", ink = test.light ? "#2a2e39" : "#d1d4dc";
  for (const ctx of [a, r]) { ctx.fillStyle = background; ctx.fillRect(0, 0, 400, 260); }
  const levels = [
    { price: 100, upperPrice: 101, buyVolume: 12345, sellVolume: 1000, buyCount: 3, sellCount: 2, buyImbalance: true, sellImbalance: false, imbalance: null },
    { price: 101, upperPrice: 102, buyVolume: 0, sellVolume: 2000, buyCount: 0, sellCount: 4, buyImbalance: false, sellImbalance: true, imbalance: null },
    { price: 103, upperPrice: 104, buyVolume: 12, sellVolume: 0, buyCount: 4, sellCount: 0, buyImbalance: true, sellImbalance: false, imbalance: null },
    { price: 104, upperPrice: 105, buyVolume: 100, sellVolume: 100, buyCount: 5, sellCount: 2, buyImbalance: true, sellImbalance: true, imbalance: null },
  ];
  const v = test.variant;
  const style = { ...defaultFootprint(), volumeMode: test.mode, candleVisible: false, statisticsVisible: false, areaBackground: v?.area ?? true, areaBackgroundColor: "#8899aa20", textColor: v ? "#556677cc" : ink, textColorAuto: false, imbalanceVisible: test.highlight, imbalanceRecolor: v?.recolor ?? test.highlight, imbalanceWidth: v?.stroke ?? 2, valueAreaVisible: v?.va ?? true, valueAreaPercent: v?.percent ?? 70, valueAreaColor: "#3344aacc", valueAreaWidth: v?.stroke ?? 1, valueAreaBackground: "#11223320", pocVisible: v?.poc ?? true, pocColor: "#8899aaff", pocWidth: v?.stroke ?? 1, averageTradeSize: v?.average ?? false, volumeSplit: v?.split ?? true, gradientCells: v?.gradient ?? true, monoLowColor: "#223344cc", monoHighColor: "#aabbcc80", cellValues: v?.value ?? "auto", textAutoSize: v?.auto ?? true, textFit: v?.fit ?? false, textSize: v?.size ?? 11, minVolume: v && v.filter > 0 ? v.filter : 0, maxVolume: v && v.filter < 0 ? -v.filter : 0 };
  let bar: FootprintBar = { time: 0, volume: 15557, delta: 9357, poc: 100, levels };
  if (v) bar = footprintDisplayBar(footprintRows(0, new Map(levels.map(l => [l.price, { ...l, rowIndex: l.price }])), 3), 1, style);
  const yOf = (p: number) => 20 + (105 - p) * (test.height + 1), left = 200 - test.width / 2, right = 200 + test.width / 2;
  const args = { coords: { width: 400, pxPerBar: () => 200, timeToX: () => 200, priceToY: yOf }, bounds: { top: 0, height: 260 }, scale: {}, theme: { background, textColor: ink, fontFamily: "Arial" } } as unknown as RendererLayerArgs;
  const placement = { width: test.width, offset: 0, within: true, opacity: test.opacity };
  const plan = footprintTextPlan(a, args, [bar], 1, style, placement);
  paintFootprintBar(a, args, bar, undefined, 1, style, placement, undefined, undefined, plan);
  let refRows: unknown[] = levels.map(l => ({ price: l.price, buy: l.buyVolume, sell: l.sellVolume, total: l.buyVolume + l.sellVolume, delta: l.buyVolume - l.sellVolume, buyVol: l.buyVolume, sellVol: l.sellVolume, buyN: l.buyCount, sellN: l.sellCount, visible: true, askImb: l.buyImbalance, bidImb: l.sellImbalance }));
  const valueNames = { auto: "auto", "bid-ask": "bidAsk", total: "volume", delta: "delta", trades: "trades", "bid-ask-trades": "bidAskTrades" };
  const refStyle = { mode: test.refMode, avgTradeSize: style.averageTradeSize, displayValue: valueNames[style.cellValues], volumeDual: style.volumeSplit, colors: { bid: style.bidColor, ask: style.askColor, buy: style.volumeBuyColor, sell: style.volumeSellColor, deltaUp: style.deltaUpColor, deltaDown: style.deltaDownColor, monoLow: style.monoLowColor, monoHigh: style.monoHighColor, gradient: style.gradientCells },
    text: { autoSize: style.textAutoSize, sizePx: style.textSize, color: style.textColor, fitText: style.textFit }, imbalance: { show: test.highlight, ratio: 300, stacked: false, width: style.imbalanceWidth, askColor: style.imbalanceAskColor, bidColor: style.imbalanceBidColor, highlightText: style.imbalanceRecolor, textAskColor: style.imbalanceTextAskColor, textBidColor: style.imbalanceTextBidColor }, valueArea: { show: style.valueAreaVisible, percent: style.valueAreaPercent, color: style.valueAreaColor, background: style.valueAreaBackground, width: style.valueAreaWidth }, poc: { show: style.pocVisible, color: style.pocColor, width: style.pocWidth }, areaBackground: { show: style.areaBackground, color: style.areaBackgroundColor }, filter: { minVolume: style.minVolume || null, maxVolume: style.maxVolume || null, minBidVolume: null, maxBidVolume: null, minAskVolume: null, maxAskVolume: null } };
  let refBar: unknown = { rows: refRows, maxSide: 12345, maxTotal: 13345, maxAbsDelta: 11345, pocPrice: 100, valPrice: 100, vahPrice: 101 };
  if (v) { const prepared = reference.prepare(levels, 1, refStyle); refBar = prepared; refRows = prepared.rows; }
  const slot = { x0: left, x1: right, axisX: 200 }, geom = { yOf, tick: 1 };
  const refPlan = reference.plan(r, refStyle, refRows, slot, geom, "Arial"); reference.paint(r, slot, refBar, refStyle, geom, args.theme, test.opacity, refPlan);
  const actual = a.getImageData(0, 0, 400, 260).data, expected = r.getImageData(0, 0, 400, 260).data;
  let pixels = 0, maximumChannelDifference = 0;
  for (let i = 0; i < actual.length; i += 4) { let delta = 0; for (let c = 0; c < 4; c++) delta = Math.max(delta, Math.abs(actual[i + c] - expected[i + c])); if (delta) pixels++; maximumChannelDifference = Math.max(maximumChannelDifference, delta); }
  return { pixels, maximumChannelDifference, plan, refPlan };
}
let failures: Array<{ scenario: Scenario; result: ReturnType<typeof render> }> = [], cursor = 0;
async function run() {
  const runButton = document.querySelector<HTMLButtonElement>("#run")!; runButton.disabled = true; failures = []; let tested = 0;
  for (const scenario of scenarios) {
    const result = render(scenario); if (result.pixels || result.plan !== result.refPlan) failures.push({ scenario, result }); tested++;
    if (tested % 20 === 0) { document.querySelector("#status")!.textContent = `Running ${tested}/${scenarios.length}; differing cases ${failures.length}`; await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }
  }
  const report = { checkedAt: new Date().toISOString(), sourceHash: window.footprintReferenceHash, tested, matching: tested - failures.length, differing: failures.length, firstDifferences: failures.slice(0, 30), scope: "Real Canvas RGBA equality:2520 exhaustive default per-profile cases plus2000 reproducible seeded extended cases including all six cell-value choices, raw/mean sizes, min/max filters, actual reference row preparation, independently toggled VA/POC/area/highlight/recolor, split/mono, gradient, manual/Auto/fitting, widths/strokes/row heights/opacities/themes. Excludes side candles, stats, projections, hover, inverted axes, unknown-count reference fallback and source/history equivalence." };
  document.querySelector("#report")!.textContent = JSON.stringify(report, null, 2); document.querySelector("#status")!.textContent = `Complete ${tested}; matching ${report.matching}; differing ${report.differing}`; cursor = 0; if (failures.length) render(failures[0].scenario); runButton.disabled = false;
}
document.querySelector<HTMLButtonElement>("#run")!.onclick = () => void run();
document.querySelector<HTMLButtonElement>("#next")!.onclick = () => { if (!failures.length) return; const item = failures[++cursor % failures.length]; render(item.scenario); document.querySelector("#status")!.textContent = JSON.stringify(item); };
render({ mode: "bid-ask", refMode: "bidAskProfile", width: 160, height: 39, opacity: 1, light: true, highlight: true });
document.querySelector("#status")!.textContent = `Ready: ${scenarios.length} real Canvas cases`;
