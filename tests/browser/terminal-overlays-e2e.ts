import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { DARK_THEME, NativeRenderer, Vela, type OHLCV } from "@luxalgo/vela";
import { PineWorkerEngine } from "@luxalgo/vela-pinets";
import { bindCellContext } from "@/lib/chart/cellContext";
import { attachStudyNoticeHost, currentStudyNotices } from "@/lib/chart/studyNotices";
import { pineEngineOptions } from "@/lib/indicators/engineOptions";
import { STRUCTURE_SCRIPT } from "@/lib/indicators/scripts";
import { studyTradeSource } from "@/lib/orderflow/studyTradeSource";
import { countIds } from "@/lib/orderflow/tradeCount";
import { LIQUIDATION_HEATMAP } from "@/lib/orderflow/liquidationHeatmap";
import { TPO_OVERLAY_ID } from "@/lib/orderflow/tpoOverlay";
import { registerOrderflowPlugins } from "@/lib/orderflow/velaPlugins";
import { popoutId, scopedName } from "@/lib/windowScope";
import { AffenTerminalWindow } from "@/components/AffenTerminalWindow";
import { OsintMapPanel } from "@/components/OsintMapPanel";
import { useChartStore } from "@/stores/useChartStore";
import type { Tick } from "@/types/trading";

export interface OverlayPixelCheck {
  name: string;
  diffPixels: number;
  restoredDiffPixels: number;
}

export interface MainRouteResult {
  scopeOnMainPath: { popoutId: string | null; scopedKey: string };
  chartOverlays: {
    canvasWidth: number;
    canvasHeight: number;
    checks: OverlayPixelCheck[];
    allVisibleDiffPixels: number;
  };
  osintMap: {
    svgPathCount: number;
    landPathChars: number;
    markerShapesBeforeFilter: number;
    markerShapesAfterHideTankers: number;
    initialTransform: string;
    zoomedTransform: string;
    hasBalticRegionalLabel: boolean;
  };
}

export interface TerminalRouteResult {
  scopeOnTerminalPath: {
    popoutId: string | null;
    scopedKey: string;
    mainStoragePreserved: boolean;
    terminalStorageCreated: boolean;
  };
  terminalGui: {
    renderedButtons: number;
    stayedOffAfterClick: boolean;
    persistedOffAcrossReload?: boolean;
    switchedViewTextLen: number;
    osintTabSvgPaths: number;
  };
}

export type E2EResult = MainRouteResult | TerminalRouteResult;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const waitFrames = async (count = 3) => {
  for (let i = 0; i < count; i++) await nextFrame();
};

async function waitFor<T>(fn: () => T | null | false | undefined, label: string, timeoutMs = 8_000): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const val = fn();
    if (val) return val;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

function verifyIndicatorStatus() {
  const host = document.createElement("div");
  const renderer = new NativeRenderer();
  document.body.append(host);
  renderer.mount(host, DARK_THEME);
  try {
    const handle = renderer.mountIndicator({ id: "status-test", title: "Status test", overlay: true, paneHint: "price", paneId: "price",
      series: [], fills: [], backgrounds: [], priceLines: [], inputs: [], inputValues: {} });
    const indicator = host.querySelector('[data-vela-pane="price"] > div')?.children[2];
    if (!(indicator instanceof HTMLElement)) throw new Error("Indicator status element is missing");
    const observer = new MutationObserver(() => {});
    observer.observe(indicator, { attributes: true, childList: true });
    for (let i = 0; i < 300; i++) renderer.setIndicatorStatus(handle, "idle");
    const redundantWrites = observer.takeRecords().length;
    observer.disconnect();
    if (redundantWrites) throw new Error(`${redundantWrites} legend DOM writes for 300 unchanged idle statuses`);

    renderer.setIndicatorStatus(handle, "loading");
    const dot = indicator.firstElementChild;
    if (!dot || indicator.children.length !== 3) throw new Error("Loading status did not show three dots");
    renderer.setIndicatorStatus(handle, "loading");
    if (indicator.firstElementChild !== dot) throw new Error("Repeated loading status restarted its animation");
    renderer.setIndicatorStatus(handle, "live");
    if (indicator.children.length || !indicator.style.animation) throw new Error("Live status did not show a pulse");
    renderer.setTheme({ ...DARK_THEME, upColor: "#112233" });
    if (getComputedStyle(indicator).backgroundColor !== "rgb(17, 34, 51)") throw new Error("Live status did not take the current theme color");
    renderer.setIndicatorStatus(handle, "idle");
    if (indicator.style.display !== "none") throw new Error("Idle status did not hide the live pulse");
  } finally {
    renderer.destroy();
    host.remove();
  }
}

