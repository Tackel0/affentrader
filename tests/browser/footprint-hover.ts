import { Vela, registerChartType, registerRendererLayer, type OHLCV, type RendererLayerArgs } from "@luxalgo/vela";
import { defaultFootprint, footprintBarGeometry, paintFootprintBar } from "@/lib/orderflow/footprint";
import { footprintDisplayBar } from "@/lib/orderflow/footprintCells";
import { footprintHoverModifier, paintFootprintHover } from "@/lib/orderflow/footprintHover";
import { createFootprintMagnifierSurface } from "@/lib/orderflow/footprintMagnifierSurface";
import { FOOTPRINT_MODES } from "@/lib/orderflow/footprintModes";
import { footprints } from "@/lib/orderflow/math";
import type { Tick } from "@/types/trading";
const start = Date.UTC(2026, 10, 4, 12), minute = 60000;
const bars: OHLCV[] = Array.from({ length: 4 }, (_, i) => ({ time: start + i * minute, open: 100, close: 104, low: 100, high: 110, volume: 100 }));
const raw = footprints(bars.flatMap((bar, i) => [100, 101, 102, 104, 110].flatMap((price, row) => ["buy", "sell"].map((side, j): Tick => ({ id: `${i}/${row}/${j}`, symbol: "HOVER-FIXTURE", time: bar.time + row * 2 + j + 1, price, quantity: row === 4 ? 100 : side === "buy" ? 8 : 2, side: side as "buy" | "sell", tradeCount: row === 2 ? undefined : side === "buy" ? 2 : 1, simulated: true })))), "1m", 1);
let mode = 0, focus: "hover" | "magnifier" | "pointer" = "magnifier", filtered = false, average = false, transitions = 0;
let redraw = () => {};
registerChartType({ id: "footprint", label: "Footprint", basePainting: "none" });
registerRendererLayer({ id: "footprint", placement: "above-data", repaintOnCursor: true, create: () => {
  let canvas: HTMLCanvasElement | undefined, last: RendererLayerArgs | undefined;
  const magnifier = createFootprintMagnifierSurface();
  const modifier = footprintHoverModifier(() => { magnifier.clear(); transitions++; if (last) render(last); });
  const render = (args: RendererLayerArgs) => {
    magnifier.clear(); last = args; const ctx = canvas?.getContext("2d"); if (!ctx || !canvas) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.scale(args.coords.dpr, args.coords.dpr);
    const style = { ...defaultFootprint(), rowSize: 1, volumeMode: FOOTPRINT_MODES[mode], candleVisible: false, valueAreaVisible: false, averageTradeSize: average, maxVolume: filtered ? 5 : 0 };
    const prints = raw.map(bar => footprintDisplayBar(bar, 1, style));
    for (const bar of prints) paintFootprintBar(ctx, args, bar, undefined, 1, style);
    const onScreen = (bar: typeof prints[number]) => { const g = footprintBarGeometry(args, bar.time); return g.center >= 0 && g.center < args.coords.width; };
    const selected = onScreen(prints[1]) ? prints[1] : prints.find(onScreen) ?? prints.at(-1)!, geometry = footprintBarGeometry(args, selected.time);
    const cursor = focus === "pointer" ? args.cursor : { x: geometry.center, y: args.coords.priceToY(102.5, args.scale, args.bounds) };
    const hit = paintFootprintHover(ctx, { ...args, cursor }, [{ id: "fp1", label: "Footprint 1", bars: prints, step: 1, style }], focus === "magnifier" || modifier.shift, undefined, magnifier);
    document.querySelector("#status")!.textContent = `SIMULATED · ${FOOTPRINT_MODES[mode]} · ${focus} · ${hit ? `Row [${hit.lower},${hit.upper})${hit.bar.levels[hit.row].filtered ? " · display filtered; raw observations" : ""}` : "No observed row"} · ${average ? "Mean" : "Raw"} · Shift ${modifier.shift} · modifier transitions ${transitions}`;
  };
  redraw = () => { if (last) render(last); };
  return { mount(value) { canvas = value; modifier.mount(value); magnifier.mount(value); }, render, destroy() { magnifier.destroy(); modifier.destroy(); } };
} });
document.querySelector<HTMLElement>("#chart")!.dataset.velaCell = "true";
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "HOVER-FIXTURE", timeframe: "1m", live: false, bars: 4, priceStyle: "footprint", theme: "light", volume: false, drawings: { toolbar: false }, animations: { intro: false } }, { dataFeed: { load: async cfg => cfg.data ?? bars, subscribe: () => () => {} } });
void chart.ready().then(async () => { await chart.historyComplete(); chart.setVisibleRange({ from: start - minute, to: start + 4 * minute });
  for (const id of ["hover", "magnifier", "pointer", "mode", "filter", "average"] as const) { const button = document.querySelector<HTMLButtonElement>(`#${id}`)!; button.disabled = false; button.onclick = () => { if (id === "mode") mode = (mode + 1) % FOOTPRINT_MODES.length; else if (id === "filter") filtered = !filtered; else if (id === "average") average = !average; else focus = id; redraw(); }; }
});
