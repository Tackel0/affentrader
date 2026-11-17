import { Vela, registerChartType, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { defaultFootprint, footprintSettings, paintFootprintBar } from "@/lib/orderflow/footprint";
import { FOOTPRINT_STAT_TOGGLES } from "@/lib/orderflow/footprintStatistics";
const start = Date.UTC(2026, 10, 5, 12), minute = 60000;
const bars: OHLCV[] = [0, 1, 2].map(i => ({ time: start + i * minute, low: 95, high: 112, open: i === 1 ? 104 : 100, close: i === 1 ? 100 : 104, volume: i === 2 ? 0 : 13579 }));
let narrow = false;
registerChartType({ id: "footprint", label: "Footprint", basePainting: "none", settings: footprintSettings() });
registerRendererLayer({ id: "footprint", placement: "above-data", create: () => {
  let canvas: HTMLCanvasElement | undefined;
  return { mount(value) { canvas = value; }, render(args) {
    const ctx = canvas?.getContext("2d"); if (!ctx || !canvas) return;
    ctx.setTransform(args.coords.dpr, 0, 0, args.coords.dpr, 0, 0); ctx.clearRect(0, 0, canvas.width / args.coords.dpr, canvas.height / args.coords.dpr);
    bars.forEach((bar, i) => {
      const buyVolume = i === 2 ? 0 : i === 1 ? 1234 : 12345, sellVolume = i === 2 ? 0 : i === 1 ? 12345 : 1234;
      const style = { ...defaultFootprint(), ...Object.fromEntries(FOOTPRINT_STAT_TOGGLES.map(key => [key, true])), statBuy: i !== 1, statisticsVisible: true, statisticsPosition: i === 1 ? "above" as const : "below" as const, statisticsColor: "#131722", statisticsBackground: "#f0f3fa", histogramVisible: false, candleVisible: true, buyColor: "#8000ff", sellColor: "#ffaa00", pocVisible: false, valueAreaVisible: false };
      const levels = [100, 104].map(price => ({ price, upperPrice: price + 1, buyVolume: price === 100 ? buyVolume : 0, sellVolume: price === 100 ? sellVolume : 0, buyCount: price === 100 ? 12345 : 0, sellCount: price === 100 ? 1234 : 0, imbalance: null }));
      paintFootprintBar(ctx, args, { time: bar.time, volume: buyVolume + sellVolume, delta: buyVolume - sellVolume, poc: 100, levels }, { ...bar, high: 105, low: 100 }, 1, style, { width: narrow ? 50 : args.coords.pxPerBar() * .85, offset: 0, within: true });
      ctx.fillStyle = args.theme.textColor; ctx.font = "12px Arial"; ctx.textAlign = "center";
      ctx.fillText(["Positive · Below", "Percentage-only Buy · Above", "Zero volume / count coverage"][i], args.coords.timeToX(bar.time), args.bounds.top + 22);
    });
    document.querySelector("#status")!.textContent = `SIMULATED · ${narrow ? "Values-only lanes" : "Labels and values"} · Theme green/red metrics, purple/orange candle colors · compact k values; Sell precedes percentage-only Buy; no zero-denominator suffix`;
  } };
} });
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "STATISTICS-FIXTURE", timeframe: "1m", live: false, priceStyle: "footprint", theme: "light", volume: false, drawings: { toolbar: false }, animations: { intro: false } }, { dataFeed: { load: async cfg => cfg.data ?? bars, subscribe: () => () => {} } });
void chart.ready().then(async () => { await chart.historyComplete(); chart.renderer.applyConfig({ chartTypes: { footprint: defaultFootprint() } }); chart.setVisibleRange({ from: start - minute, to: start + 3 * minute }); document.querySelector<HTMLButtonElement>("#toggle")!.onclick = () => { narrow = !narrow; chart.renderer.applyConfig({ chartTypes: { footprint: { ...defaultFootprint(), statisticsVisible: narrow } } }); }; });
