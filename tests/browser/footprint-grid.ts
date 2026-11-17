import { Vela, registerChartType, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { defaultFootprint, footprintSettings, footprintPlacements, footprintStep, resolveFootprintInstances, paintFootprintBar, paintFootprintInstanceCandles } from "@/lib/orderflow/footprint";
import { createFootprintGridSource } from "@/lib/orderflow/footprintGrid";
import { createFootprintReveal, footprintBodyModulation, footprintRawSpacing } from "@/lib/orderflow/footprintReveal";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import { readVisibleFootprint, paintVisibleFootprint } from "@/lib/orderflow/visibleFootprint";
import { bindCellContext, requestCellFrame } from "@/lib/chart/cellContext";
import type { PriceGridMetadata } from "@/lib/market/priceGridMetadata";
import type { Tick } from "@/types/trading";
const start = Date.UTC(2026, 10, 5, 12), minute = 60000;
const bars: OHLCV[] = Array.from({ length: 150 }, (_, i) => ({ time: start + i * minute, open: 100 + i % 8 / 10, high: 101.2, low: 99.9, close: 100.5 + i % 4 / 10, volume: 36 }));
// Intentionally exercise the non-SIMULATED metadata path on a labeled, synthetic archive.
const ticks = bars.flatMap((bar, i) => Array.from({ length: 8 }, (_, j): Tick => ({ symbol: "BTCUSDT", id: `${i}:${j}`, time: bar.time + j + 1, price: (10001 + j + 10 * (i % 8)) / 100, quantity: j + 1, side: j % 2 ? "buy" : "sell", tradeCount: 1, simulated: false })));
const history = new FootprintHistory("1m"); history.add(ticks);
let frames = 0, nativeRequests = 0, resolve: ((value: PriceGridMetadata) => void) | undefined;
registerChartType({ id: "footprint", label: "Footprint", basePainting: "none", settings: footprintSettings() });
registerRendererLayer({ id: "footprint", placement: "above-data", create: () => {
  let canvas: HTMLCanvasElement | undefined, modulation: ReturnType<typeof footprintBodyModulation> | null = null;
  const reveal = createFootprintReveal();
  const grid = createFootprintGridSource(() => { nativeRequests++; if (canvas) requestCellFrame(canvas); }, () => new Promise<PriceGridMetadata>(done => {
    resolve = done; document.querySelector<HTMLButtonElement>("#resolve")!.disabled = false;
  }));
  return { mount(value) { canvas = value; }, animating: () => reveal.animating, modulateBase: () => modulation, destroy() { grid.dispose(); reveal.reset(); }, render(args) {
    const ctx = canvas?.getContext("2d"); if (!ctx || !canvas) return; frames++;
    const precision = grid.read({ symbol: "BTCUSDT", price: bars.at(-1)!.close, simulated: false, scope: "frozen-archive" });
    const instances = resolveFootprintInstances(args.settings), opacity = reveal.update(args.nowMs, footprintRawSpacing(args), !!precision.tick, "fixture");
    modulation = footprintBodyModulation(opacity, instances.map(value => value.style.position));
    const placements = footprintPlacements(args, instances, opacity); history.retainViews(instances.map(value => value.id));
    ctx.setTransform(args.coords.dpr, 0, 0, args.coords.dpr, 0, 0); ctx.clearRect(0, 0, canvas.width / args.coords.dpr, canvas.height / args.coords.dpr);
    ctx.save(); ctx.beginPath(); ctx.rect(0, args.bounds.top, args.coords.width, args.bounds.height); ctx.clip();
    paintFootprintInstanceCandles(ctx, args, instances, placements, opacity);
    const steps: string[] = [];
    if (precision.tick) for (const instance of instances) {
      const step = footprintStep(args, instance.style, bars.at(-1)!.close, precision.tick); steps.push(`${instance.id}=${step}`);
      for (const bar of history.read({ step, ratio: 3 }, instance.id)) paintFootprintBar(ctx, args, bar, undefined, step, { ...instance.style, candleVisible: false }, placements.get(instance.id));
    }
    const range = readVisibleFootprint(history, args, "1m", undefined, precision.tick); paintVisibleFootprint(ctx, args, range);
    ctx.restore();
    document.querySelector("#status")!.textContent = `SIMULATED · frozen archive, no live ticks · metadata ${precision.tick ? `ready ${precision.tick}` : "pending"} · native requests ${nativeRequests} · frames ${frames} · ${steps.join(" / ")} · visible=${range?.step ?? "pending"}`;
  } };
} });
let chart: Vela;
bindCellContext(document.querySelector<HTMLElement>("#chart")!, () => ({ id: "fixture", symbol: "BTCUSDT", timeframe: "1m", replay: false }), () => chart.resize());
chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "BTCUSDT", timeframe: "1m", priceStyle: "footprint", live: false, theme: "light", volume: false, drawings: { toolbar: false }, animations: { intro: false } }, { dataFeed: { load: async cfg => cfg.data ?? bars, subscribe: () => () => {} } });
const settings = { ...defaultFootprint(), fp2Enabled: true, fp2RowMode: "manual", fp2RowTicks: 4, fp3Enabled: true, fp3RowMode: "manual", fp3RowTicks: 7,
  fp4Enabled: true, fp4RowMode: "manual", fp4RowTicks: 16, fp5Enabled: true, fp5RowMode: "manual", fp5RowTicks: 64, vrEnabled: true, vrWidthPercent: 20, vrRowMode: "manual", vrRowTicks: 3 };
void chart.ready().then(async () => { await chart.historyComplete(); chart.renderer.applyConfig({ chartTypes: { footprint: settings } }); chart.setVisibleRange({ from: bars.at(-1)!.time - 4 * minute, to: bars.at(-1)!.time + minute });
  document.querySelector<HTMLButtonElement>("#resolve")!.onclick = () => resolve?.({ symbol: "BTCUSDT", tickSize: .01, source: "SIMULATED venue callback fixture", checkedAt: Date.now() });
  document.querySelector<HTMLButtonElement>("#settings")!.onclick = () => chart.renderer.openSettings("Footprint");
});