function verifyStudyNoticeCanvases() {
  const host = document.createElement("div");
  host.style.cssText = "width:450px;height:250px";
  document.body.append(host);
  const cell = { id: "notice-test", symbol: "BTCUSDT", timeframe: "1m", replay: false };
  const unbind = bindCellContext(host, () => cell);
  const renderer = new NativeRenderer();
  renderer.mount(host, DARK_THEME);
  const sizedCanvases = () => [...host.querySelectorAll("canvas")].filter(canvas => canvas.width && canvas.height);
  try {
    renderer.resize();
    const idle = new Set([...host.querySelectorAll("canvas")].filter(canvas => canvas.width === 0 && canvas.height === 0));
    if (!idle.size) throw new Error("Chart did not park any inactive canvases");
    const property = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width")!;
    let allocations = 0;
    Object.defineProperty(HTMLCanvasElement.prototype, "width", { ...property, set(this: HTMLCanvasElement, width: number) {
      if (width > 0 && idle.has(this)) allocations++;
      property.set!.call(this, width);
    } });
    try {
      host.style.width = "475px";
      renderer.resize();
    } finally { Object.defineProperty(HTMLCanvasElement.prototype, "width", property); }
    if (allocations) throw new Error(`Resize restored ${allocations} inactive chart canvas buffers`);
    const initial = new Set(sizedCanvases());
    for (const id of [...Object.values(countIds), "af-cvd", "af-volume-delta"]) {
      const message = `Source coverage for ${id}`;
      renderer.setNativeData(id, { message });
      renderer.resize();
      const added = sizedCanvases().filter(canvas => !initial.has(canvas));
      if (added.length !== 1) throw new Error(`${id} should allocate one canvas for an embedded notice`);

      const detach = attachStudyNoticeHost(cell.id);
      try {
        renderer.resize();
        if (added[0].width !== 0 || currentStudyNotices(cell)[0]?.message !== message) {
          throw new Error(`${id} should route to the accessible notice host and release its canvas`);
        }
        renderer.setNativeData(id, null);
        renderer.resize();
        if (currentStudyNotices(cell).length) throw new Error(`${id} left a stale notice`);
      } finally { detach(); }
      renderer.resize();
      if (sizedCanvases().length !== initial.size) throw new Error(`${id} left an unused notice canvas`);
    }
  } finally { renderer.destroy(); unbind(); host.remove(); }
}

function captureRgba(chart: Vela): { width: number; height: number; data: Uint8ClampedArray } {
  const canvas = chart.renderer.screenshotCanvas();
  if (!canvas || !canvas.width || !canvas.height) {
    throw new Error("Vela screenshotCanvas() returned null or zero-sized canvas");
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable on screenshot canvas");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(img.data) };
}

function diffRgbaPixels(
  a: { width: number; height: number; data: Uint8ClampedArray },
  b: { width: number; height: number; data: Uint8ClampedArray },
): number {
  if (a.width !== b.width || a.height !== b.height) return -1;
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      Math.abs(a.data[i] - b.data[i]) > 2 ||
      Math.abs(a.data[i + 1] - b.data[i + 1]) > 2 ||
      Math.abs(a.data[i + 2] - b.data[i + 2]) > 2 ||
      Math.abs(a.data[i + 3] - b.data[i + 3]) > 2
    ) {
      changed++;
    }
  }
  return changed;
}

