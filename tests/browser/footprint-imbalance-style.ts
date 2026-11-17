import { Vela, registerChartType, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { defaultFootprint, paintFootprintBar } from "@/lib/orderflow/footprint";
import { footprints } from "@/lib/orderflow/math";
import type { Tick } from "@/types/trading";
const start = Date.UTC(2026, 10, 4, 12), minute = 60000;
const bars: OHLCV[] = Array.from({ length: 4 }, (_, i) => ({ time: start + i * minute, open: 100, close: 102, low: 100, high: 103, volume: 22 }));
const prints = footprints(bars.flatMap((bar, i) => ([[100, 9, "sell"], [100, 1, "buy"], [101, 1, "sell"], [101, 1, "buy"], [102, 1, "sell"], [102, 9, "buy"]] as const).map(([price, quantity, side], j): Tick => ({ id: `${i}/${j}`, symbol: "IMBALANCE-FIXTURE", time: bar.time + j + 1, price, quantity, side, simulated: true, tradeCount: quantity }))), "1m", 1, 3, { ignoreZeroOpposite: true });
registerChartType({ id: "imbalance-fixture", label: "Imbalance styles", basePainting: "none" });
registerRendererLayer({ id: "imbalance-fixture", placement: "above-data", create: () => {
  let canvas: HTMLCanvasElement | undefined;
  return { mount(value) { canvas = value; }, render(args) {
    const ctx = canvas?.getContext("2d"); if (!ctx || !canvas) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.scale(args.coords.dpr, args.coords.dpr);
    for (const [i, bar] of prints.entries()) {
      const imbalanceVisible = i >= 2, imbalanceRecolor = i % 2 === 1;
      paintFootprintBar(ctx, args, bar, undefined, 1, { ...defaultFootprint(), volumeMode: "bid-ask-ladder", candleVisible: false, pocVisible: false, valueAreaVisible: false, histogramVisible: false, imbalanceVisible, imbalanceRecolor });
      ctx.fillStyle = args.theme.textColor; ctx.font = "12px Arial"; ctx.textAlign = "center";
      ctx.fillText(`${imbalanceVisible ? "Outline" : "No outline"} / ${imbalanceRecolor ? "Tint" : "Plain"}`, args.coords.timeToX(bar.time) + 4, args.bounds.top + 30);
    }
  } };
} });
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "IMBALANCE-FIXTURE", timeframe: "1m", live: false, bars: 4, priceStyle: "imbalance-fixture", theme: "light", volume: false, drawings: { toolbar: false }, animations: { intro: false } }, { dataFeed: { load: async cfg => cfg.data ?? bars, subscribe: () => () => {} } });
void chart.ready().then(async () => { await chart.historyComplete(); chart.setVisibleRange({ from: start - minute, to: start + 4 * minute }); });
