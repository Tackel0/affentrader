import { Vela, registerChartType, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { defaultFootprint, footprintSettings, resolveFootprintInstances, footprintPlacements, paintFootprintBar, paintFootprintInstanceCandles } from "@/lib/orderflow/footprint";
import { footprintDisplayBar } from "@/lib/orderflow/footprintCells";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import type { Tick } from "@/types/trading";
const start = Date.UTC(2026, 10, 4, 12), minute = 60000;
const bars: OHLCV[] = [-1, 0, 1].map(offset => ({ time: start + offset * minute, open: 100, close: 102, high: 103, low: 99, volume: offset ? 0 : 47 }));
const history = new FootprintHistory("1m");
history.add(([ [100, 20, "buy", 10], [100, 8, "sell", 1], [101, 1, "buy", 1], [101, 10, "sell", 1], [102, 4, "buy", 1], [102, 4, "sell", 1] ] as const)
  .map(([price, quantity, side, count], j): Tick => ({ id: String(j), symbol: "MULTI-FIXTURE", time: start + j + 1, price, quantity, side, tradeCount: count, simulated: true })));
registerChartType({ id: "footprint", label: "Footprint", basePainting: "none", settings: footprintSettings() });
registerRendererLayer({ id: "footprint", placement: "above-data", create: () => {
  let canvas: HTMLCanvasElement | undefined;
  return { mount(value) { canvas = value; }, render(args) {
    const ctx = canvas?.getContext("2d"); if (!ctx || !canvas) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.scale(args.coords.dpr, args.coords.dpr);
    const instances = resolveFootprintInstances(args.settings), placements = footprintPlacements(args, instances);
    history.retainViews(instances.map(instance => instance.id)); paintFootprintInstanceCandles(ctx, args, instances, placements);
    for (const instance of instances) {
      const style = instance.style, step = style.rowSize || 1, placement = placements.get(instance.id)!;
      for (const bar of history.read({ step, ratio: style.imbalanceRatio }, instance.id)) paintFootprintBar(ctx, args, footprintDisplayBar(bar, step, style), undefined, step, { ...style, candleVisible: false }, placement);
      ctx.fillStyle = args.theme.textColor; ctx.font = "11px Arial"; ctx.textAlign = "center"; ctx.globalAlpha = 1;
      ctx.fillText(`${instance.id.toUpperCase()} · ${style.position}`, args.coords.timeToX(start) + placement.offset, args.bounds.top + 22, Math.max(10, placement.width));
    }
    document.querySelector("#status")!.textContent = `SIMULATED · ${instances.length} independent footprints on ONE candle · ${history.coverage.trades} shared executions · ${instances.map(instance => instance.id + ':' + instance.style.volumeMode + '/' + instance.style.position).join(' · ')}`;
  } };
} });
const initial = { ...defaultFootprint(), rowSize: 1, fp2Enabled: true, fp2RowSize: 1, fp3Enabled: true, fp3RowSize: 1, fp4Enabled: true, fp4RowSize: 1, fp5Enabled: true, fp5RowSize: 1 };
const saved = localStorage.getItem("footprint-instance-fixture");
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "MULTI-FIXTURE", timeframe: "1m", live: false,
  bars: 1, priceStyle: "footprint", theme: "light", volume: false, drawings: { toolbar: false },
  visibleRange: { from: start - minute, to: start + minute }, animations: { intro: false } },
{ dataFeed: { load: async cfg => cfg.data ?? bars, subscribe: () => () => {} } });
chart.renderer.applyConfig({ chartTypes: { footprint: saved ? JSON.parse(saved) : initial } });
void chart.ready().then(async () => { await chart.historyComplete();
  chart.setVisibleRange({ from: start - minute, to: start + minute });
  const button = document.querySelector<HTMLButtonElement>("#settings")!; button.disabled = false; button.onclick = () => chart.renderer.openSettings("Footprint");
  chart.renderer.onConfigChanged(() => {
    const config = chart.renderer.getConfig() as { chartTypes?: { footprint?: unknown } };
    localStorage.setItem("footprint-instance-fixture", JSON.stringify(config.chartTypes?.footprint));
  });
});
