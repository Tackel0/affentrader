import { Vela, registerChartType, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { defaultFootprint, footprintSettings, paintFootprintBar, resolveFootprint } from "@/lib/orderflow/footprint";
import { footprints } from "@/lib/orderflow/math";
import type { Tick, FootprintVolumeMode } from "@/types/trading";
const modes: FootprintVolumeMode[] = ["bid-ask", "bid-ask-ladder", "total", "total", "delta", "absolute-delta"], labels = ["Bid × Ask", "Ladder", "Volume split", "Volume mono", "Delta", "Absolute Delta"];
const start = Date.UTC(2026, 10, 5, 12), minute = 60000;
const bars: OHLCV[] = modes.map((_, i) => ({ time: start + i * minute, low: 98, high: 103, open: 99, close: 102, volume: 22 }));
const tape = bars.flatMap((bar, i) => ([[99, 6, "sell"], [100, 6, "buy"], [100, 2, "sell"], [101, 8, "buy"]] as const).map(([price, quantity, side], j): Tick => ({ id: `${i}:${j}`, symbol: "PALETTE-FIXTURE", time: bar.time + j + 1, price, quantity, side, tradeCount: 1, simulated: true })));
const prints = footprints(tape, "1m", 1);
registerChartType({ id: "footprint", label: "Footprint", basePainting: "none", settings: footprintSettings() });
registerRendererLayer({ id: "footprint", placement: "above-data", create: () => {
  let canvas: HTMLCanvasElement | undefined;
  return { mount(value) { canvas = value; }, render(args) {
    const ctx = canvas?.getContext("2d"); if (!ctx || !canvas) return;
    const style = resolveFootprint(args.settings);
    ctx.setTransform(args.coords.dpr, 0, 0, args.coords.dpr, 0, 0); ctx.clearRect(0, 0, canvas.width / args.coords.dpr, canvas.height / args.coords.dpr);
    prints.forEach((bar, i) => {
      paintFootprintBar(ctx, args, bar, undefined, 1, { ...style, volumeMode: modes[i], volumeSplit: i !== 3, candleVisible: false, pocVisible: false, valueAreaVisible: false }, { width: args.coords.pxPerBar() * .8, offset: 0, within: true });
      ctx.fillStyle = args.theme.textColor; ctx.font = "11px Arial"; ctx.textAlign = "center";
      ctx.fillText(labels[i], args.coords.timeToX(bar.time), args.bounds.top + 25, args.coords.pxPerBar() - 8);
    });
    document.querySelector("#status")!.textContent = `SIMULATED · gradient=${style.gradientCells ? "on" : "off"} · bid/ask=${style.bidColor}/${style.askColor} · volume=${style.volumeSellColor}/${style.volumeBuyColor} · delta=${style.deltaDownColor}/${style.deltaUpColor}`;
  } };
} });
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "PALETTE-FIXTURE", timeframe: "1m", live: false, priceStyle: "footprint", theme: "light", volume: false, drawings: { toolbar: false }, animations: { intro: false } }, { dataFeed: { load: async cfg => cfg.data ?? bars, subscribe: () => () => {} } });
void chart.ready().then(async () => { await chart.historyComplete();
  chart.renderer.applyConfig({ chartTypes: { footprint: { ...defaultFootprint(), gradientCells: false, askColor: "#0066ff", bidColor: "#ff9900", volumeBuyColor: "#8000ff", volumeSellColor: "#00bcd4", deltaUpColor: "#00aa44", deltaDownColor: "#aa0044", monoLowColor: "#999999", monoHighColor: "#222222" } } });
  chart.setVisibleRange({ from: start - minute, to: start + 6 * minute });
  document.querySelector<HTMLButtonElement>("#settings")!.onclick = () => chart.renderer.openSettings("Footprint");
  document.querySelector<HTMLButtonElement>("#gradient")!.onclick = () => { const config = chart.renderer.getConfig() as { chartTypes?: { footprint?: Record<string, unknown> } }, current = config.chartTypes?.footprint; chart.renderer.applyConfig({ chartTypes: { footprint: { ...current, gradientCells: current?.gradientCells !== true } } }); };
});