function describePixelChanges(a: ReturnType<typeof captureRgba>, b: ReturnType<typeof captureRgba>): string {
  const bounds = { left: a.width, top: a.height, right: 0, bottom: 0 };
  for (let i = 0; i < a.data.length; i += 4) {
    if ([0, 1, 2, 3].every(channel => Math.abs(a.data[i + channel] - b.data[i + channel]) <= 2)) continue;
    const x = (i / 4) % a.width;
    const y = Math.floor(i / 4 / a.width);
    bounds.left = Math.min(bounds.left, x);
    bounds.top = Math.min(bounds.top, y);
    bounds.right = Math.max(bounds.right, x);
    bounds.bottom = Math.max(bounds.bottom, y);
  }
  return `x=${bounds.left}..${bounds.right}, y=${bounds.top}..${bounds.bottom}`;
}

function buildSyntheticBarsAndTrades() {
  const minute = 60_000;
  const start = Date.UTC(2026, 10, 10, 12, 0, 0);
  // Waypoints shaping clear 5-bar swings, BoS breakouts, and a CHoCH reversal so SMC + Divergences fire cleanly.
  const closes = [
    100.0, 100.8, 101.5, 102.3, 103.4, 104.6, 105.9, 107.2, 108.4, 107.1, // 0..9 peak ~108.4 at bar 8
    105.8, 104.4, 103.1, 101.8, 100.7, 101.9, 103.2, 104.5, 106.0, 107.4, // 10..19 trough 100.7 at bar 14
    108.9, 110.2, 111.1, 112.0, 112.8, 111.5, 110.1, 108.8, 107.2, 106.1, // 20..29 BoS peak ~112.8 at bar 24
    105.2, 104.6, 105.8, 107.3, 109.1, 111.0, 112.6, 114.2, 115.6, 116.8, // 30..39 higher low 104.6 at bar 31 -> BoS peak 116.8
    115.4, 113.9, 112.3, 110.9, 109.6, 109.0, 110.4, 112.0, 113.8, 115.4, // 40..49 swing low 109.0 at bar 45
    117.1, 118.4, 117.2, 115.0, 112.5, 109.8, 107.4, 105.2, 103.1, 101.2, // 50..59 sharp CHoCH breaking 109.0 -> 101.2
    100.6, 102.0, 103.6, 105.5, 107.2, 108.8, 110.5, 111.8, 112.4, 111.2, // 60..69 lower trough 100.6 at 60 -> bullish recovery
    109.7, 108.3, 107.1, 108.2, 109.9, 111.6, 113.4, 114.8, 115.9, 114.7, // 70..79
    113.5, 112.4, 111.8, 113.1, 114.6, 116.0, 117.3, 118.1, 116.8, 115.6, // 80..89
  ];

  const bars: OHLCV[] = [];
  const trades: Tick[] = [];
  let tradeSeq = 1;

  const pushTrades = (
    barIndex: number,
    barOpenTime: number,
    levels: Array<{ price: number; side: "buy" | "sell"; qty: number; offsetMs: number }>,
  ) => {
    for (const lvl of levels) {
      trades.push({
        id: `t-${barIndex}-${tradeSeq}`,
        symbol: "BTCUSDT",
        time: barOpenTime + lvl.offsetMs,
        price: Number(lvl.price.toFixed(2)),
        quantity: lvl.qty,
        side: lvl.side,
        simulated: false,
        seq: tradeSeq++,
      });
    }
  };

  for (let i = 0; i < closes.length; i++) {
    const time = start + i * minute;
    const prev = i === 0 ? 99.6 : closes[i - 1];
    const close = closes[i];
    const open = prev;
    let high = Math.max(open, close) + 0.55;
    let low = Math.min(open, close) - 0.55;

    // Special structural/orderflow bars:
    // Bar 14: Bullish hammer absorption (large sell volume at wick low, small body closing up)
    // Bar 24: Strong positive-delta Swing High 1 (112.8 -> 113.4 high)
    // Bar 39: Higher Swing High 2 (116.8 -> 117.5 high) with heavy negative delta -> Bearish Delta Divergence + Bearish ABS
    // Bar 45: Swing Low 1 (109.0 -> 108.4 low) with heavy negative delta
    // Bar 60: Lower Swing Low 2 (100.6 -> 99.9 low) with heavy positive delta -> Bullish Delta Divergence + Bullish ABS
    // Bar 51: Exhaustion peak (118.4 -> 119.2 wick) with tiny tail print + large rejection
    const levels: Array<{ price: number; side: "buy" | "sell"; qty: number; offsetMs: number }> = [];

    if (i === 14 || i === 60) {
      low -= 1.1;
      // Bullish absorption + bullish delta divergence at bar 60
      levels.push(
        { price: low + 0.05, side: "sell", qty: i === 14 ? 2600 : 120, offsetMs: 5_000 },
        { price: low + 0.15, side: "buy", qty: i === 60 ? 2900 : 900, offsetMs: 12_000 },
        { price: close, side: "buy", qty: 1800, offsetMs: 42_000 },
      );
    } else if (i === 24) {
      high += 0.6;
      levels.push(
        { price: open + 0.2, side: "buy", qty: 2200, offsetMs: 10_000 },
        { price: high - 0.05, side: "buy", qty: 1200, offsetMs: 25_000 },
        { price: close, side: "sell", qty: 200, offsetMs: 45_000 },
      );
    } else if (i === 39 || i === 51) {
      high += 0.9;
      // Bearish absorption & bearish delta divergence at bar 39; exhaustion tail at bar 51
      levels.push(
        { price: Math.min(open, close) + 0.1, side: "buy", qty: 500, offsetMs: 5_000 },
        { price: high - 0.3, side: "buy", qty: i === 39 ? 350 : 420, offsetMs: 15_000 },
        { price: high - 0.02, side: "buy", qty: i === 51 ? 2 : 180, offsetMs: 22_000 }, // thin tail on bar 51
        { price: close, side: "sell", qty: 2600, offsetMs: 48_000 },
      );
    } else if (i === 45) {
      low -= 0.7;
      levels.push(
        { price: open - 0.1, side: "sell", qty: 1800, offsetMs: 12_000 },
        { price: low + 0.1, side: "sell", qty: 900, offsetMs: 28_000 },
        { price: close, side: "buy", qty: 200, offsetMs: 44_000 },
      );
    } else {
      const bull = close >= open;
      const buyVol = bull ? 620 + (i % 5) * 140 : 210 + (i % 4) * 50;
      const sellVol = bull ? 210 + (i % 4) * 50 : 620 + (i % 5) * 140;
      levels.push(
        { price: low + (high - low) * 0.25, side: bull ? "buy" : "sell", qty: Math.round((bull ? buyVol : sellVol) * 0.6), offsetMs: 15_000 },
        { price: low + (high - low) * 0.75, side: bull ? "buy" : "sell", qty: Math.round((bull ? buyVol : sellVol) * 0.4), offsetMs: 32_000 },
        { price: (open + close) / 2, side: bull ? "sell" : "buy", qty: bull ? sellVol : buyVol, offsetMs: 45_000 },
      );
    }

    const totalVol = levels.reduce((sum, lvl) => sum + lvl.qty, 0);
    bars.push({
      time,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: totalVol,
    });
    pushTrades(i, time, levels);
  }

  return { start, minute, bars, trades };
}

