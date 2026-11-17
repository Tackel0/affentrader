import { Vela, registerChartType, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { defaultFootprint, paintFootprintBar } from "@/lib/orderflow/footprint";
import { footprints } from "@/lib/orderflow/math";
import { footprintDisplayBar } from "@/lib/orderflow/footprintCells";
import type { Tick } from "@/types/trading";

const start = Date.UTC(2026, 10, 5, 12), minute = 60000;
const cases: Array<{ label: string; rows: Array<[number, number, "buy" | "sell"]>; minVolume?: number }> = [
  { label: "A · lone row", rows: [[100, 9, "buy"]] },
  { label: "B · observed zero", rows: [[100, 1, "buy"], [101, 9, "buy"]] },
  { label: "C · missing row", rows: [[100, 1, "buy"], [102, 9, "buy"]] },
  { label: "D · hidden neighbor", rows: [[100, 1, "sell"], [101, 9, "buy"], [101, 9, "sell"], [102, 1, "buy"]], minVolume: 2 },
  { label: "E · both diagonals", rows: [[99, 2, "sell"], [100, 6, "buy"], [100, 6, "sell"], [101, 2, "buy"]] },
];
const prints = cases.map((sample, i) => footprintDisplayBar(footprints(sample.rows.map(([price, quantity, side], j): Tick => ({ id: `${i}:${j}`, symbol: "DIAGONAL-FIXTURE", time: start + i * minute + j + 1, price, quantity, side, tradeCount: 1, simulated: true })), "1m", 1)[0], 1, { imbalanceRatio: 3, minVolume: sample.minVolume ?? 0 }));
const bars: OHLCV[] = prints.map(bar => ({ time: bar.time, low: 98.5, high: 103.5, open: 100, close: 101, volume: bar.volume }));
registerChartType({ id: "diagonal-fixture", label: "Observed diagonals", basePainting: "none" });
registerRendererLayer({ id: "diagonal-fixture", placement: "above-data", create: () => {
  let canvas: HTMLCanvasElement | undefined;
  return { mount(value) { canvas = value; }, render(args) {
    const ctx = canvas?.getContext("2d"); if (!ctx || !canvas) return;
    ctx.setTransform(args.coords.dpr, 0, 0, args.coords.dpr, 0, 0); ctx.clearRect(0, 0, canvas.width / args.coords.dpr, canvas.height / args.coords.dpr);
    prints.forEach((bar, i) => {
      paintFootprintBar(ctx, args, bar, undefined, 1, { ...defaultFootprint(), volumeMode: "bid-ask-ladder", candleVisible: false, pocVisible: false, valueAreaVisible: false, imbalanceVisible: true, imbalanceRecolor: true }, { width: args.coords.pxPerBar() * .8, offset: 0, within: true });
      ctx.fillStyle = args.theme.textColor; ctx.font = "11px Arial"; ctx.textAlign = "center";
      ctx.fillText(cases[i].label, args.coords.timeToX(bar.time), args.bounds.top + 25, args.coords.pxPerBar() - 8);
    });
    document.querySelector("#status")!.textContent = prints.map((bar, i) => `${String.fromCharCode(65 + i)}: buy=${bar.levels.filter(r => r.buyImbalance).length}, sell=${bar.levels.filter(r => r.sellImbalance).length}`).join(" · ");
  } };
} });
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "DIAGONAL-FIXTURE", timeframe: "1m", live: false, priceStyle: "diagonal-fixture", theme: "light", volume: false, drawings: { toolbar: false }, animations: { intro: false } }, { dataFeed: { load: async cfg => cfg.data ?? bars, subscribe: () => () => {} } });
void chart.ready().then(async () => { await chart.historyComplete(); chart.setVisibleRange({ from: start - minute, to: start + 5 * minute }); });
