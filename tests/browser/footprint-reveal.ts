import { Vela, registerChartType, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { defaultFootprint, footprintSettings, resolveFootprintInstances, footprintPlacements, paintFootprintBar, paintFootprintInstanceCandles } from "@/lib/orderflow/footprint";
import { createFootprintReveal, footprintBodyModulation, footprintRawSpacing } from "@/lib/orderflow/footprintReveal";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import type { Tick } from "@/types/trading";
const start = Date.UTC(2026, 10, 4, 12), minute = 60_000;
const bars: OHLCV[] = Array.from({ length: 400 }, (_, index) => {
  const open = 100 + Math.round(Math.sin(index / 8) * 8) / 4;
  return { time: start + index * minute, open, high: open + 1, low: open - .5, close: open + .5, volume: 30 };
});
const history = new FootprintHistory("1m");
history.add(bars.flatMap((bar, index) => Array.from({ length: 6 }, (_, row): Tick => ({
  id: `${index}:${row}`, symbol: "SIMULATED-REVEAL", time: bar.time + row + 1, price: bar.low + row * .25,
  quantity: row + 1, side: row % 2 ? "buy" : "sell", tradeCount: 1, simulated: true,
}))));
let frames = 0, intermediate = 0;
registerChartType({ id: "footprint", label: "Footprint", basePainting: "none", settings: footprintSettings() });
registerRendererLayer({ id: "footprint", placement: "above-data", create: () => {
  let canvas: HTMLCanvasElement | undefined, modulation: ReturnType<typeof footprintBodyModulation> | null = null;
  const reveal = createFootprintReveal();
  return { mount(value) { canvas = value; }, animating: () => reveal.animating, modulateBase: () => modulation, render(args) {
    const ctx = canvas?.getContext("2d"); if (!ctx || !canvas) return;
    const instances = resolveFootprintInstances(args.settings), spacing = footprintRawSpacing(args);
    const opacity = reveal.update(args.nowMs, spacing, true, "simulated-fixture");
    modulation = footprintBodyModulation(opacity, instances.map(instance => instance.style.position));
    const placements = footprintPlacements(args, instances, opacity);
    ctx.setTransform(args.coords.dpr, 0, 0, args.coords.dpr, 0, 0); ctx.clearRect(0, 0, canvas.width / args.coords.dpr, canvas.height / args.coords.dpr);
    ctx.save(); ctx.beginPath(); ctx.rect(0, args.bounds.top, args.coords.width, args.bounds.height); ctx.clip();
    paintFootprintInstanceCandles(ctx, args, instances, placements, opacity);
    for (const instance of instances) for (const bar of history.read({ step: .25, ratio: 3 }, instance.id))
      paintFootprintBar(ctx, args, bar, undefined, .25, { ...instance.style, candleVisible: false }, placements.get(instance.id));
    ctx.restore(); frames++; if (opacity > .001 && opacity < .999) intermediate++;
    document.querySelector("#status")!.textContent = `SIMULATED · raw spacing ${spacing.toFixed(3)} · reveal ${opacity.toFixed(4)} · intermediate frames ${intermediate} · total frames ${frames} · body scale ${modulation.candleBodyScale.toFixed(3)} · body alpha ${modulation.candleBodyAlpha.toFixed(3)} · grid alpha ${modulation.gridAlpha.toFixed(3)}`;
  }, destroy() { reveal.reset(); } };
} });
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "SIMULATED-REVEAL", timeframe: "1m", live: false, priceStyle: "footprint", theme: "light", volume: false,
  drawings: { toolbar: false }, animations: { intro: false, zoom: false, autoscale: false },
}, { dataFeed: { load: async cfg => cfg.data ?? bars, subscribe: () => () => {} } });
const windowOf = (count: number) => chart.setVisibleRange({ from: bars.at(-1)!.time - count * minute, to: bars.at(-1)!.time + 2 * minute });
const style = { ...defaultFootprint(), rowSize: .25, pocVisible: false, valueAreaVisible: false, statisticsVisible: true };
void chart.ready().then(async () => { await chart.historyComplete(); chart.renderer.applyConfig({ chartTypes: { footprint: style } }); windowOf(400);
  for (const [id, count] of [["far", 400], ["near", 8], ["middle", 150]] as const) document.querySelector<HTMLButtonElement>(`#${id}`)!.onclick = () => { frames = intermediate = 0; windowOf(count); };
  for (const position of ["right", "within"] as const) document.querySelector<HTMLButtonElement>(`#${position}`)!.onclick = () => chart.renderer.applyConfig({ chartTypes: { footprint: { ...style, position, fp2Enabled: false, fp3Enabled: false } } });
  document.querySelector<HTMLButtonElement>("#three")!.onclick = () => chart.renderer.applyConfig({ chartTypes: { footprint: { ...style, position: "left", fp2Enabled: true, fp2Position: "within", fp2RowSize: .25, fp3Enabled: true, fp3Position: "right", fp3RowSize: .25 } } });
});
