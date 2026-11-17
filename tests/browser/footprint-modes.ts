import { Vela, registerChartType, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { defaultFootprint, paintFootprintBar } from "@/lib/orderflow/footprint";
import { footprintDisplayBar } from "@/lib/orderflow/footprintCells";
import { footprints } from "@/lib/orderflow/math";
import type { Tick, FootprintVolumeMode } from "@/types/trading";
const start = Date.UTC(2026, 10, 4, 12), minute = 60000;
const options = { average: false, gradients: true, histogram: true };
const variants: { mode: FootprintVolumeMode; split: boolean; title: string }[] = [
  { mode: "bid-ask", split: true, title: "Bid × Ask Profile" }, { mode: "bid-ask-ladder", split: true, title: "Bid × Ask Ladder" },
  { mode: "total", split: true, title: "Volume Split" }, { mode: "total", split: false, title: "Volume Mono" },
  { mode: "delta", split: true, title: "Delta Profile" }, { mode: "absolute-delta", split: true, title: "Absolute Delta" },
];
const bars: OHLCV[] = variants.map((_, i) => ({ time: start + i * minute, open: 100, close: 101, high: 104, low: 99, volume: 47 }));
const model = footprints(bars.flatMap((b, i) => ([ [100, 20, "buy", 10], [100, 8, "sell", 1], [101, 1, "buy", 1], [101, 10, "sell", 1], [102, 4, "buy", 1], [102, 4, "sell", 1] ] as const)
  .map(([price, quantity, side, count], j): Tick => ({ id: `${i}/${j}`, symbol: "MODES-FIXTURE", time: b.time + j + 1, price, quantity, side, tradeCount: count, simulated: true }))), "1m", 1);
registerChartType({ id: "modes-fixture", label: "Footprint modes fixture", basePainting: "none" });
registerRendererLayer({ id: "modes-fixture", placement: "above-data", create: () => {
  let canvas: HTMLCanvasElement | undefined;
  return { mount(value) { canvas = value; }, render(args) {
    const ctx = canvas?.getContext("2d"); if (!ctx || !canvas) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.scale(args.coords.dpr, args.coords.dpr);
    model.forEach((raw, index) => {
      const variant = variants[index], style = { ...defaultFootprint(), rowSize: 1, candleVisible: false, imbalanceVisible: false,
        volumeMode: variant.mode, volumeSplit: variant.split, gradientCells: options.gradients, averageTradeSize: options.average, histogramVisible: options.histogram };
      paintFootprintBar(ctx, args, footprintDisplayBar(raw, 1, style), undefined, 1, style);
      ctx.fillStyle = args.theme.textColor; ctx.font = "11px Arial"; ctx.textAlign = "center"; ctx.globalAlpha = 1;
      ctx.fillText(variant.title, args.coords.timeToX(raw.time) + 4, args.bounds.top + 22, Math.max(10, args.coords.pxPerBar() - 8));
    });
    document.querySelector("#status")!.textContent = `SIMULATED COMPARISON · ${options.average ? "Mean trade sizes" : "Raw volumes"} · gradients ${options.gradients ? "on" : "off"} · histogram ${options.histogram ? "on" : "off"}. Each candle uses a different test mode; this does not demonstrate multiple instances on one candle.`;
  } };
} });
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "MODES-FIXTURE", timeframe: "1m", live: false,
  bars: 6, priceStyle: "modes-fixture", theme: "light", volume: false, drawings: { toolbar: false }, visibleRange: { from: start - minute, to: start + 6 * minute }, animations: { intro: false } },
{ dataFeed: { load: async cfg => cfg.data ?? bars, subscribe: () => () => {} } });
void chart.ready().then(async () => { await chart.historyComplete();
  for (const id of ["average", "gradient", "histogram"] as const) { const button = document.querySelector<HTMLButtonElement>(`#${id}`)!; button.disabled = false;
    button.onclick = () => { if (id === "average") options.average = !options.average; if (id === "gradient") options.gradients = !options.gradients; if (id === "histogram") options.histogram = !options.histogram;
      void chart.setMarket({ data: [...bars] }).then(() => { chart.setVisibleRange({ from: start - minute, to: start + 6 * minute }); });
    };
  }
});
