import { Vela, registerChartType, registerRendererLayer } from "@luxalgo/vela";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import { footprintSettings, footprintPlacements, paintFootprintBar, resolveFootprintInstances } from "@/lib/orderflow/footprint";
import { footprintDisplayBar } from "@/lib/orderflow/footprintCells";
import { paintVisibleFootprint, readVisibleFootprint } from "@/lib/orderflow/visibleFootprint";
import type { Tick } from "@/types/trading";
const start = Date.UTC(2026, 10, 4, 12), minute = 60000;
const bars = [0, 1, 2, 3].map(i => ({ time: start + i * minute, open: 100, close: 102, high: 103, low: 99, volume: 50 }));
const ticks: Tick[] = [[0, 100, 20, "buy", 10], [0, 100, 2, "sell", 1], [1, 100, 10, "buy", 1], [1, 101, 3, "sell", 1], [3, 102, 5, "buy", 1]].map(([bar, price, quantity, side, count], i) => ({ id: String(i), symbol: "VISIBLE-FIXTURE", time: start + Number(bar) * minute + i + 1, price: Number(price), quantity: Number(quantity), side: side as "buy" | "sell", tradeCount: Number(count), simulated: true }));
const history = new FootprintHistory("1m"); history.add(ticks);
let average = false;
registerChartType({ id: "footprint", label: "Footprint", basePainting: "none", settings: footprintSettings() });
registerRendererLayer({ id: "footprint", placement: "above-data", create: () => { let canvas: HTMLCanvasElement | undefined;
  return { mount(value) { canvas = value; }, render(args) {
    const ctx = canvas?.getContext("2d"); if (!ctx || !canvas) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.scale(args.coords.dpr, args.coords.dpr);
    const instances = resolveFootprintInstances(args.settings), placements = footprintPlacements(args, instances);
    for (const instance of instances) for (const raw of history.read({ step: instance.style.rowSize || 1, ratio: instance.style.imbalanceRatio }, instance.id))
      paintFootprintBar(ctx, args, footprintDisplayBar(raw, instance.style.rowSize || 1, instance.style), undefined, instance.style.rowSize || 1, { ...instance.style, candleVisible: false }, placements.get(instance.id));
    const visible = readVisibleFootprint(history, args, "1m"); paintVisibleFootprint(ctx, args, visible);
    document.querySelector("#status")!.textContent = `SIMULATED · ${visible?.observedCandles}/${visible?.candles} observed/selected candles · Total ${visible?.bar?.volume ?? "unknown"} · Delta ${visible?.bar?.delta ?? "unknown"} · ${visible?.style.averageTradeSize ? "Aggregate means" : "Raw sizes"} · ${visible?.bar?.levels.length ?? 0} rows · pinned width ${visible?.placement?.width ?? 0}px`;
  } };
} });
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "VISIBLE-FIXTURE", timeframe: "1m", live: false, bars: 4, priceStyle: "footprint", theme: "light", volume: false, drawings: { toolbar: false }, animations: { intro: false } }, { dataFeed: { load: async cfg => cfg.data ?? bars, subscribe: () => () => {} } });
chart.renderer.applyConfig({ chartTypes: { footprint: { rowSize: 1, fp2Enabled: true, fp2RowSize: 1, fp3Enabled: true, fp3RowSize: 1, fp4Enabled: true, fp4RowSize: 1, fp5Enabled: true, fp5RowSize: 1, vrEnabled: true, vrRowSize: 1, vrWidthPercent: 30, vrValueAreaVisible: false } } });
void chart.ready().then(async () => { await chart.historyComplete(); chart.setVisibleRange({ from: start - minute, to: start + 4 * minute });
  for (const id of ["all", "prefix", "zoom", "average", "settings"] as const) { const button = document.querySelector<HTMLButtonElement>(`#${id}`)!; button.disabled = false; button.onclick = () => {
    if (id === "settings") { chart.renderer.openSettings("Footprint"); return; }
    if (id === "average") { average = !average; chart.renderer.applyConfig({ chartTypes: { footprint: { vrAverageTradeSize: average } } }); return; }
    chart.setVisibleRange(id === "prefix" ? { from: start - minute / 2, to: start + minute } : id === "zoom" ? { from: start - 20 * minute, to: start + 20 * minute } : { from: start - minute, to: start + 4 * minute });
  }; }
});