async function runNativeOverlaysE2E(): Promise<MainRouteResult["chartOverlays"]> {
  const chartEl = document.querySelector<HTMLElement>("#chart");
  if (!chartEl) throw new Error("#chart element missing");

  const { start, minute, bars, trades } = buildSyntheticBarsAndTrades();
  const buyVolume = trades.reduce((sum, t) => sum + (t.side === "buy" ? t.quantity : 0), 0);
  const sellVolume = trades.reduce((sum, t) => sum + (t.side === "sell" ? t.quantity : 0), 0);
  studyTradeSource.clear("BTCUSDT");
  studyTradeSource.install({
    coverage: "observed-only",
    selection: { symbol: "BTCUSDT", from: start, to: start + bars.length * minute },
    trades,
    buyVolume: String(buyVolume),
    sellVolume: String(sellVolume),
    delta: String(buyVolume - sellVolume),
    first: trades[0]?.time ?? start,
    last: trades.at(-1)?.time ?? start,
  });

  registerOrderflowPlugins();
  verifyIndicatorStatus();
  verifyStudyNoticeCanvases();
  const disposeCtx = bindCellContext(
    chartEl,
    () => ({ id: "e2e-cell", symbol: "BTCUSDT", timeframe: "1m", replay: false, replayThrough: null }),
  );

  const chart = new Vela(
    chartEl,
    {
      symbol: "BTCUSDT",
      timeframe: "1m",
      bars: bars.length,
      live: false,
      theme: "dark",
      nativeBackend: "canvas2d",
      drawings: { toolbar: false },
      volume: false,
      animations: { intro: false, zoom: 100, pan: 80 },
      visibleRange: { from: start - minute, to: start + (bars.length + 1) * minute },
    },
    {
      dataFeed: {
        load: async () => bars,
        subscribe: () => () => {},
        symbolInfo: () => ({
          ticker: "BTCUSDT",
          type: "crypto",
          timezone: "UTC",
          currency: "USDT",
          mintick: 0.01,
          pricescale: 100,
          session: "24x7",
        }),
      },
    },
  );

  await chart.ready();
  await chart.historyComplete();
  chart.setVisibleRange({ from: start - minute, to: start + (bars.length + 1) * minute });
  chart.registerEngine("pine", new PineWorkerEngine(pineEngineOptions()));
  await waitFrames(4);

  const checks: OverlayPixelCheck[] = [];

  const waitUntilSettled = async (maxMs = 3_000) => {
    const deadline = performance.now() + maxMs;
    await waitFrames(4);
    let prev = captureRgba(chart);
    while (performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 120));
      await waitFrames(2);
      const curr = captureRgba(chart);
      if (diffRgbaPixels(prev, curr) === 0) return curr;
      prev = curr;
    }
    return prev;
  };

  async function afterScriptRun<T>(id: string, action: () => T): Promise<T> {
    let completed = false;
    const off = chart.on("script:run", (run) => {
      if (run.id === id && run.complete) completed = true;
    });
    try {
      const result = action();
      await waitFor(() => completed, `${id} computed over complete history`);
      return result;
    } finally {
      off();
    }
  }

  const measureOverlay = async (
    name: string,
    addFn: () => ReturnType<Vela["addNativeIndicator"]>,
    minExpectedDiff: number,
    timeoutMs = 6_000,
    scriptId?: string,
  ) => {
    const beforeAddWait = captureRgba(chart);
    // A pixel delta can come from the loading legend. Wait for Pine's completed
    // render before taking either visible snapshot, then keep the pixel checks.
    const handle = scriptId ? await afterScriptRun(scriptId, addFn) : addFn();
    let settledVisible = beforeAddWait;
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      settledVisible = await waitUntilSettled(1_500);
      if (diffRgbaPixels(beforeAddWait, settledVisible) >= minExpectedDiff) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    handle.setVisible(false);
    const hiddenBaseline = await waitUntilSettled(1_500);
    const hideDelta = diffRgbaPixels(hiddenBaseline, settledVisible);
    if (hideDelta < minExpectedDiff) {
      throw new Error(`${name} hide transition delta too small (${hideDelta} < ${minExpectedDiff} px)`);
    }

    if (scriptId) await afterScriptRun(scriptId, () => handle.setVisible(true));
    else handle.setVisible(true);
    let bestDiff = 0;
    const visDeadline = performance.now() + timeoutMs;
    while (performance.now() < visDeadline) {
      await waitFrames(2);
      bestDiff = diffRgbaPixels(hiddenBaseline, captureRgba(chart));
      if (bestDiff >= minExpectedDiff) break;
      await new Promise((r) => setTimeout(r, 60));
    }
    if (bestDiff < minExpectedDiff) {
      throw new Error(`${name} re-show rendered insufficient canvas delta (${bestDiff} < ${minExpectedDiff} px)`);
    }

    handle.setVisible(false);
    const hiddenAfter = await waitUntilSettled(1_500);
    const restoredDiffPixels = diffRgbaPixels(hiddenBaseline, hiddenAfter);
    if (restoredDiffPixels !== 0) {
      throw new Error(`${name} setVisible(false) left ${restoredDiffPixels} residual pixels (${describePixelChanges(hiddenBaseline, hiddenAfter)})`);
    }
    checks.push({ name, diffPixels: bestDiff, restoredDiffPixels });
    return handle;
  };

  const vnHandle = await measureOverlay(
    "af-volume-nodes",
    () => chart.addNativeIndicator("af-volume-nodes", { inputs: { rows: 24, showHvn: true, showLvn: true } }),
    100,
  );
  await measureOverlay(
    LIQUIDATION_HEATMAP,
    () => chart.addNativeIndicator(LIQUIDATION_HEATMAP, { inputs: { leverages: "20× / 50× / 100×" } }),
    300,
  );
  await measureOverlay(TPO_OVERLAY_ID, () => chart.addNativeIndicator(TPO_OVERLAY_ID), 300);
  const sigHandle = await measureOverlay(
    "af-orderflow-signals",
    () => chart.addNativeIndicator("af-orderflow-signals", { inputs: { showAbsorption: true, showExhaustion: true } }),
    40,
  );
  const ddHandle = await measureOverlay(
    "af-delta-divergence",
    () => chart.addNativeIndicator("af-delta-divergence", { inputs: { pivotRadius: 2 } }),
    40,
  );
  const smcHandle = await measureOverlay(
    "STRUCTURE_SCRIPT",
    () =>
      chart.addIndicator(STRUCTURE_SCRIPT, {
        id: "e2e-structure",
        title: "Structure",
        inputs: { "Swing length": 5, "Order blocks": true, "Fair value gaps": true },
      }),
    100,
    8_000,
    "e2e-structure",
  );

  await waitFrames(4);
  const allHiddenBaseline = captureRgba(chart);
  vnHandle.setVisible(true);
  sigHandle.setVisible(true);
  ddHandle.setVisible(true);
  await afterScriptRun(smcHandle.id, () => smcHandle.setVisible(true));
  await waitFrames(8);
  const allVisibleDiffPixels = diffRgbaPixels(allHiddenBaseline, captureRgba(chart));
  if (allVisibleDiffPixels < 200) {
    throw new Error(`Combined overlays rendered insufficient canvas delta (${allVisibleDiffPixels} px)`);
  }

  disposeCtx();
  chart.destroy();
  studyTradeSource.clear("BTCUSDT");

  return {
    canvasWidth: allHiddenBaseline.width,
    canvasHeight: allHiddenBaseline.height,
    checks,
    allVisibleDiffPixels,
  };
}

