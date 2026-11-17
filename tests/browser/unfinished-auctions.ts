import { Vela, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { defaultFootprint, paintFootprintBar } from "@/lib/orderflow/footprint";
import { createUnfinishedAuctionCache, paintUnfinishedAuctions } from "@/lib/orderflow/unfinishedAuctions";
import type { FootprintBar } from "@/types/trading";
const start = Date.UTC(2026, 10, 4, 12), minute = 60000;
let revisit = false, dust = false;
const style = { ...defaultFootprint(), rowSize: 1, unfinishedVisible: true, unfinishedWidth: 2, candleVisible: false };
const observed: FootprintBar = { time: start, poc: 100, volume: 12, delta: 0, levels: [
  { price: 100, upperPrice: 101, buyVolume: 3, sellVolume: 3, imbalance: null },
  { price: 102, upperPrice: 103, buyVolume: 3, sellVolume: 3, imbalance: null },
] };
const bars = (): OHLCV[] => Array.from({ length: 8 }, (_, i) => ({ time: start + i * minute,
  open: i === 0 ? 100.5 : 104, close: i === 0 ? 102.5 : 104.5,
  high: i === 0 ? 102.8 : 105, low: i === 0 ? 100.1 : revisit && i === 3 ? 103 : revisit && i === 5 ? 100 : 104, volume: 12 }));
registerRendererLayer({ id: "unfinished-fixture", placement: "above-data", create: () => {
  let canvas: HTMLCanvasElement | undefined; const cache = createUnfinishedAuctionCache();
  return { mount(value) { canvas = value; }, render(args) {
    const ctx = canvas?.getContext("2d"); if (!ctx || !canvas) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.scale(args.coords.dpr, args.coords.dpr);
    const current = dust ? { ...observed, levels: observed.levels.map(row => ({ ...row, buyVolume: .001, sellVolume: .001 })) } : observed;
    paintFootprintBar(ctx, args, current, undefined, 1, style);
    const refs = cache.read([current], args.bars, "1m", 1, 0); paintUnfinishedAuctions(ctx, args, refs, style);
    document.querySelector("#status")!.textContent = `SIMULATED · low edge 100 / high edge 103 · ${refs.length} auction marks · ${refs.filter(r => r.touched !== null).length} observed revisits · rays ${style.unfinishedExtend ? "on" : "off"} · dust ${dust ? "on" : "off"}`;
  } };
} });
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "AUCTION-FIXTURE", timeframe: "1m", live: false,
  bars: 8, theme: "light", volume: false, drawings: { toolbar: false }, visibleRange: { from: start - minute, to: start + 8 * minute }, animations: { intro: false } },
{ dataFeed: { load: async cfg => cfg.data ?? bars(), subscribe: () => () => {} } });
void chart.ready().then(async () => { await chart.historyComplete();
  for (const id of ["untested", "revisited", "rays", "dust"] as const) { const button = document.querySelector<HTMLButtonElement>(`#${id}`)!; button.disabled = false;
    button.onclick = () => { if (id === "rays") style.unfinishedExtend = !style.unfinishedExtend; else if (id === "dust") dust = !dust; else revisit = id === "revisited";
      void chart.setMarket({ data: bars() }).then(() => { chart.setVisibleRange({ from: start - minute, to: start + 8 * minute }); }); };
  }
});
