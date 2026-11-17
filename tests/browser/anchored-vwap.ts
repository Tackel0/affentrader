import { Vela, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { registerAnchoredVwapConstruction } from "@/lib/drawings/anchoredVwapPlugin";
registerAnchoredVwapConstruction();
const start = Date.UTC(2026, 9, 1), minute = 60000;
const bars: OHLCV[] = Array.from({ length: 200 }, (_, index) => {
  const price = 100 + Math.sin(index / 15) * 10;
  return { time: start + index * minute, open: price - .5, close: price, high: price + 1, low: price - 1, volume: 100 };
});
const status = document.querySelector<HTMLOutputElement>("#status")!;
registerRendererLayer({ id: "fixture-vwap-bars", create: () => ({ mount() {}, render: args => { status.textContent = `${args.bars.length} native bars · SIMULATED fixture`; } }) });
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "VWAP-FIXTURE", timeframe: "1m", bars: 200, live: false, theme: "dark", drawings: { toolbar: false },
  visibleRange: { from: bars[0].time, to: bars.at(-1)!.time }, animations: { intro: false } }, { dataFeed: {
    load: async config => config.data ?? bars, subscribe: () => () => {},
    symbolInfo: () => ({ ticker: "VWAP-FIXTURE", type: "crypto", timezone: "UTC", currency: "TEST", mintick: .01, pricescale: 100, session: "24x7" }),
  } });
async function ready() {
  await chart.ready(); await chart.historyComplete();
  if (!chart.drawings.add("anchoredvwap", { paneId: "price", anchors: [{ time: start, price: 100 }] })) throw new Error("Native Anchored VWAP is unavailable.");
  document.querySelector<HTMLButtonElement>("#zero")!.onclick = () => { void chart.setMarket({ data: bars.map(bar => ({ ...bar, volume: 0 })) }); };
  document.querySelector<HTMLButtonElement>("#missing")!.onclick = () => { void chart.setMarket({ data: bars.slice(1) }); };
  document.querySelector<HTMLButtonElement>("#recover")!.onclick = () => { void chart.setMarket({ data: bars }); };
  document.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = false; });
}
void ready().catch(error => { status.textContent = `FAIL: ${error instanceof Error ? error.message : String(error)}`; });
