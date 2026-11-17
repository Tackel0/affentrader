import { Vela, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { buildSessionVolumeProfiles } from "@/lib/orderflow/volumeProfileModel";
import { defaultVolumeProfile } from "@/lib/orderflow/volumeProfileSettings";
import { paintVolumeProfiles } from "@/lib/orderflow/volumeProfileRenderer";
const start = Date.UTC(2026, 10, 4, 12), minute = 60000;
let revealed = 60;
const style = { ...defaultVolumeProfile(), sessionStartMinutes: 720, sessionMinutes: 60, rowSize: 1,
  showDevelopingPoc: true, showDevelopingValueArea: true, showPoc: false, showValueArea: false, showLabels: false,
  pocColor: "#d52c43", valueLineColor: "#245acc" };
const price = (index: number) => 100 + Math.floor(index / 8) % 5;
const bars = (): OHLCV[] => Array.from({ length: revealed }, (_, i) => ({ time: start + i * minute,
  open: price(i), close: price(i) + .5, high: price(i) + 1.5, low: price(i) - 1, volume: (i + 1) * 2 }));
const model = () => buildSessionVolumeProfiles(Array.from({ length: revealed }, (_, i) => ({ id: String(i), symbol: "SVP-FIXTURE",
  time: start + i * minute + 1000, price: price(i), quantity: i + 1, side: i % 2 ? "buy" as const : "sell" as const, simulated: true })), style, "SVP-FIXTURE", undefined, "1m");
registerRendererLayer({ id: "svp-developing-fixture", create: () => {
  let canvas: HTMLCanvasElement | undefined;
  return { mount(value) { canvas = value; }, render(args) {
    const ctx = canvas?.getContext("2d"); if (!ctx || !canvas) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.scale(args.coords.dpr, args.coords.dpr);
    const current = model(); paintVolumeProfiles(ctx, args, { style, model: current });
    const point = current.sessions[0].developing!.at(-1)!;
    document.querySelector("#status")!.textContent = `SIMULATED · ${revealed} revealed candles · ${current.sessions[0].developing!.length} prefix points · final POC ${point.poc} · VA [${point.val}, ${point.vah}) · POC ${style.showDevelopingPoc ? "on" : "off"} / VA ${style.showDevelopingValueArea ? "on" : "off"}`;
  } };
} });
const chart = new Vela(document.querySelector<HTMLElement>("#chart")!, { symbol: "SVP-FIXTURE", timeframe: "1m", live: false,
  bars: 60, theme: "light", volume: false, drawings: { toolbar: false }, visibleRange: { from: start, to: start + 60 * minute }, animations: { intro: false } },
{ dataFeed: { load: async config => config.data ?? bars(), subscribe: () => () => {} } });
void chart.ready().then(async () => {
  await chart.historyComplete();
  for (const id of ["prefix", "full", "poc", "va"] as const) {
    const button = document.querySelector<HTMLButtonElement>(`#${id}`)!; button.disabled = false;
    button.onclick = () => {
      if (id === "prefix") revealed = 20;
      if (id === "full") revealed = 60;
      if (id === "poc") style.showDevelopingPoc = !style.showDevelopingPoc;
      if (id === "va") style.showDevelopingValueArea = !style.showDevelopingValueArea;
      void chart.setMarket({ data: bars() });
    };
  }
});
