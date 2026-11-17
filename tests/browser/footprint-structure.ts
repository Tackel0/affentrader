import { Vela, registerChartType, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { defaultFootprint, footprintSettings, paintFootprintBar } from "@/lib/orderflow/footprint";
const start = Date.UTC(2026, 10, 5, 12), minute = 60000;
const bars: OHLCV[] = [0, 1, 2].map(i => ({ time: start + i * minute, low: 98, high: 108, open: 100, close: 104, volume: 125 }));
let dark = false;
registerChartType({ id: "footprint", label: "Footprint", basePainting: "none", settings: footprintSettings() });
registerRendererLayer({ id: "footprint", placement: "above-data", create: () => {
  let canvas: HTMLCanvasElement | undefined;
  return { mount(value) { canvas = value; }, render(args) {
    const ctx = canvas?.getContext("2d"); if (!ctx || !canvas) return;
    ctx.setTransform(args.coords.dpr, 0, 0, args.coords.dpr, 0, 0); ctx.clearRect(0, 0, canvas.width / args.coords.dpr, canvas.height / args.coords.dpr);
    bars.forEach((bar, i) => {
      const style = { ...defaultFootprint(), volumeMode: "total" as const, volumeSplit: false, monoLowColor: "#099981", monoHighColor: "#099981", gradientCells: false, areaBackground: true, candleVisible: false, valueAreaVisible: i !== 0, valueAreaBackground: "rgba(255,180,0,0.7)", valueAreaColor: "#8f33eb", valueAreaWidth: 3, pocWidth: 2, textAutoSize: false, textSize: 16, textColorAuto: false, textColor: "#222222" };
      const levels = [100, 101, 104].map(price => ({ price, upperPrice: price + 1, buyVolume: price === 100 ? 100 : price === 101 ? 20 : 5, sellVolume: 0, imbalance: null }));
      paintFootprintBar(ctx, args, { time: bar.time, volume: 125, delta: 125, poc: 100, levels }, undefined, 1, style, { width: i === 2 ? 8 : args.coords.pxPerBar() * .7, offset: 0, within: true });
      ctx.fillStyle = args.theme.textColor; ctx.font = "12px Arial"; ctx.textAlign = "center";
      ctx.fillText(["Cells + default POC", "VA after cells + default POC", "8px: fill only, no lines / POC"][i], args.coords.timeToX(bar.time), args.bounds.top + 24);
    });
    document.querySelector("#status")!.textContent = `SIMULATED · ${dark ? "Dark" : "Light"} theme · VA overlays cells/numbers; POC stays inside the one-pixel row gap; 8px lane keeps only fill`;
  } };
} });
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "STRUCTURE-FIXTURE", timeframe: "1m", live: false, priceStyle: "footprint", theme: "light", volume: false, drawings: { toolbar: false }, animations: { intro: false } }, { dataFeed: { load: async cfg => cfg.data ?? bars, subscribe: () => () => {} } });
void chart.ready().then(async () => { await chart.historyComplete(); chart.renderer.applyConfig({ chartTypes: { footprint: defaultFootprint() } }); chart.setVisibleRange({ from: start - minute, to: start + 3 * minute }); document.querySelector<HTMLButtonElement>("#theme")!.onclick = () => { dark = !dark; chart.setTheme(dark ? "dark" : "light"); }; });
