import { Vela, registerChartType, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { defaultFootprint, footprintSettings, paintFootprintBar, resolveFootprint } from "@/lib/orderflow/footprint";
const start = Date.UTC(2026, 10, 5, 12), minute = 60000;
const bars: OHLCV[] = [0, 1, 2].map(i => ({ time: start + i * minute, low: 98, high: 107, open: 100, close: 104, volume: 104 }));
registerChartType({ id: "footprint", label: "Footprint", basePainting: "none", settings: footprintSettings() });
registerRendererLayer({ id: "footprint", placement: "above-data", create: () => {
  let canvas: HTMLCanvasElement | undefined;
  return { mount(value) { canvas = value; }, render(args) {
    const ctx = canvas?.getContext("2d"); if (!ctx || !canvas) return;
    const base = resolveFootprint(args.settings);
    ctx.setTransform(args.coords.dpr, 0, 0, args.coords.dpr, 0, 0); ctx.clearRect(0, 0, canvas.width / args.coords.dpr, canvas.height / args.coords.dpr);
    bars.forEach((bar, i) => {
      const style = { ...base, areaBackground: i !== 1, valueAreaVisible: i !== 0, areaBackgroundColor: "rgba(0,100,240,0.3)", valueAreaBackground: "rgba(240,160,0,0.5)", candleVisible: false, pocVisible: false, textAutoSize: false, textSize: 11 };
      const levels = [100, 101, 104].map(price => ({ price, upperPrice: price + 1, buyVolume: price === 100 ? 100 : 2, sellVolume: 0, imbalance: null, filtered: price === 104 }));
      paintFootprintBar(ctx, args, { time: bar.time, volume: 104, delta: 104, poc: 100, levels }, undefined, 1, style, { width: args.coords.pxPerBar() * .7, offset: 0, within: true });
      ctx.fillStyle = args.theme.textColor; ctx.font = "13px Arial"; ctx.textAlign = "center";
      ctx.fillText(["Area only", "Value Area only", "Both backgrounds"][i], args.coords.timeToX(bar.time), args.bounds.top + 25);
    });
    document.querySelector("#status")!.textContent = "SIMULATED · Observed 100–105, missing rows 102/103, filtered row 104 · Blue area spans all observations; orange VA covers the dominant 100–101 row";
  } };
} });
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "BACKGROUND-FIXTURE", timeframe: "1m", live: false, priceStyle: "footprint", theme: "light", volume: false, drawings: { toolbar: false }, animations: { intro: false } }, { dataFeed: { load: async cfg => cfg.data ?? bars, subscribe: () => () => {} } });
void chart.ready().then(async () => { await chart.historyComplete(); chart.renderer.applyConfig({ chartTypes: { footprint: defaultFootprint() } }); chart.setVisibleRange({ from: start - minute, to: start + 3 * minute }); document.querySelector<HTMLButtonElement>("#settings")!.onclick = () => chart.renderer.openSettings("Footprint"); });
