import { Vela, registerChartType, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { defaultFootprint, footprintSettings, paintFootprintBar, resolveFootprint } from "@/lib/orderflow/footprint";
import { footprintTextColor } from "@/lib/orderflow/footprintTheme";
import { footprintPocColor } from "@/lib/orderflow/footprintStructure";
const start = Date.UTC(2026, 10, 5, 12), minute = 60000;
const bars: OHLCV[] = [0, 1, 2].map(i => ({ time: start + i * minute, low: 98, high: 104, open: 100, close: 102, volume: 10 }));
let dark = false;
registerChartType({ id: "footprint", label: "Footprint", basePainting: "none", settings: footprintSettings() });
registerRendererLayer({ id: "footprint", placement: "above-data", create: () => {
  let canvas: HTMLCanvasElement | undefined;
  return { mount(value) { canvas = value; }, render(args) {
    const ctx = canvas?.getContext("2d"); if (!ctx || !canvas) return;
    const style = resolveFootprint(args.settings);
    ctx.setTransform(args.coords.dpr, 0, 0, args.coords.dpr, 0, 0); ctx.clearRect(0, 0, canvas.width / args.coords.dpr, canvas.height / args.coords.dpr);
    paintFootprintBar(ctx, args, { time: start + minute, volume: 10, delta: 6, poc: 100, levels: [{ price: 100, upperPrice: 101, buyVolume: 8, sellVolume: 2, imbalance: null }] }, undefined, 1, style, { width: 260, offset: 0, within: true });
    document.querySelector("#status")!.textContent = `SIMULATED · ${dark ? "Dark" : "Light"} · stored text=${style.textColor} POC=${style.pocColor} · rendered text=${footprintTextColor(style,args.theme)} POC=${footprintPocColor(style.pocColor,args.theme.background)}`;
  } };
} });
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "COLOR-INTENT", timeframe: "1m", live: false, priceStyle: "footprint", theme: "light", volume: false, drawings: { toolbar: false }, animations: { intro: false } }, { dataFeed: { load: async cfg => cfg.data ?? bars, subscribe: () => () => {} } });
void chart.ready().then(async () => { await chart.historyComplete(); chart.renderer.applyConfig({ chartTypes: { footprint: { ...defaultFootprint(), candleVisible: false, valueAreaVisible: false, textAutoSize: false, textSize: 24, pocWidth: 4 } } }); chart.setVisibleRange({ from: start - minute, to: start + 3 * minute });
  document.querySelector<HTMLButtonElement>("#settings")!.onclick = () => chart.renderer.openSettings("Footprint");
  document.querySelector<HTMLButtonElement>("#theme")!.onclick = () => { dark = !dark; chart.setTheme(dark ? "dark" : "light"); };
});