async function runOsintMapE2E(): Promise<MainRouteResult["osintMap"]> {
  const osintRoot = document.querySelector<HTMLElement>("#osint-root");
  if (!osintRoot) throw new Error("#osint-root element missing");

  const root = createRoot(osintRoot);
  root.render(createElement(OsintMapPanel, { onSelectSymbol: () => {} }));

  let lastDiag = "none";
  const svg = await waitFor(() => {
    const el = osintRoot.querySelector<SVGSVGElement>('svg[role="img"]');
    const text = (osintRoot.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!el) {
      lastDiag = `no-map-svg text=${text.slice(0, 220)}`;
      return null;
    }
    const paths = Array.from(el.querySelectorAll("path"));
    const maxLen = paths.reduce((m, p) => Math.max(m, (p.getAttribute("d") ?? "").length), 0);
    lastDiag = `paths=${paths.length} maxLen=${maxLen} text=${text.slice(0, 220)}`;
    return paths.length >= 3 && maxLen > 5_000 && text.includes("Baltic") ? el : null;
  }, "OsintMapPanel world map paths + Baltic AIS status").catch((err) => {
    throw new Error(`${err.message} [${lastDiag}]`);
  });

  const pathEls = Array.from(svg.querySelectorAll("path"));
  const svgPathCount = pathEls.length;
  const landPathChars = pathEls.reduce((m, p) => Math.max(m, (p.getAttribute("d") ?? "").length), 0);
  const hasBalticRegionalLabel = (osintRoot.textContent ?? "").includes("Baltic / Northern Europe Live AIS") ||
    (osintRoot.textContent ?? "").includes("Baltic / N. Europe AIS");
  if (!hasBalticRegionalLabel) {
    throw new Error("OsintMapPanel did not display regional Baltic AIS label");
  }

  const countMarkers = () => svg.querySelectorAll("circle, polygon").length;
  const markerShapesBeforeFilter = countMarkers();
  if (markerShapesBeforeFilter < 4) {
    throw new Error(`Expected >= 4 OSINT markers rendered in SVG, got ${markerShapesBeforeFilter}`);
  }

  const initialTransform = svg.querySelector("g")?.getAttribute("transform") ?? "";
  const zoomInBtn = osintRoot.querySelector<HTMLButtonElement>('button[title="Zoom in"]');
  if (!zoomInBtn) throw new Error("Zoom in button missing on OsintMapPanel");
  zoomInBtn.click();

  const zoomedTransform = await waitFor(() => {
    const t = svg.querySelector("g")?.getAttribute("transform") ?? "";
    return t !== initialTransform ? t : null;
  }, "OsintMapPanel zoom transform update");

  // Toggle Tanker filter off and confirm marker shapes count drops cleanly
  const tankerBtn = Array.from(osintRoot.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").toLowerCase().includes("tanker"),
  );
  if (!tankerBtn) throw new Error("Tanker filter button missing on OsintMapPanel");
  tankerBtn.click();
  const markerShapesAfterHideTankers = await waitFor(() => {
    const n = countMarkers();
    return n < markerShapesBeforeFilter ? n : null;
  }, "OsintMapPanel tanker filter DOM update");
  tankerBtn.click();

  root.unmount();
  return {
    svgPathCount,
    landPathChars,
    markerShapesBeforeFilter,
    markerShapesAfterHideTankers,
    initialTransform,
    zoomedTransform,
    hasBalticRegionalLabel,
  };
}

