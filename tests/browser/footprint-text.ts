import { Vela, registerChartType, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { defaultFootprint, footprintSettings, footprintTextPlan, paintFootprintBar, resolveFootprint } from "@/lib/orderflow/footprint";
import { footprints } from "@/lib/orderflow/math";
import type { Tick, FootprintVolumeMode } from "@/types/trading";
const modes: FootprintVolumeMode[] = ["bid-ask", "bid-ask-ladder", "total", "delta", "absolute-delta"], labels = ["Bid × Ask", "Ladder", "Volume", "Delta", "Absolute Delta"];
const start = Date.UTC(2026, 10, 5, 12), minute = 60000;
const bars: OHLCV[] = modes.map((_, i) => ({ time: start + i * minute, low: 98, high: 103, open: 99, close: 102, volume: 123457800 }));
const tape = bars.flatMap((bar, i) => ([[99, 1.25, "sell"], [100, 123456789, "buy"], [100, 1, "sell"], [101, 1000, "buy"], [101, 10, "sell"]] as const).map(([price, quantity, side], j): Tick => ({ id: `${i}:${j}`, symbol: "TEXT-FIXTURE", time: bar.time + j + 1, price, quantity, side, tradeCount: 1, simulated: true })));
const prints = footprints(tape, "1m", 1);
registerChartType({ id: "footprint", label: "Footprint", basePainting: "none", settings: footprintSettings() });
registerRendererLayer({ id: "footprint", placement: "above-data", create: () => {
  let canvas: HTMLCanvasElement | undefined;
  return { mount(value) { canvas = value; }, render(args) {
    const ctx = canvas?.getContext("2d"); if (!ctx || !canvas) return;
    const base = resolveFootprint(args.settings), plans: string[] = [];
    ctx.setTransform(args.coords.dpr, 0, 0, args.coords.dpr, 0, 0); ctx.clearRect(0, 0, canvas.width / args.coords.dpr, canvas.height / args.coords.dpr);
    prints.forEach((bar, i) => {
      const style = { ...base, volumeMode: modes[i], candleVisible: false, pocVisible: false, valueAreaVisible: false }, placement = { width: args.coords.pxPerBar() * .8, offset: 0, within: true };
      const plan = footprintTextPlan(ctx, args, [bar], 1, style, placement); plans.push(`${labels[i]}=${plan ?? "per-row"}`);
      paintFootprintBar(ctx, args, bar, undefined, 1, style, placement, undefined, undefined, plan);
      ctx.fillStyle = args.theme.textColor; ctx.font = "12px Arial"; ctx.textAlign = "center";
      ctx.fillText(labels[i], args.coords.timeToX(bar.time), args.bounds.top + 25, args.coords.pxPerBar() - 8);
    });
    document.querySelector("#status")!.textContent = `SIMULATED · Auto=${base.textAutoSize} · size=${base.textSize} · fit=${base.textFit} · ${plans.join(" / ")}`;
  } };
} });
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "TEXT-FIXTURE", timeframe: "1m", live: false, priceStyle: "footprint", theme: "light", volume: false, drawings: { toolbar: false }, animations: { intro: false } }, { dataFeed: { load: async cfg => cfg.data ?? bars, subscribe: () => () => {} } });
void chart.ready().then(async () => { await chart.historyComplete();
  chart.renderer.applyConfig({ chartTypes: { footprint: { ...defaultFootprint(), textSize: 24 } } }); chart.setVisibleRange({ from: start - minute, to: start + 5 * minute });
  const update = (patch: Record<string, unknown>) => { const config = chart.renderer.getConfig() as { chartTypes?: { footprint?: Record<string, unknown> } }; chart.renderer.applyConfig({ chartTypes: { footprint: { ...config.chartTypes?.footprint, ...patch } } }); };
  document.querySelector<HTMLButtonElement>("#settings")!.onclick = () => chart.renderer.openSettings("Footprint");
  document.querySelector<HTMLButtonElement>("#auto")!.onclick = () => update({ textAutoSize: true, textFit: false });
  document.querySelector<HTMLButtonElement>("#manual")!.onclick = () => update({ textAutoSize: false, textSize: 24, textFit: false });
  document.querySelector<HTMLButtonElement>("#fit")!.onclick = () => update({ textAutoSize: false, textSize: 24, textFit: true });
});
