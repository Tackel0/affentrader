import { Vela, registerRendererLayer, type MarketDataFeed, type OHLCV } from "@luxalgo/vela";
import { registerOrderflowPlugins } from "@/lib/orderflow/velaPlugins";
import { bindCellContext } from "@/lib/chart/cellContext";

const baseTime = Date.UTC(2026, 9, 25), interval = 300000;
const source: OHLCV[] = Array.from({ length: 600 }, (_, index) => {
  const open = 100 + Math.sin(index / 17) * 12 + index / 100, close = open + Math.sin(index * 1.7) * 1.3;
  return { time: baseTime + index * interval, open, close, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, volume: 10 + index % 31 };
});
const copies = () => source.map(bar => ({ ...bar }));
const listeners = new Set<(bar: OHLCV) => void>();
registerOrderflowPlugins();
const feed: MarketDataFeed = {
  load: async cfg => copies().slice(-(cfg.bars ?? 600)),
  loadRange: async (_cfg, range) => {
    await new Promise(resolve => setTimeout(resolve, 25));
    const bars = copies().filter(bar => (range.from === undefined || bar.time >= range.from) && (range.to === undefined || bar.time <= range.to));
    return range.from === undefined ? bars.slice(-(range.limit ?? 600)) : bars.slice(0, range.limit ?? 600);
  },
  subscribe: (_cfg, changed) => { listeners.add(changed); return () => { listeners.delete(changed); }; },
  symbolInfo: () => ({ ticker: "FIXTURE", type: "crypto", timezone: "UTC", mintick: .01, pricescale: 100, currency: "TEST", session: "24x7" }),
};
registerRendererLayer({ id: "render-fixture-audit", create: () => {
  let host: HTMLElement | null = null;
  return { mount(canvas) { host = canvas.closest<HTMLElement>("[data-backend]"); }, render(args) {
    const output = host?.querySelector("output");
    if (host) host.dataset.nativeBars = String(args.bars.length);
    const range = args.coords.visibleLogicalRange(), start = Math.max(0, Math.floor(range.from)), end = Math.min(args.bars.length - 1, Math.ceil(range.to));
    if (output) output.textContent = `${args.bars.length} native bars / ${args.coords.barCount} coordinates / ${end - start + 1} visible / ${args.bars.slice(start, end + 1).filter(bar => bar.high > bar.low).length} nonflat`;
  }, destroy() { host = null; } };
} });
const status = document.querySelector<HTMLOutputElement>("#status")!;
const charts: Array<{ chart: Vela; host: HTMLElement; name: string }> = [];
const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
let running = false;
function raster(chart: Vela) {
  const image = chart.renderer.screenshotCanvas(); if (!image) throw new Error("Native snapshot is unavailable.");
  const ctx = image.getContext("2d"); if (!ctx) throw new Error("Snapshot pixels are unavailable.");
  const width = Math.max(1, Math.floor((image.width - 64) / 3)), data = ctx.getImageData(0, 0, width, image.height - 28).data;
  let colored = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (g > 90 && g > r * 1.3 && g > b * 1.1 || r > 150 && r > g * 1.5 && r > b * 1.2) colored++;
  }
  return { colored, image };
}
async function run() {
  if (running) return; running = true; status.textContent = "RUNNING";
  document.querySelectorAll<HTMLButtonElement>("header button").forEach(button => { button.disabled = true; });
  document.querySelector<HTMLTextAreaElement>("#report")!.value = "";
  const results: Array<{ cycle: number; backend: string; baseline: number; colored: number }> = [];
  const negativeControls: Array<{ backend: string; baseline: number; hidden: number }> = [];
  try {
    for (const { chart } of charts) chart.setVisibleRange({ from: source[400].time, to: source[599].time + interval * 6 });
    await frames();
    const baseline = charts.map(({ chart }) => raster(chart).colored);
    if (baseline.some(value => value < 10)) throw new Error(`Insufficient baseline geometry: ${baseline.join(", ")}`);
    for (let i = 0; i < charts.length; i++) {
      const { chart, name } = charts[i];
      try {
        chart.renderer.applyConfig({ candles: { bodyVisible: false, borderVisible: false, wickVisible: false } });
        await frames();
        const hidden = raster(chart).colored;
        negativeControls.push({ backend: name, baseline: baseline[i], hidden });
        if (hidden >= baseline[i] * .35) throw new Error(`${name}: the pixel oracle cannot distinguish missing candles`);
      } finally {
        chart.renderer.applyConfig({ candles: { bodyVisible: true, borderVisible: false, wickVisible: true } });
      }
    }
    for (let cycle = 1; cycle <= 60; cycle++) {
      const bar = { ...source.at(-1)!, close: source.at(-1)!.open + Math.sin(cycle) * .2 };
      for (const changed of listeners) changed({ ...bar });
      if (cycle % 10 === 0) await Promise.all(charts.map(async ({ chart }) => {
        await chart.setMarket({ symbol: "FIXTURE", bars: 600 }); await chart.historyComplete();
        chart.setVisibleRange({ from: source[400].time, to: source[599].time + interval * 6 });
      }));
      if (cycle === 20 || cycle === 40) {
        await Promise.all(charts.map(({ chart }) => chart.replay.start({ from: source[499].time })));
        await frames();
        for (const { host, name } of charts) if (host.dataset.nativeBars !== "500") throw new Error(`${name}: Replay exposed ${host.dataset.nativeBars} bars instead of 500`);
        for (const { chart } of charts) chart.replay.stop();
        await frames();
        for (const { host, name } of charts) if (host.dataset.nativeBars !== "600") throw new Error(`${name}: Replay did not restore all 600 bars`);
      }
      await frames();
      for (let i = 0; i < charts.length; i++) {
        const { chart, name, host } = charts[i], check = raster(chart);
        results.push({ cycle, backend: name, baseline: baseline[i], colored: check.colored });
        host.querySelector<HTMLOutputElement>(".pixels")!.textContent = `Left-third candle pixels: ${check.colored}; baseline ${baseline[i]}`;
        if (check.colored < baseline[i] * .35) {
          const failure = document.querySelector<HTMLImageElement>("#failure")!; failure.src = check.image.toDataURL("image/png"); failure.hidden = false;
          throw new Error(`${name}: older candle geometry dropped at cycle ${cycle}`);
        }
      }
      status.textContent = `RUNNING ${cycle}/60`;
    }
    status.textContent = "PASS · 60 cycles · 120 raster checks · 8 Replay checks · 2 negative controls";
  } catch (error) { status.textContent = `FAIL · ${error instanceof Error ? error.message : String(error)}`; }
  finally { document.querySelector<HTMLTextAreaElement>("#report")!.value = JSON.stringify({ viewport: { width: innerWidth, height: innerHeight }, negativeControls, checks: results }, null, 2); running = false;
    document.querySelectorAll<HTMLButtonElement>("header button").forEach(button => { button.disabled = false; }); }
}
async function start() {
  for (const name of ["canvas2d", "webgl2"] as const) {
    const host = document.querySelector<HTMLElement>(`[data-backend="${name}"]`)!, canvas = host.querySelector<HTMLElement>(".chart")!;
    bindCellContext(canvas, () => ({ id: `fixture-${name}`, symbol: "FIXTURE", timeframe: "5m", replay: false }));
    const chart = new Vela(canvas, { symbol: "FIXTURE", timeframe: "5m", bars: 600, live: true, theme: "dark", nativeBackend: name,
      drawings: { toolbar: false }, volume: false, animations: { intro: false, zoom: 100, pan: 80 },
      visibleRange: { from: source[400].time, to: source[599].time + 6 * interval } }, { dataFeed: feed });
    await chart.ready(); await chart.historyComplete();
    chart.addNativeIndicator("ema", { inputs: { length: 20 } });
    chart.addNativeIndicator("volume", { inputs: { upColor: "#777777", downColor: "#777777" } });
    const active = !!canvas.querySelector<HTMLCanvasElement>('canvas[role="application"]')?.getContext("webgl2");
    host.querySelector("h2")!.textContent = `${name} · actual ${active ? "WebGL2" : "Canvas2D"}`;
    if (name === "webgl2" && !active) throw new Error("WebGL2 is unavailable; a two-backend comparison cannot run on this browser.");
    charts.push({ chart, host, name });
  }
  await frames(); status.textContent = "READY · simulated fixture only";
  document.querySelectorAll<HTMLButtonElement>("header button").forEach(button => { button.disabled = false; });
}
document.querySelector("#run")!.addEventListener("click", () => { void run(); });
document.querySelector("#replay")!.addEventListener("click", () => {
  void Promise.all(charts.map(({ chart }) => chart.replay.start({ from: source[499].time }))).then(() => { status.textContent = "REPLAY · 500 revealed bars"; })
    .catch(error => { status.textContent = `FAIL · ${error instanceof Error ? error.message : String(error)}`; });
});
document.querySelector("#live")!.addEventListener("click", () => { for (const { chart } of charts) chart.replay.stop(); status.textContent = "LIVE FIXTURE · no exchange connection"; });
void start().catch(error => { status.textContent = `FAIL · ${error instanceof Error ? error.message : String(error)}`; });