async function runTerminalRouteE2E(): Promise<TerminalRouteResult> {
  const isReload = new URLSearchParams(window.location.search).get("verify") === "reload";
  const currentPopout = popoutId();
  const currentScoped = scopedName("affentrader-chart-v1");
  if (currentPopout !== "affen-terminal" || currentScoped !== "affentrader-chart-v1@affen-terminal") {
    throw new Error(`Expected /terminal isolation scope, got popout=${currentPopout}, key=${currentScoped}`);
  }

  const termRoot = document.querySelector<HTMLElement>("#terminal-root");
  if (!termRoot) throw new Error("#terminal-root missing");
  const root = createRoot(termRoot);
  root.render(createElement(AffenTerminalWindow, { initialView: "fa", initialTicker: "INTC" }));

  await waitFor(() => {
    const txt = termRoot.textContent ?? "";
    return termRoot.querySelectorAll("button").length > 8 && txt.includes("Intel") ? true : null;
  }, "AffenTerminalWindow + FundamentalsPanel mount");
  // Let initial /terminal mount effects run
  await new Promise((r) => setTimeout(r, 180));

  const offBtn = Array.from(termRoot.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === "Off",
  );
  if (!offBtn) throw new Error("Link group 'Off' button missing in AffenTerminalWindow");

  let persistedOffAcrossReload: boolean | undefined;
  let stayedOffAfterClick = false;
  if (isReload) {
    persistedOffAcrossReload =
      offBtn.getAttribute("aria-checked") === "true" && offBtn.classList.contains("active");
    if (!persistedOffAcrossReload) {
      throw new Error(
        `Expected persisted 'Off' link group across /terminal reload, class=${offBtn.className}, aria-checked=${offBtn.getAttribute("aria-checked")}`,
      );
    }
    stayedOffAfterClick = true;
  } else {
    offBtn.click();
    await new Promise((r) => setTimeout(r, 80));
    stayedOffAfterClick =
      offBtn.getAttribute("aria-checked") === "true" && offBtn.classList.contains("active");
    if (!stayedOffAfterClick) {
      throw new Error(
        `Expected Off link-chip to stay active after click, class=${offBtn.className}, aria-checked=${offBtn.getAttribute("aria-checked")}`,
      );
    }
  }

  // Verify clicking Trade-Möglichkeiten updates ResearchTerminal view cleanly
  const oppsBtn = Array.from(termRoot.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes("Trade-M"),
  );
  if (!oppsBtn) throw new Error("Trade-Möglichkeiten tab button missing in AffenTerminalWindow");
  oppsBtn.click();
  const switchedViewTextLen = await waitFor(() => {
    const txt = termRoot.textContent ?? "";
    return txt.includes("Trade-Setups aktiv") ? txt.length : null;
  }, "AffenTerminalWindow Opportunities tab switch");

  // Switch into OSINT tab inside ResearchTerminal and confirm d3-geo paths mount inside the terminal pane
  const osintBtn = Array.from(termRoot.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes("OSINT"),
  );
  if (!osintBtn) throw new Error("OSINT tab button missing in AffenTerminalWindow");
  osintBtn.click();
  const osintTabSvgPaths = await waitFor(() => {
    const svg = termRoot.querySelector<SVGSVGElement>('svg[role="img"]');
    const paths = svg ? svg.querySelectorAll("path").length : 0;
    const text = termRoot.textContent ?? "";
    return paths >= 3 && text.includes("Baltic") ? paths : null;
  }, "AffenTerminalWindow OSINT tab switch");

  // Mutate chart store inside /terminal and verify scoped persistence leaves main localStorage untouched
  useChartStore.getState().set({ timeframe: "4h" });
  await new Promise((r) => setTimeout(r, 550));
  const mainStoragePreserved = localStorage.getItem("affentrader-chart-v1") === '{"sentinel":"main"}';
  const terminalStorageCreated = Boolean(localStorage.getItem("affentrader-chart-v1@affen-terminal"));
  if (!mainStoragePreserved || !terminalStorageCreated) {
    throw new Error(
      `Storage isolation failed: mainStoragePreserved=${mainStoragePreserved}, terminalStorageCreated=${terminalStorageCreated}`,
    );
  }

  const renderedButtons = termRoot.querySelectorAll("button").length;
  root.unmount();

  return {
    scopeOnTerminalPath: {
      popoutId: currentPopout,
      scopedKey: currentScoped,
      mainStoragePreserved,
      terminalStorageCreated,
    },
    terminalGui: {
      renderedButtons,
      stayedOffAfterClick,
      ...(persistedOffAcrossReload !== undefined ? { persistedOffAcrossReload } : {}),
      switchedViewTextLen,
      osintTabSvgPaths,
    },
  };
}

export async function runAllE2E(): Promise<E2EResult> {
  if (window.location.pathname === "/terminal" || window.location.pathname.startsWith("/terminal/")) {
    return runTerminalRouteE2E();
  }
  const scopeOnMainPath = {
    popoutId: popoutId(),
    scopedKey: scopedName("affentrader-chart-v1"),
  };
  if (scopeOnMainPath.popoutId !== null || scopeOnMainPath.scopedKey !== "affentrader-chart-v1") {
    throw new Error(`Expected unscoped main storage on /, got ${JSON.stringify(scopeOnMainPath)}`);
  }
  const chartOverlays = await runNativeOverlaysE2E();
  const osintMap = await runOsintMapE2E();
  localStorage.setItem("affentrader-chart-v1", '{"sentinel":"main"}');
  return {
    scopeOnMainPath,
    chartOverlays,
    osintMap,
  };
}

declare global {
  interface Window {
    __e2ePromise?: Promise<E2EResult>;
  }
}

window.__e2ePromise = runAllE2E();
