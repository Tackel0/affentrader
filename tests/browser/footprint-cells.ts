import { Vela, registerChartType, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { defaultFootprint, paintFootprintBar } from "@/lib/orderflow/footprint";
import { footprintDisplayBar } from "@/lib/orderflow/footprintCells";
import { footprints } from "@/lib/orderflow/math";
import type { Tick } from "@/types/trading";
const start = Date.UTC(2026, 10, 4, 12), minute = 60000;
const style = { ...defaultFootprint(), rowSize: 1, candleVisible: false, imbalanceVisible: false };
let missing = false;
const bars: OHLCV[] = Array.from({ length: 6 }, (_, i) => ({ time: start + i * minute, open: 100, close: 101, high: 103, low: 99, volume: 39 }));
const model = () => footprints(bars.flatMap((b, i) => ([ [100, 20, "buy", 10], [100, 8, "sell", 1], [101, 10, "buy", 1], [101, 1, "sell", 1] ] as const)
  .map(([price, quantity, side, count], j): Tick => ({ id: `${i}/${j}`, symbol: "CELLS-FIXTURE", time: b.time + j + 1, price, quantity, side, tradeCount: missing ? undefined : count, simulated: true }))), "1m", 1);
registerChartType({ id: "cells-fixture", label: "Footprint cells fixture", basePainting: "none" });
registerRendererLayer({ id: "cells-fixture", placement: "above-data", create: () => {
  let canvas: HTMLCanvasElement | undefined;
  return { mount(value) { canvas = value; }, render(args) {
    const ctx = canvas?.getContext("2d"); if (!ctx || !canvas) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.scale(args.coords.dpr, args.coords.dpr);
    const raw = model(), plotted = raw.map(b => footprintDisplayBar(b, 1, style));
    for (const bar of plotted) paintFootprintBar(ctx, args, bar, undefined, 1, style);
    document.querySelector("#status")!.textContent = `SIMULATED · ${style.averageTradeSize ? "Average shapes" : "Raw-volume shapes"} · cell values ${style.cellValues} · POC ${Number.isFinite(plotted[0].poc) ? plotted[0].poc : "unavailable"} · counts ${missing ? "missing; dash labels" : "explicit (13 underlying trades per candle)"}`;
  } };
} });
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "CELLS-FIXTURE", timeframe: "1m", live: false,
  bars: 6, priceStyle: "cells-fixture", theme: "light", volume: false, drawings: { toolbar: false }, visibleRange: { from: start - minute, to: start + 6 * minute }, animations: { intro: false } },
{ dataFeed: { load: async cfg => cfg.data ?? bars, subscribe: () => () => {} } });
void chart.ready().then(async () => { await chart.historyComplete();
  for (const id of ["raw", "average", "counts", "missing"] as const) { const button = document.querySelector<HTMLButtonElement>(`#${id}`)!; button.disabled = false;
    button.onclick = () => {
      if (id === "raw") { style.averageTradeSize = false; style.cellValues = "auto"; missing = false; }
      if (id === "average") { style.averageTradeSize = true; style.cellValues = "auto"; missing = false; }
      if (id === "counts") { style.cellValues = "bid-ask-trades"; missing = false; }
      if (id === "missing") { style.cellValues = "bid-ask-trades"; missing = true; }
      void chart.setMarket({ data: [...bars] }).then(() => { chart.setVisibleRange({ from: start - minute, to: start + 6 * minute }); });
    };
  }
});
