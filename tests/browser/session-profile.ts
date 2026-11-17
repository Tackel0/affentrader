import { Vela, registerNativeIndicator, registerRendererLayer, type IndicatorHandle, type RendererLayerArgs } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { sessionProfileDescriptor } from "@/lib/orderflow/volumeProfileIndicator";
import { paintVolumeProfiles, type VolumeProfileChannel } from "@/lib/orderflow/volumeProfileRenderer";

const start = Date.UTC(2026, 9, 29), status = document.querySelector<HTMLOutputElement>("#status")!;
let trades: Tick[] = [], receive: ((tick?: Tick) => void) | undefined, handle: IndicatorHandle;
const makeTrade = (i: number): Tick => ({ id: `sim-${i}`, symbol: "SVP-TEST", time: start + i * 100, price: 100 + i % 20,
  quantity: 1, side: i % 2 ? "buy" : "sell", simulated: true });
let frames = 0, clicks = 0, previous = performance.now(), gap = 0, requestStart = 0;
const heartbeat = (now: number) => { gap = Math.max(gap, now - previous); previous = now;
  document.querySelector<HTMLOutputElement>("#heartbeat")!.textContent = `Frames ${++frames} · largest frame gap ${Math.round(gap)} ms`;
  requestAnimationFrame(heartbeat); };
requestAnimationFrame(heartbeat);
document.querySelector<HTMLButtonElement>("#pulse")!.onclick = event => { (event.currentTarget as HTMLButtonElement).textContent = `Responsiveness counter: ${++clicks}`; };
registerNativeIndicator(sessionProfileDescriptor(() => trades, (_symbol, changed) => { receive = changed; return () => { receive = undefined; }; }));
registerRendererLayer({ id: "af-session-profile", create: () => {
  let canvas: HTMLCanvasElement | undefined, args: RendererLayerArgs | undefined, channel: VolumeProfileChannel | undefined;
  const paint = () => {
    if (!canvas || !args) return;
    const ctx = canvas.getContext("2d")!; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.scale(args.coords.dpr, args.coords.dpr);
    const payload = channel?.current;
    if (payload) {
      paintVolumeProfiles(ctx, args, payload);
      status.textContent = payload.message ?? `SIMULATED · ${payload.model?.retained} executions · volume ${payload.model?.sessions.reduce((sum, session) => sum + session.valueArea.total, 0)} · step ${payload.model?.sessions[0]?.step} · ${payload.pending ? "updating" : "settled"} · ${Math.round(performance.now() - requestStart)} ms since request`;
    } else status.textContent = "Study hidden or removed";
  };
  return { mount(element: HTMLCanvasElement) { canvas = element; }, render(value: RendererLayerArgs) {
    if (channel) channel.repaint = undefined;
    args = value; channel = value.data as VolumeProfileChannel | undefined;
    if (channel) channel.repaint = paint; paint();
  }, destroy() { if (channel) channel.repaint = undefined; canvas = undefined; args = undefined; } };
} });
const bars = Array.from({ length: 180 }, (_, i) => ({ time: start + i * 60000, open: 109, close: 110 + Math.sin(i / 9) * 8, high: 120, low: 99, volume: 100 }));
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "SVP-TEST", timeframe: "1m", live: true, theme: "dark", drawings: { toolbar: false },
  visibleRange: { from: start, to: start + 180 * 60000 }, animations: { intro: false } }, { dataFeed: { load: async () => bars, subscribe: () => () => {},
    symbolInfo: () => ({ ticker: "SVP-TEST", type: "crypto", timezone: "UTC", currency: "TEST", mintick: .01, pricescale: 100, session: "24x7" }) } });
void chart.ready().then(() => {
  handle = chart.addNativeIndicator("af-session-profile", { inputs: { rowSize: 1, placement: "Session end" } });
  document.querySelector<HTMLButtonElement>("#load")!.onclick = () => { requestStart = performance.now(); gap = 0;
    trades = Array.from({ length: 100000 }, (_, i) => makeTrade(i)); handle.setInputs({ rowSize: 1 }); };
  document.querySelector<HTMLButtonElement>("#row")!.onclick = () => { requestStart = performance.now(); handle.setInputs({ rowSize: 2 }); };
  document.querySelector<HTMLButtonElement>("#fail")!.onclick = () => { requestStart = performance.now(); handle.setInputs({ rowSize: .000001 }); };
  document.querySelector<HTMLButtonElement>("#race")!.onclick = () => { requestStart = performance.now(); handle.setInputs({ rowSize: 1 }); handle.setInputs({ rowSize: 4 }); };
  document.querySelector<HTMLButtonElement>("#hide")!.onclick = () => handle.setVisible(false);
  document.querySelector<HTMLButtonElement>("#show")!.onclick = () => { requestStart = performance.now(); handle.setVisible(true); };
  document.querySelector<HTMLButtonElement>("#reset")!.onclick = () => { trades = []; receive?.(); };
  document.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = false; });
}).catch(error => { status.textContent = `FAIL: ${String(error)}`; });
