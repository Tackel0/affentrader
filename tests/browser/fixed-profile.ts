import { Vela, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { registerFixedProfileConstruction } from "@/lib/drawings/fixedProfilePlugin";
registerFixedProfileConstruction();
const start = Date.UTC(2026, 9, 1), minute = 60000;
const bars: OHLCV[] = Array.from({ length: 5001 }, (_, index) => {
  const open = 100 + Math.sin(index / 37) * 10, close = open + Math.sin(index) * .7;
  return { time: start + index * minute, open, close, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, volume: 100 };
});
const status = document.querySelector<HTMLOutputElement>("#status")!;
let clicks = 0, frames = 0, previous = performance.now(), maxGap = 0;
document.querySelector<HTMLButtonElement>("#pulse")!.onclick = event => { (event.currentTarget as HTMLButtonElement).textContent = `Responsiveness counter: ${++clicks}`; };
function heartbeat(now: number) {
  maxGap = Math.max(maxGap, now - previous); previous = now;
  document.querySelector<HTMLOutputElement>("#heartbeat")!.textContent = `Animation frames: ${++frames} · maximum gap: ${Math.round(maxGap)} ms`;
  requestAnimationFrame(heartbeat);
}
requestAnimationFrame(heartbeat);
registerRendererLayer({ id: "fixture-profile-bars", create: () => ({ mount() {}, render: args => { status.textContent = `${args.bars.length} native bars · explicitly simulated fixture`; } }) });
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "PROFILE-FIXTURE", timeframe: "1m", bars: 5001, live: false, theme: "dark", drawings: { toolbar: false },
  visibleRange: { from: bars[0].time, to: bars.at(-1)!.time }, animations: { intro: false } }, { dataFeed: {
    load: async () => bars,
    subscribe: () => () => {},
    symbolInfo: () => ({ ticker: "PROFILE-FIXTURE", type: "crypto", timezone: "UTC", currency: "TEST", mintick: .01, pricescale: 100, session: "24x7" }),
  } });
async function ready() {
  await chart.ready(); await chart.historyComplete();
  const drawing = chart.drawings.add("fixedrangevp", { paneId: "price", anchors: [{ time: bars[0].time, price: 100 }, { time: bars.at(-1)!.time, price: 100 }], props: { rows: 32 } });
  if (!drawing) throw new Error("Native profile drawing is unavailable.");
  const update = (developing: boolean) => chart.drawings.update(drawing.id, { props: { ...drawing.serialize().props, showDevelopingPoc: developing, showDevelopingVa: developing } });
  document.querySelector<HTMLButtonElement>("#fail")!.onclick = () => {
    chart.drawings.update(drawing.id, { anchors: [{ time: bars[0].time, price: 100 }, { time: bars.at(-1)!.time, price: 100 }],
      props: { ...drawing.serialize().props, showDevelopingPoc: true, showDevelopingVa: true } });
  };
  document.querySelector<HTMLButtonElement>("#recover")!.onclick = () => { update(false); };
  document.querySelector<HTMLButtonElement>("#develop")!.onclick = () => {
    chart.drawings.update(drawing.id, { anchors: [{ time: bars[0].time, price: 100 }, { time: bars[4999].time, price: 100 }],
      props: { ...drawing.serialize().props, showDevelopingPoc: true, showDevelopingVa: true } });
  };
  document.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = false; });
}
void ready().catch(error => { status.textContent = `FAIL: ${error instanceof Error ? error.message : String(error)}`; });
