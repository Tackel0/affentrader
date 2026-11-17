import { Vela, registerChartType, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { defaultFootprint, footprintSettings, paintFootprintBar, resolveFootprint } from "@/lib/orderflow/footprint";
import { FOOTPRINT_MODES, footprintModeTitle } from "@/lib/orderflow/footprintModes";
import { footprintDisplayBar } from "@/lib/orderflow/footprintCells";
import { footprints } from "@/lib/orderflow/math";
import type { Tick } from "@/types/trading";
const start = Date.UTC(2026, 10, 5, 12), minute = 60000;
const bars: OHLCV[] = FOOTPRINT_MODES.map((_, i) => ({ time: start + i * minute, low: 98, high: 103, open: 99, close: 102, volume: 16 }));
const tape = bars.flatMap((bar, i) => ([[99, 2, "sell"], [100, 6, "buy"], [100, 6, "sell"], [101, 2, "buy"]] as const).map(([price, quantity, side], j): Tick => ({ id: `${i}:${j}`, symbol: "HIGHLIGHT-FIXTURE", time: bar.time + j + 1, price, quantity, side, tradeCount: 1, simulated: true })));
registerChartType({ id: "footprint", label: "Footprint", basePainting: "none", settings: footprintSettings() });
registerRendererLayer({ id: "footprint", placement: "above-data", create: () => {
  let canvas: HTMLCanvasElement | undefined;
  return { mount(value) { canvas = value; }, render(args) {
    const ctx = canvas?.getContext("2d"); if (!ctx || !canvas) return;
    const style = resolveFootprint(args.settings), raw = footprints(tape, "1m", 1, style.imbalanceRatio);
    ctx.setTransform(args.coords.dpr, 0, 0, args.coords.dpr, 0, 0); ctx.clearRect(0, 0, canvas.width / args.coords.dpr, canvas.height / args.coords.dpr);
    let flags = 0;
    for (const [i, bar] of raw.entries()) {
      const shown = footprintDisplayBar(bar, 1, style); flags += shown.levels.filter(r => r.buyImbalance).length + shown.levels.filter(r => r.sellImbalance).length;
      paintFootprintBar(ctx, args, shown, undefined, 1, { ...style, volumeMode: FOOTPRINT_MODES[i], candleVisible: false, pocVisible: false, valueAreaVisible: false }, { width: args.coords.pxPerBar() * .8, offset: 0, within: true });
      ctx.fillStyle = args.theme.textColor; ctx.font = "11px Arial"; ctx.textAlign = "center";
      ctx.fillText(footprintModeTitle(FOOTPRINT_MODES[i]), args.coords.timeToX(bar.time), args.bounds.top + 25, args.coords.pxPerBar() - 8);
    }
    document.querySelector("#status")!.textContent = `SIMULATED · outlines=${style.imbalanceVisible ? "on" : "off"} · tint=${style.imbalanceRecolor ? "on" : "off"} · width=${style.imbalanceWidth} · ratio=${style.imbalancePercent}% · side flags=${flags}`;
  } };
} });
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "HIGHLIGHT-FIXTURE", timeframe: "1m", live: false, priceStyle: "footprint", theme: "light", volume: false, drawings: { toolbar: false }, animations: { intro: false } }, { dataFeed: { load: async cfg => cfg.data ?? bars, subscribe: () => () => {} } });
void chart.ready().then(async () => { await chart.historyComplete();
  const comparison = () => chart.renderer.applyConfig({ chartTypes: { footprint: { ...defaultFootprint(), imbalanceVisible: true, imbalanceRecolor: true, imbalanceWidth: 4, imbalanceAskColor: "#284baf", imbalanceBidColor: "#e08214", imbalanceTextAskColor: "#9c27b0", imbalanceTextBidColor: "#008c95" } } });
  comparison(); chart.setVisibleRange({ from: start - minute, to: start + 5 * minute });
  document.querySelector<HTMLButtonElement>("#settings")!.onclick = () => chart.renderer.openSettings("Footprint");
  document.querySelector<HTMLButtonElement>("#restore")!.onclick = comparison;
});
