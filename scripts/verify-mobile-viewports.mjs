import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { waitForChromePageTarget } from "./chrome-page-target.mjs";

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800, mobile: true },
  { name: "390x844", width: 390, height: 844, mobile: true },
  { name: "768x1024", width: 768, height: 1024, mobile: true },
  { name: "1440x900", width: 1440, height: 900, mobile: false },
];
const COMPACT_NAV_VIEWPORTS = [
  { name: "820x1180", width: 820, height: 1180, mobile: true, deviceScaleFactor: 3, verifySavedLayout: true },
  { name: "1180x820", width: 1180, height: 820, mobile: true, deviceScaleFactor: 3, verifySavedLayout: true },
  { name: "844x390", width: 844, height: 390, mobile: true, deviceScaleFactor: 3 },
];

const TERMINAL_VIEW_TABS = [
  { key: "OPPS", label: "Trade-Möglichkeiten" },
  { key: "FA", label: "Fundamentals (FA)" },
  { key: "SCAN", label: "Stock bases" },
  { key: "MARKETS", label: "Markets" },
  { key: "OSINT", label: "Tanker & Flights (OSINT)", content: '[aria-label="OSINT filter"]' },
  { key: "HEATMAP", label: "Heatmap", content: ".heatmap-panel" },
  { key: "CAPM", label: "CAPM" },
  { key: "NEWS", label: "News" },
];

function resolveChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

function parseArgs(argv) {
  const opts = {
    baseUrl: "",
    password: "",
    standaloneDir: "",
    skipHealth: false,
    liveApis: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--skip-health") {
      opts.skipHealth = true;
    } else if (arg === "--live-apis") {
      opts.liveApis = true;
    } else if (arg === "--base-url" && argv[i + 1]) {
      opts.baseUrl = argv[++i];
    } else if (arg.startsWith("--base-url=")) {
      opts.baseUrl = arg.slice("--base-url=".length);
    } else if (arg === "--password" && argv[i + 1]) {
      opts.password = argv[++i];
    } else if (arg.startsWith("--password=")) {
      opts.password = arg.slice("--password=".length);
    } else if (arg === "--standalone-dir" && argv[i + 1]) {
      opts.standaloneDir = argv[++i];
    } else if (arg.startsWith("--standalone-dir=")) {
      opts.standaloneDir = arg.slice("--standalone-dir=".length);
    }
  }
  return opts;
}

async function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("Failed to acquire free TCP port")));
        return;
      }
      const { port } = addr;
      srv.close(() => resolvePort(port));
    });
  });
}

function buildMockApiPayload(urlStr) {
  const url = new URL(urlStr, "http://127.0.0.1");
  const now = Date.now();

  if (url.pathname === "/api/osint-map") {
    return {
      fetchedAt: now,
      chokepoints: [
        {
          id: "hormuz",
          name: "Strait of Hormuz",
          region: "Middle East",
          lat: 26.56,
          lon: 56.25,
          flowSummary: "~21 mb/d crude & LNG",
          shareGlobalOilPct: "21% seaborne oil",
          correlatedSymbols: [{ symbol: "YF:BZ=F", label: "Brent Crude" }],
        },
        {
          id: "malacca",
          name: "Strait of Malacca",
          region: "Southeast Asia",
          lat: 1.43,
          lon: 102.89,
          flowSummary: "Key Asia energy corridor",
          shareGlobalOilPct: "16 mb/d",
          correlatedSymbols: [{ symbol: "YF:FRO", label: "Frontline" }],
        },
      ],
      routes: [
        {
          id: "baltic-north",
          name: "Baltic -> North Sea",
          commodity: "crude",
          coordinates: [
            [24.75, 59.43],
            [12.56, 55.67],
            [4.47, 51.92],
          ],
        },
      ],
      vessels: [
        {
          id: "ais-230991000",
          mmsi: 230991000,
          name: "NORDIC TANKER",
          category: "oil-tanker",
          shipType: 80,
          lat: 59.43,
          lon: 24.75,
          sogKnots: 12.4,
          cogDeg: 245,
          destination: "ROTTERDAM",
          updatedAt: now - 30_000,
          source: "Digitraffic Marine AIS",
        },
      ],
      flights: [
        {
          id: "adsb-a12345",
          icao: "a12345",
          callsign: "UAL101",
          aircraftType: "B77W",
          category: "commercial",
          lat: 50.1,
          lon: 8.6,
          altitudeFt: 36000,
          speedKnots: 485,
          headingDeg: 270,
          country: "United States",
          source: "adsb.lol",
        },
      ],
      marineConditions: [
        {
          chokepointId: "hormuz",
          waveHeightM: 1.4,
          swellHeightM: 1.1,
          currentSpeedMs: 0.6,
          severity: "moderate",
        },
      ],
      advisories: [
        {
          id: "adv-1",
          title: "Baltic shipping traffic nominal",
          link: "https://gcaptain.com/",
          publishedAt: new Date(now - 3_600_000).toISOString(),
        },
      ],
      correlatedTickers: [
        { symbol: "YF:BZ=F", label: "Brent Crude", sector: "Energy" },
        { symbol: "YF:FRO", label: "Frontline", sector: "Tanker" },
      ],
      feedStatus: {
        ais: { ok: true, count: 1, provider: "Digitraffic Marine AIS" },
        adsb: { ok: true, count: 1, provider: "adsb.lol" },
        marine: { ok: true, count: 1 },
      },
    };
  }

  if (url.pathname === "/api/feeds") {
    const kind = url.searchParams.get("kind");
    if (kind === "macro") {
      return {
        fearGreed: { value: 58, classification: "Greed", timestamp: Math.floor(now / 1000) },
        crossAssets: [
          { symbol: "YF:^GSPC", label: "S&P 500", price: 5980.4, changePct: 0.42 },
          { symbol: "YF:^VIX", label: "VIX", price: 15.2, changePct: -1.4 },
          { symbol: "BTCUSDT", label: "Bitcoin", price: 91250, changePct: 1.85 },
        ],
        fred: [],
        updatedAt: now,
      };
    }
    if (kind === "news") {
      return {
        items: [
          {
            id: "news-1",
            title: "Semiconductor capex leads US equities higher",
            summary: "Institutional inflows concentrate in large-cap chipmakers.",
            link: "https://example.com/news/1",
            source: "MarketWire",
            published: now - 180_000,
            symbols: ["YF:AAPL", "YF:QCOM"],
          },
        ],
        failed: [],
      };
    }
    if (kind === "yields") return { curves: [] };
    return { events: [] };
  }

  if (url.pathname === "/api/terminal-opportunities") {
    return {
      market: "us",
      benchmark: "SPY",
      benchmarkSession: "2026-11-18",
      generatedAt: now,
      page: Number(url.searchParams.get("page") ?? "0"),
      pages: 1,
      evaluated: 24,
      universe: 24,
      dataSources: ["Yahoo Finance", "TradingView"],
      opportunities: [
        {
          id: "opp-aapl",
          symbol: "YF:AAPL",
          ticker: "AAPL",
          name: "Apple Inc.",
          market: "us",
          sector: "Electronic Technology",
          currency: "USD",
          session: "2026-11-18",
          category: "structural-bottom",
          subType: "bos-hl-reclaim",
          setupLabel: "BOS Reclaim",
          score: 84,
          scoreBreakdown: { Structure: 30, Volume: 27, Valuation: 27 },
          whySetup: ["Higher-low reclaim above EMA20", "Dry-up pullback before expansion"],
          levels: {
            lastClose: 225.4,
            entryZone: [222.0, 226.0],
            invalidation: 214.0,
            target1: 242.0,
            target2: 256.0,
            riskReward: 2.1,
          },
          technicals: {
            rsi14: 56.4,
            ema20: 221.8,
            ema50: 218.2,
            vwap20: 222.5,
            ema20DistPct: 1.6,
            ema50DistPct: 3.3,
            vwap20DistPct: 1.3,
            relativeStrengthPct: 3.1,
            benchmarkReturnPct: 1.1,
            rvol20: 1.35,
            volumeDryUpRatio: 0.72,
            upDownVolumeRatio: 1.32,
            obvDivergence: true,
            adDivergence: false,
            bbBandwidthPct: 5.4,
            bbSqueezePercentile: 28,
            vcpContractions: 2,
            priorDrawdownPct: -11.4,
          },
          fundamentals: {
            ticker: "AAPL",
            name: "Apple Inc.",
            sector: "Electronic Technology",
            currency: "USD",
            marketCapBn: 3400,
            forwardPe: 29.5,
            sectorMedianPe: 28.0,
            historicalMedianPe: 27.0,
            peVsHistoryPct: 9.2,
            evToEbitda: 23.8,
            sectorMedianEvEbitda: 19.0,
            priceToFcf: 31.0,
            fcfYieldPct: 3.2,
            pegRatio: 2.3,
            netDebtToEbitda: 0.1,
            operatingMarginPct: 31.2,
            netMarginPct: 26.1,
            roePct: 142.0,
            epsRevisionPct: 2.1,
            revenueGrowthPct: 8.4,
            analystTarget: 255.0,
            fairValue: 245.0,
            analystConsensus: {
              buy: 24,
              hold: 8,
              sell: 1,
              ratingLabel: "Buy",
              analystCount: 33,
              targetLow: 200,
              targetMean: 255,
              targetHigh: 280,
              recentActions: [],
            },
            insiderBuys90d: 0,
            insiderNetValueUsd: 0,
            recentInsiderFilings: [],
            earningsSurprisePct: 4.1,
            lastEarningsDate: "2026-10-31",
            dataSources: ["Yahoo Finance"],
            source: "tradingview+sec+yahoo",
          },
          chart: [
            { session: "2026-11-14", open: 218, high: 222, low: 217, close: 221, volume: 42_000_000 },
            { session: "2026-11-17", open: 221, high: 225, low: 220, close: 224, volume: 45_000_000 },
            { session: "2026-11-18", open: 224, high: 226.5, low: 223, close: 225.4, volume: 48_000_000 },
          ],
        },
      ],
      unavailable: [],
    };
  }

  if (url.pathname === "/api/terminal-fundamentals") {
    const ticker = (url.searchParams.get("ticker") || "QCOM").toUpperCase();
    return {
      ticker,
      lastClose: 172.5,
      fundamentals: {
        ticker,
        name: `${ticker} Corp.`,
        sector: "Semiconductors",
        currency: "USD",
        marketCapBn: 192.4,
        forwardPe: 16.2,
        sectorMedianPe: 24.0,
        historicalMedianPe: 18.0,
        peVsHistoryPct: -10.0,
        evToEbitda: 12.8,
        sectorMedianEvEbitda: 18.0,
        priceToFcf: 17.5,
        fcfYieldPct: 5.7,
        pegRatio: 1.4,
        netDebtToEbitda: 0.4,
        operatingMarginPct: 29.4,
        netMarginPct: 24.1,
        roePct: 38.5,
        epsRevisionPct: 3.4,
        revenueGrowthPct: 14.2,
        analystTarget: 205.0,
        fairValue: 198.0,
        analystConsensus: {
          buy: 19,
          hold: 10,
          sell: 2,
          ratingLabel: "Buy",
          analystCount: 31,
          targetLow: 155,
          targetMean: 205,
          targetHigh: 240,
          recentActions: [],
        },
        insiderBuys90d: 1,
        insiderNetValueUsd: 250_000,
        recentInsiderFilings: [],
        earningsSurprisePct: 6.2,
        lastEarningsDate: "2026-11-05",
        dataSources: ["SEC EDGAR XBRL", "Yahoo Finance"],
        source: "tradingview+sec+yahoo",
      },
      quant: null,
    };
  }

  if (url.pathname === "/api/terminal-markets") {
    return {
      rows: [
        {
          ticker: "^GSPC",
          label: "S&P 500",
          group: "Indices",
          quote: { close: 5980.4, currency: "USD", session: "2026-11-18", changes: { 1: 0.42, 5: 1.15, 20: 3.8 } },
        },
        {
          ticker: "^NDX",
          label: "Nasdaq 100",
          group: "Indices",
          quote: { close: 20840.2, currency: "USD", session: "2026-11-18", changes: { 1: 0.65, 5: 1.9, 20: 5.1 } },
        },
      ],
    };
  }

  if (url.pathname === "/api/terminal-capm") {
    return {
      ticker: (url.searchParams.get("ticker") || "QCOM").toUpperCase(),
      name: "Qualcomm Inc.",
      benchmark: "S&P 500",
      currency: "USD",
      asOf: "2026-11-18",
      riskFree: 4.25,
      beta: 1.28,
      alpha: 0.04,
      correlation: 0.62,
      r2: 0.38,
      volatility: 0.42,
      capmReturn: 0.11,
      sharpe: 0.48,
      observations: 250,
    };
  }

  if (url.pathname === "/api/stock-heatmap") {
    return {
      market: "us",
      sectors: ["Technology", "Financials"],
      rows: [
        { symbol: "YF:AAPL", ticker: "AAPL", sector: "Technology", marketCapBn: 3400, changePct: 1.2 },
        { symbol: "YF:MSFT", ticker: "MSFT", sector: "Technology", marketCapBn: 3100, changePct: 0.9 },
        { symbol: "YF:JPM", ticker: "JPM", sector: "Financials", marketCapBn: 640, changePct: -0.4 },
      ],
      generatedAt: now,
      source: "Mock",
    };
  }

  if (url.pathname === "/api/stock-base") {
    return {
      market: url.searchParams.get("market") || "us",
      benchmark: "^GSPC",
      benchmarkSession: "2026-11-18",
      benchmarkRevision: "v1",
      generatedAt: now,
      attempted: 24,
      evaluated: 24,
      excluded: 0,
      universe: 24,
      page: Number(url.searchParams.get("page") ?? "0"),
      pages: 1,
      rows: [],
      pendingRetests: [],
      unavailable: [],
    };
  }

  if (url.pathname === "/api/market") {
    const resource = url.searchParams.get("resource");
    const sym = url.searchParams.get("symbol") || "BTCUSDT";
    if (resource === "ticker/24hr") {
      const sample = [
        {
          symbol: "BTCUSDT",
          quoteVolume: "18500000000",
          priceChangePercent: "2.45",
          lastPrice: "91250.00",
          highPrice: "92100.00",
          lowPrice: "89100.00",
          volume: "202740",
          prevClosePrice: "89068.00",
        },
        {
          symbol: "ETHUSDT",
          quoteVolume: "9200000000",
          priceChangePercent: "1.80",
          lastPrice: "3210.00",
          highPrice: "3260.00",
          lowPrice: "3140.00",
          volume: "2866000",
          prevClosePrice: "3153.00",
        },
      ];
      return url.searchParams.get("symbol")
        ? sample.find((s) => s.symbol === sym) ?? sample[0]
        : sample;
    }
    if (resource === "klines") {
      const intraday = /^(\d+)([mhd])$/.exec(url.searchParams.get("interval") ?? "");
      const duration = intraday ? Number(intraday[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[intraday[2]] : 3_600_000;
      const baseTime = Math.floor(now / duration) * duration - 120 * duration;
      const rows = [];
      for (let i = 0; i < 120; i++) {
        const openT = baseTime + i * duration;
        const open = 90500 + i * 12;
        const close = open + (i % 2 === 0 ? 35 : -18);
        const high = Math.max(open, close) + 45;
        const low = Math.min(open, close) - 40;
        rows.push([
          openT,
          open.toFixed(2),
          high.toFixed(2),
          low.toFixed(2),
          close.toFixed(2),
          "125.4",
          openT + duration - 1,
          "11400000",
          420,
          "65.2",
          "5950000",
          "0",
        ]);
      }
      return rows;
    }
    if (resource === "aggTrades") {
      return [
        { a: 1, p: "91250.00", q: "0.25", f: 1, l: 1, T: now - 2000, m: false, M: true },
        { a: 2, p: "91248.50", q: "0.18", f: 2, l: 2, T: now - 1000, m: true, M: true },
      ];
    }
    if (resource === "ticker/price") {
      return url.searchParams.get("symbol")
        ? { symbol: sym, price: "91250.00" }
        : [{ symbol: "BTCUSDT", price: "91250.00" }];
    }
    if (resource === "exchangeInfo") {
      return {
        symbols: [
          {
            symbol: sym,
            baseAsset: sym.replace(/USDT$/, "") || "BTC",
            quoteAsset: "USDT",
            status: "TRADING",
            filters: [{ filterType: "PRICE_FILTER", tickSize: "0.01" }],
          },
        ],
      };
    }
  }

  if (url.pathname === "/api/hyperliquid") {
    const kind = url.searchParams.get("kind");
    if (kind === "assets") {
      return {
        assets: [
          {
            symbol: "HL:BTC",
            coin: "BTC",
            name: "BTC",
            dex: "",
            mark: 91250,
            previousDay: 89500,
            volume: 450_000_000,
            szDecimals: 5,
            pricePrecisionKnown: true,
          },
        ],
        warnings: [],
      };
    }
    if (kind === "candles") return { candles: [] };
    return { range: null };
  }

  if (url.pathname === "/api/yahoo") {
    const kind = url.searchParams.get("kind");
    if (kind === "chart") return { meta: {}, rows: [], adj: [], events: {} };
    if (kind === "spark") return { quotes: [] };
    return { hits: [] };
  }

  if (url.pathname === "/api/alerts") {
    return {
      rules: [],
      events: [],
      cursor: 0,
      runner: { running: false, checkCount: 0, errorCount: 0 },
      serverTime: Date.now(),
    };
  }
  if (url.pathname === "/api/alerts/events") return { events: [] };
  if (url.pathname === "/api/push") return { publicKey: null, configured: false };
  if (url.pathname === "/api/sync") return { revision: 0, updatedAt: 0, device: "", data: null };
  return {};
}

const MOCKED_API_PREFIXES = new Set([
  "/api/osint-map",
  "/api/feeds",
  "/api/terminal-opportunities",
  "/api/terminal-fundamentals",
  "/api/terminal-markets",
  "/api/terminal-capm",
  "/api/stock-heatmap",
  "/api/stock-base",
  "/api/market",
  "/api/hyperliquid",
  "/api/yahoo",
  "/api/alerts",
  "/api/alerts/events",
  "/api/push",
  "/api/sync",
]);

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.listeners = new Map();
    this.ready = new Promise((resolveReady, rejectReady) => {
      this.ws.addEventListener("open", () => resolveReady());
      this.ws.addEventListener("error", (err) => rejectReady(err));
    });
    this.ws.addEventListener("message", (msg) => {
      const payload = JSON.parse(String(msg.data));
      if (payload.id) {
        const p = this.pending.get(payload.id);
        if (p) {
          this.pending.delete(payload.id);
          if (payload.error) p.reject(new Error(JSON.stringify(payload.error)));
          else p.resolve(payload.result);
        }
      } else {
        this.events.push(payload);
        const handlers = this.listeners.get(payload.method);
        if (handlers) {
          for (const handler of handlers) {
            Promise.resolve(handler(payload.params)).catch(() => {});
          }
        }
      }
    });
  }

  onEvent(method, handler) {
    let set = this.listeners.get(method);
    if (!set) {
      set = new Set();
      this.listeners.set(method, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolveCmd, rejectCmd) => {
      this.pending.set(id, { resolve: resolveCmd, reject: rejectCmd });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

async function waitForServer(baseUrl, skipHealth, timeoutMs = 30_000) {
  const healthUrl = skipHealth ? `${baseUrl}/login` : `${baseUrl}/api/health`;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { redirect: "manual" });
      lastStatus = res.status;
      if (res.status >= 500) {
        const text = await res.text().catch(() => "");
        throw new Error(`Server returned HTTP ${res.status} on ${healthUrl}: ${text}`);
      }
      if (res.status === 200) {
        if (!skipHealth) {
          const json = await res.json();
          if (json?.ok !== true) {
            throw new Error(`Unexpected /api/health payload: ${JSON.stringify(json)}`);
          }
        }
        return;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (lastError.startsWith("Server returned HTTP 5") || lastError.startsWith("Unexpected /api/health")) {
        throw err;
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${healthUrl} (lastStatus=${lastStatus}, lastError=${lastError})`);
}

async function waitForPagePredicate(cdp, predicateExpr, description, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await cdp.send("Runtime.evaluate", {
        expression: `(() => Boolean(${predicateExpr}))()`,
        returnByValue: true,
      });
      if (res?.result?.value === true) return;
    } catch {
      /* Page context may be mid-navigation; retry until predicate resolves or times out. */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for page condition: ${description}`);
}

async function settleUi(cdp, ms = 300) {
  await new Promise((r) => setTimeout(r, ms));
  await cdp.send("Runtime.evaluate", {
    expression: "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
    awaitPromise: true,
  });
}

async function verifyTouchResize(cdp, selector, label, consoleErrors) {
  const errorsBeforeSnap = consoleErrors.length;
  for (const stop of ["Peek", "Half height", "Full height"]) {
    const response = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const handle = document.querySelector(${JSON.stringify(selector)});
        const rect = handle?.getBoundingClientRect();
        if (!rect || rect.width < 36 || rect.height < 36) return null;
        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          height: Number(handle.getAttribute("aria-valuenow")),
          min: Number(handle.getAttribute("aria-valuemin")),
          max: Number(handle.getAttribute("aria-valuemax")),
        };
      })()`,
      returnByValue: true,
    });
    const geometry = response.result?.value;
    if (!geometry || geometry.max - geometry.min < 100) throw new Error(`${label} resize handle is missing or there is insufficient drag range`);
    const { x, y, height, min, max } = geometry;
    const target = stop === "Peek" ? min + 12 : stop === "Full height" ? max - 12 : Math.round((min + max) / 2) + 12;
    const touch = (position) => ({ x, y: position, id: 1 });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch(y)] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [touch(y + height - target)] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await waitForPagePredicate(
      cdp,
      `document.querySelector(${JSON.stringify(selector)})?.getAttribute("aria-valuetext") === ${JSON.stringify(stop)}`,
      `${stop} after dragging ${label}`,
    );
  }
  if (consoleErrors.length !== errorsBeforeSnap) {
    throw new Error(`${label} resize reported browser errors:\n${consoleErrors.slice(errorsBeforeSnap).join("\n")}`);
  }
}

async function tapWorkspaceTarget(cdp, selector, minSize = 44) {
  const response = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      const rect = button?.getBoundingClientRect();
      if (!rect || rect.width < ${minSize} || rect.height < ${minSize}) return null;
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`,
    returnByValue: true,
  });
  const point = response.result?.value;
  if (!point) throw new Error(`Workspace touch target unavailable: ${selector}`);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function chooseTouchChartLayout(cdp, label) {
  const menu = '.toolbar-mobile-overflow [aria-label="More chart controls"]';
  const layout = '.mobile-chart-controls [aria-label="Layout setup"]';
  await tapWorkspaceTarget(cdp, menu, 36);
  await waitForPagePredicate(cdp, `!!document.querySelector(${JSON.stringify(layout)})`, "touch chart layout menu");
  await tapWorkspaceTarget(cdp, layout, 36);
  const choice = `.layout-popover button[aria-label="${label}"]`;
  await waitForPagePredicate(cdp, `!!document.querySelector(${JSON.stringify(choice)})`, `${label} layout choice`);
  await tapWorkspaceTarget(cdp, choice, 36);
  const close = await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector(${JSON.stringify(menu)})?.getAttribute("aria-expanded") === "true"`,
    returnByValue: true,
  });
  if (close.result?.value) await tapWorkspaceTarget(cdp, menu, 36);
}

async function verifyFocusedChartLayout(cdp, minWidth) {
  await chooseTouchChartLayout(cdp, "Eight charts");
  await waitForPagePredicate(cdp, `document.querySelector('.compact-chart-switcher select')?.options.length === 8
    && document.querySelectorAll('.chart-grid-cell').length === 1
    && document.querySelector('.chart-grid-cell').clientWidth >= ${minWidth}`, "eight-chart layout defaults to one large chart");
  await cdp.send("Runtime.evaluate", { expression: `(() => {
    const picker = document.querySelector('.compact-chart-switcher select');
    picker.selectedIndex = 1;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
  })()` });
  await waitForPagePredicate(cdp, `document.querySelector('.chart-grid-cell.active-cell')?.dataset.cellId === 'cell-2'`, "compact chart selector activates the chosen chart");
  await tapWorkspaceTarget(cdp, ".compact-chart-switcher button");
  await waitForPagePredicate(cdp, `document.querySelectorAll('.chart-grid-cell').length === 8`, "full chart grid opens on demand");
  await tapWorkspaceTarget(cdp, ".compact-chart-switcher button");
  await waitForPagePredicate(cdp, `document.querySelectorAll('.chart-grid-cell').length === 1`, "compact layout returns to one chart");
  await chooseTouchChartLayout(cdp, "One chart");
  await waitForPagePredicate(cdp, `!document.querySelector('.compact-chart-switcher')`, "single-chart layout closes the selector");
}

async function inspectViewportDom(cdp, mobile) {
  const res = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const isHiddenByHierarchy = (el) => {
        if (!el || !el.isConnected) return true;
        if (el.closest('[hidden], .sr-only, [aria-hidden="true"]')) return true;
        let cur = el;
        while (cur && cur.nodeType === 1) {
          const cs = getComputedStyle(cur);
          if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) {
            return true;
          }
          if (cur !== document.documentElement && cur !== document.body && cs.overflow !== "visible") {
            const pr = cur.getBoundingClientRect();
            if (pr.width <= 0 || pr.height <= 0) return true;
          }
          cur = cur.parentElement;
        }
        return false;
      };

      const describe = (el) => {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? "#" + el.id : "";
        const cls = typeof el.className === "string" && el.className.trim()
          ? "." + el.className.trim().split(/\\s+/).slice(0, 3).join(".")
          : "";
        const label = (
          el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          el.textContent ||
          el.getAttribute("placeholder") ||
          el.getAttribute("name") ||
          ""
        ).replace(/\\s+/g, " ").trim().slice(0, 60);
        return { selector: tag + id + cls, tag, label };
      };

      const innerWidth = window.innerWidth;
      const docScrollWidth = document.documentElement.scrollWidth;
      const bodyScrollWidth = document.body ? document.body.scrollWidth : 0;
      const horizontalOverflow = Math.max(docScrollWidth, bodyScrollWidth) > innerWidth;

      const smallTargets = [];
      let checkedControls = 0;
      const nodes = document.querySelectorAll(
        'button, [role="button"], [role="tab"], .bottom-panel-resizer, .sidebar-sheet-resizer, select, textarea, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), a.button'
      );
      for (const el of nodes) {
        if (isHiddenByHierarchy(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        checkedControls++;
        if (${mobile ? "true" : "false"}) {
          if (rect.width < 35.9 || rect.height < 35.9) {
            smallTargets.push({
              ...describe(el),
              width: Math.round(rect.width * 10) / 10,
              height: Math.round(rect.height * 10) / 10,
            });
          }
        }
      }
      return {
        innerWidth,
        docScrollWidth,
        bodyScrollWidth,
        horizontalOverflow,
        checkedControls,
        smallTargets,
      };
    })()`,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error(`DOM audit evaluation threw: ${JSON.stringify(res.exceptionDetails)}`);
  }
  return res.result.value;
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const chromePath = resolveChromePath();
  if (!existsSync(chromePath)) {
    throw new Error(`Chrome/Chromium binary not found at ${chromePath}. Set CHROME_PATH.`);
  }

  let serverProc = null;
  let tempDataDir = null;
  const tempChromeDirs = [];
  let baseUrl = opts.baseUrl.replace(/\/+$/, "");
  let loginPassword = opts.password || process.env.AFFENTRADER_SITE_PASSWORD || "";

  if (!baseUrl) {
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    tempDataDir = await mkdtemp(join(tmpdir(), "affen-viewport-data-"));

    if (!loginPassword) {
      loginPassword = randomBytes(16).toString("hex");
    }
    const salt = randomBytes(16).toString("hex");
    const passwordHash = `${salt}:${scryptSync(loginPassword, salt, 64).toString("hex")}`;
    const sessionSecret = randomBytes(32).toString("hex");

    const env = {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      AFFENTRADER_DATA: tempDataDir,
      AFFENTRADER_SITE_PASSWORD_HASH: passwordHash,
      AFFENTRADER_SITE_SESSION_SECRET: sessionSecret,
      CONTAINER_APP_REVISION: "affenterminal--r20261120100101-aaaaaaaa",
    };

    if (opts.standaloneDir) {
      const absStandalone = resolve(opts.standaloneDir);
      const serverEntry = join(absStandalone, "server.js");
      if (!existsSync(serverEntry)) {
        throw new Error(`Missing standalone server.js at ${serverEntry}`);
      }
      serverProc = spawn(process.execPath, [serverEntry], {
        cwd: absStandalone,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      const buildIdPath = join(projectRoot, ".next", "BUILD_ID");
      if (!existsSync(buildIdPath)) {
        throw new Error(`Missing .next/BUILD_ID at ${buildIdPath}. Run pnpm run build first.`);
      }
      const nextBin = join(projectRoot, "node_modules", "next", "dist", "bin", "next");
      serverProc = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
        cwd: projectRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }

    let serverLogs = "";
    serverProc.stdout?.on("data", (d) => {
      serverLogs += d.toString("utf8");
    });
    serverProc.stderr?.on("data", (d) => {
      serverLogs += d.toString("utf8");
    });
    serverProc.once("exit", (code) => {
      if (code !== null && code !== 0) {
        serverLogs += `\n[server exited with code ${code}]`;
      }
    });

    try {
      await waitForServer(baseUrl, opts.skipHealth, 30_000);
    } catch (err) {
      throw new Error(`${err instanceof Error ? err.message : String(err)}\nServer logs:\n${serverLogs}`);
    }
  } else {
    await waitForServer(baseUrl, opts.skipHealth, 30_000);
  }

  // Verify /login HTML contains viewport-fit=cover
  const loginRes = await fetch(`${baseUrl}/login`, { redirect: "manual" });
  if (loginRes.status !== 200) {
    throw new Error(`Expected GET /login to return 200, received ${loginRes.status}`);
  }
  const loginHtml = await loginRes.text();
  if (!loginHtml.includes("viewport-fit=cover")) {
    throw new Error("GET /login HTML missing viewport-fit=cover meta tag");
  }

  let chrome;
  let cdp;
  const launchChrome = async (extraArgs = []) => {
    const userDataDir = await mkdtemp(join(tmpdir(), "affen-viewport-chrome-"));
    tempChromeDirs.push(userDataDir);
    const proc = spawn(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1440,900",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        ...extraArgs,
        "about:blank",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const browserWsUrl = await new Promise((resolveWs, rejectWs) => {
      let stderr = "";
      const timer = setTimeout(() => {
        if (proc.exitCode === null) proc.kill("SIGKILL");
        rejectWs(new Error(`Chrome DevTools startup timeout. stderr=${stderr}`));
      }, 15_000);
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
        const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (m) {
          clearTimeout(timer);
          resolveWs(m[1]);
        }
      });
      proc.once("exit", (code) => {
        clearTimeout(timer);
        rejectWs(new Error(`Chrome exited early (${code}). stderr=${stderr}`));
      });
    });
    return { proc, browserWsUrl };
  };

  try {
    let browserWsUrl;
    try {
      ({ proc: chrome, browserWsUrl } = await launchChrome());
    } catch (firstErr) {
      if (process.platform !== "linux") throw firstErr;
      ({ proc: chrome, browserWsUrl } = await launchChrome([
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ]));
    }

    const pageTarget = await waitForChromePageTarget(browserWsUrl);

    cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Log.enable");
    await cdp.send("Network.enable");

    const consoleErrors = [];
    const http5xx = [];
    let activeLabel = "bootstrap";

    cdp.onEvent("Runtime.exceptionThrown", (params) => {
      const d = params?.exceptionDetails;
      consoleErrors.push(
        `[${activeLabel}] Runtime.exceptionThrown: ${d?.exception?.description ?? d?.text ?? JSON.stringify(d)}`,
      );
    });
    cdp.onEvent("Runtime.consoleAPICalled", (params) => {
      if (params?.type === "error") {
        const msg = JSON.stringify(params?.args?.map((a) => a.value ?? a.description));
        consoleErrors.push(`[${activeLabel}] console.error: ${msg}`);
      }
    });
    cdp.onEvent("Log.entryAdded", (params) => {
      if (params?.entry?.level === "error") {
        consoleErrors.push(`[${activeLabel}] Log.error: ${params.entry.text} (${params.entry.url ?? "no-url"})`);
      }
    });
    cdp.onEvent("Network.responseReceived", (params) => {
      const status = params?.response?.status ?? 0;
      const url = params?.response?.url ?? "";
      if (status >= 500) {
        http5xx.push(`[${activeLabel}] HTTP ${status} on ${url}`);
      }
    });

    let advertisedRevision = null;
    if (!opts.liveApis) {
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(() => {
          window.__sidebarMounted = false;
          const sidebarObserver = new MutationObserver(records => {
            for (const { addedNodes } of records) {
              for (const node of addedNodes) {
                if (node instanceof Element && (node.matches(".right-sidebar") || node.querySelector(".right-sidebar"))) {
                  window.__sidebarMounted = true;
                  sidebarObserver.disconnect();
                  return;
                }
              }
            }
          });
          sidebarObserver.observe(document, { childList: true, subtree: true });
          const NativeWorker = window.Worker;
          window.__pineLifecycle = { started: 0, terminated: 0 };
          window.Worker = class extends NativeWorker {
            constructor(url, options) {
              super(url, options);
              this.pineCandidate = String(url).startsWith("blob:");
              if (options?.name === "Chart technicals") {
                this.addEventListener("message", (event) => {
                  if (event.data?.view?.status === "ready") window.__chartRatingReceived = true;
                });
              }
            }
            postMessage(message, ...args) {
              if (this.pineCandidate && !this.pineTracked && message?.kind === "prepare") {
                this.pineTracked = true;
                window.__pineLifecycle.started++;
              }
              return super.postMessage(message, ...args);
            }
            terminate() {
              if (this.pineTracked && !this.pineStopped) {
                this.pineStopped = true;
                window.__pineLifecycle.terminated++;
              }
              return super.terminate();
            }
          };
          const NativeWebSocket = window.WebSocket;
          class InertWebSocket extends EventTarget {
            static CONNECTING = 0;
            static OPEN = 1;
            static CLOSING = 2;
            static CLOSED = 3;
            CONNECTING = 0;
            OPEN = 1;
            CLOSING = 2;
            CLOSED = 3;
            readyState = 1;
            bufferedAmount = 0;
            extensions = "";
            protocol = "";
            binaryType = "blob";
            onopen = null;
            onmessage = null;
            onerror = null;
            onclose = null;
            constructor(url) {
              super();
              this.url = String(url);
            }
            send() {}
            close() {
              this.readyState = 3;
            }
          }
          window.WebSocket = function(url, protocols) {
            const s = String(url || "");
            const isLocal = /^wss?:\\/\\/(127\\.0\\.0\\.1|localhost)(:|\\/|$)/i.test(s);
            if (!isLocal && /^wss?:/i.test(s)) {
              return new InertWebSocket(s);
            }
            return protocols !== undefined ? new NativeWebSocket(url, protocols) : new NativeWebSocket(url);
          };
          window.WebSocket.CONNECTING = 0;
          window.WebSocket.OPEN = 1;
          window.WebSocket.CLOSING = 2;
          window.WebSocket.CLOSED = 3;
          window.WebSocket.prototype = NativeWebSocket.prototype;
        })();`,
      });

      await cdp.send("Fetch.enable", {
        patterns: [{ urlPattern: "*", requestStage: "Request" }],
      });

      cdp.onEvent("Fetch.requestPaused", async (params) => {
        const requestId = params.requestId;
        const reqUrl = params.request?.url ?? "";
        if (!/^https?:\/\//i.test(reqUrl)) {
          await cdp.send("Fetch.continueRequest", { requestId }).catch(() => {});
          return;
        }
        if (reqUrl.startsWith(baseUrl)) {
          let pathname = "/";
          try {
            pathname = new URL(reqUrl).pathname;
          } catch {
            /* ignore */
          }
          const healthOverride = pathname === "/api/health" && advertisedRevision;
          if (healthOverride || MOCKED_API_PREFIXES.has(pathname)) {
            const body = JSON.stringify(healthOverride
              ? { ok: true, revision: healthOverride }
              : buildMockApiPayload(reqUrl));
            await cdp.send("Fetch.fulfillRequest", {
              requestId,
              responseCode: 200,
              responseHeaders: [
                { name: "content-type", value: "application/json; charset=utf-8" },
                { name: "cache-control", value: "no-store" },
              ],
              body: Buffer.from(body, "utf8").toString("base64"),
            }).catch(() => {});
            return;
          }
          await cdp.send("Fetch.continueRequest", { requestId }).catch(() => {});
          return;
        }

        // External third-party API calls (e.g. direct Binance/Kraken exchangeInfo)
        let extBody = "{}";
        if (reqUrl.includes("binance") && reqUrl.includes("exchangeInfo")) {
          extBody = JSON.stringify({
            symbols: [
              {
                symbol: "BTCUSDT",
                filters: [{ filterType: "PRICE_FILTER", tickSize: "0.01" }],
              },
            ],
          });
        }
        await cdp.send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "content-type", value: "application/json; charset=utf-8" },
            { name: "access-control-allow-origin", value: "*" },
          ],
          body: Buffer.from(extBody, "utf8").toString("base64"),
        }).catch(() => {});
      });
    }

    const failures = [];
    const results = [];
    let compactDockSnapChecked = false;
    let sidebarSheetsChecked = 0;
    let phoneDrawingOverlayChecked = false;
    let phoneChartFocusChecked = false;
    const tabletChartFocusViewports = [];

    const recordAudit = (viewport, scenario, audit) => {
      results.push({
        viewport: viewport.name,
        scenario,
        innerWidth: audit.innerWidth,
        docScrollWidth: audit.docScrollWidth,
        bodyScrollWidth: audit.bodyScrollWidth,
        checkedControls: audit.checkedControls,
        smallTargetsCount: audit.smallTargets.length,
      });
      if (audit.horizontalOverflow) {
        failures.push(
          `[${viewport.name} · ${scenario}] Horizontal overflow: docScrollWidth=${audit.docScrollWidth}, bodyScrollWidth=${audit.bodyScrollWidth}, innerWidth=${audit.innerWidth}`,
        );
      }
      if (viewport.mobile && audit.smallTargets.length > 0) {
        for (const t of audit.smallTargets) {
          failures.push(
            `[${viewport.name} · ${scenario}] Touch target < 36px: ${t.selector} (${t.tag}) label="${t.label}" size=${t.width}x${t.height}`,
          );
        }
      }
    };

    const setViewport = async (vp) => {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: vp.deviceScaleFactor ?? (vp.mobile ? 2 : 1),
        mobile: vp.mobile,
      });
      await cdp.send(
        "Emulation.setTouchEmulationEnabled",
        vp.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
      );
    };

    // Step 1: Audit /login across all 4 viewports before authenticating
    for (const vp of VIEWPORTS) {
      activeLabel = `${vp.name}:/login`;
      await setViewport(vp);
      await cdp.send("Page.navigate", { url: `${baseUrl}/login` });
      await waitForPagePredicate(
        cdp,
        'document.readyState === "complete" && !!document.querySelector(\'form[action="/login"] input[name="password"]\')',
        `${vp.name} /login form`,
      );
      await settleUi(cdp, 150);
      const audit = await inspectViewportDom(cdp, vp.mobile);
      recordAudit(vp, "/login", audit);
    }

    // Step 2: Authenticate via the real /login form
    activeLabel = "auth-login";
    if (loginPassword) {
      const submitRes = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const input = document.querySelector('form[action="/login"] input[name="password"]');
          const form = document.querySelector('form[action="/login"]');
          if (!input || !form) return false;
          input.value = ${JSON.stringify(loginPassword)};
          form.submit();
          return true;
        })()`,
        returnByValue: true,
      });
      if (submitRes?.result?.value !== true) {
        throw new Error("Failed to locate /login password form for authentication.");
      }
      await waitForPagePredicate(
        cdp,
        'window.location.pathname === "/" && document.readyState === "complete"',
        "post-login redirect to /",
      );
    }

    // Step 3: Sweep all 4 viewports across /, BottomPanel tabs, and /terminal 8 modules
    for (const vp of VIEWPORTS) {
      await setViewport(vp);

      // 3a: / (collapsed bottom panel)
      activeLabel = `${vp.name}:/`;
      await cdp.send("Page.navigate", { url: `${baseUrl}/` });
      await waitForPagePredicate(
        cdp,
        'document.readyState === "complete" && !!document.querySelector(".trading-app") && !document.querySelector(".boot-screen")',
        `${vp.name} / .trading-app`,
      );
      if (!opts.liveApis && !vp.mobile) {
        await waitForPagePredicate(
          cdp,
          'window.__chartRatingReceived === true && !!document.querySelector(".technicals .gauges")',
          `${vp.name} / technicals worker response and rendered gauges`,
        );
      }
      await settleUi(cdp, 350);
      if (vp.mobile && !opts.liveApis) {
        await waitForPagePredicate(cdp, "window.__sidebarMounted === false", `${vp.name} chart startup skips the sidebar`);
      }
      recordAudit(vp, "/", await inspectViewportDom(cdp, vp.mobile));
      if (vp.width === 390 && !opts.liveApis) {
        activeLabel = "phone drawings overlay";
        const widthBefore = (await cdp.send("Runtime.evaluate", {
          expression: 'document.querySelector(".chart-grid").clientWidth',
          returnByValue: true,
        })).result.value;
        if (widthBefore < vp.width - 8) throw new Error("Phone chart did not use the available width");
        await tapWorkspaceTarget(cdp, ".phone-drawing-toggle", 36);
        await waitForPagePredicate(cdp, `(() => {
          const rail = document.querySelector("#workspace-drawing-tools");
          return !!rail?.querySelector(".vela-dtb-btn") && getComputedStyle(rail).position === "absolute"
            && document.querySelector(".chart-grid").clientWidth === ${widthBefore};
        })()`, "phone drawing tools open without squeezing the chart");
        recordAudit(vp, "/ drawing tools overlay", await inspectViewportDom(cdp, true));
        await tapWorkspaceTarget(cdp, ".phone-drawing-toggle", 36);
        await waitForPagePredicate(cdp, '!document.querySelector("#workspace-drawing-tools")', "phone drawing tools close");
        phoneDrawingOverlayChecked = true;
        activeLabel = "phone chart focus";
        await verifyFocusedChartLayout(cdp, 380);
        phoneChartFocusChecked = true;
        for (const [button, label] of [
          ["Watchlists", "Watchlist sidebar"], ["Alerts", "Alerts sidebar"], ["Object tree", "Object tree sidebar"],
        ]) {
          activeLabel = `touch resize of ${label}`;
          await cdp.send("Runtime.evaluate", {
            expression: `document.querySelector(${JSON.stringify(`.utility-rail button[aria-label="${button}"]`)}).click()`,
          });
          await waitForPagePredicate(
            cdp,
            `document.querySelector(".right-sidebar")?.getAttribute("aria-label") === ${JSON.stringify(label)}
              && document.querySelector(".sidebar-sheet-resizer")?.hasAttribute("aria-valuenow")`,
            `${label} mobile resize controls`,
          );
          await verifyTouchResize(cdp, ".sidebar-sheet-resizer", label, consoleErrors);
          sidebarSheetsChecked++;
        }
        await cdp.send("Runtime.evaluate", {
          expression: `document.querySelector('.utility-rail button[aria-label="Object tree"]').click()`,
        });
        await waitForPagePredicate(cdp, '!document.querySelector(".right-sidebar")', "mobile sidebar closes");
      }

      // 3b: / + open BottomPanel (Order flow)
      activeLabel = `${vp.name}:/+orderflow`;
      const openedOrderflow = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const btn = document.querySelector('.workspace-panel-strip button[data-panel="orderflow"]');
          if (!btn) return false;
          if (!btn.classList.contains("active")) btn.click();
          return true;
        })()`,
        returnByValue: true,
      });
      if (openedOrderflow?.result?.value !== true) {
        throw new Error(`[${vp.name}] Could not locate BottomPanel Order flow tab`);
      }
      await waitForPagePredicate(
        cdp,
        '!!document.querySelector(".bottom-panel.expanded.orderflow-panel .detailed-orderflow")',
        `${vp.name} BottomPanel Order flow loaded`,
      );
      await settleUi(cdp, 300);
      recordAudit(vp, "/ + BottomPanel(orderflow)", await inspectViewportDom(cdp, vp.mobile));

      // 3c: / + open BottomPanel (AffenTerminal embedded)
      activeLabel = `${vp.name}:/+terminal`;
      const openedTerminal = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const btn = document.querySelector('.workspace-panel-strip button[data-panel="terminal"]');
          if (!btn) return false;
          if (!btn.classList.contains("active")) btn.click();
          return true;
        })()`,
        returnByValue: true,
      });
      if (openedTerminal?.result?.value !== true) {
        throw new Error(`[${vp.name}] Could not locate BottomPanel Terminal tab`);
      }
      await waitForPagePredicate(
        cdp,
        '!!document.querySelector(".bottom-panel.expanded .research-terminal.is-embedded")',
        `${vp.name} BottomPanel Terminal expanded`,
      );
      await settleUi(cdp, 350);
      recordAudit(vp, "/ + BottomPanel(terminal)", await inspectViewportDom(cdp, vp.mobile));
      if (vp.width === 390 && !opts.liveApis) {
        activeLabel = "touch resize of embedded terminal";
        await verifyTouchResize(cdp, ".bottom-panel-resizer", "mobile bottom panel", consoleErrors);
        compactDockSnapChecked = true;
      }

      // 3d: /terminal across all 8 modules
      activeLabel = `${vp.name}:/terminal`;
      await cdp.send("Page.navigate", { url: `${baseUrl}/terminal?view=opps` });
      await waitForPagePredicate(
        cdp,
        'document.readyState === "complete" && !!document.querySelector(".research-terminal .panel-tabs > button")',
        `${vp.name} /terminal shell`,
      );
      await settleUi(cdp, 350);

      for (const mod of TERMINAL_VIEW_TABS) {
        activeLabel = `${vp.name}:/terminal(${mod.key})`;
        const clicked = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const buttons = [...document.querySelectorAll(".research-terminal .panel-tabs > button")];
            const target = buttons.find((b) => b.textContent?.trim() === ${JSON.stringify(mod.label)});
            if (!target) return false;
            target.click();
            return true;
          })()`,
          returnByValue: true,
        });
        if (clicked?.result?.value !== true) {
          throw new Error(`[${vp.name}] Could not locate /terminal tab "${mod.label}" (${mod.key})`);
        }
        await waitForPagePredicate(
          cdp,
          `(() => {
            const buttons = [...document.querySelectorAll(".research-terminal .panel-tabs > button")];
            const target = buttons.find((b) => b.textContent?.trim() === ${JSON.stringify(mod.label)});
            return Boolean(target && target.classList.contains("active"));
          })()`,
          `${vp.name} /terminal tab ${mod.key} active`,
        );
        if (mod.content) {
          await waitForPagePredicate(
            cdp,
            `!!document.querySelector(${JSON.stringify(mod.content)})`,
            `${vp.name} /terminal module ${mod.key} loaded`,
          );
        }
        await settleUi(cdp, 350);
        recordAudit(vp, `/terminal(${mod.key})`, await inspectViewportDom(cdp, vp.mobile));
      }
    }

    for (const vp of COMPACT_NAV_VIEWPORTS) {
      activeLabel = `${vp.name} compact workspace navigation`;
      await setViewport(vp);
      await cdp.send("Page.navigate", { url: `${baseUrl}/` });
      await waitForPagePredicate(cdp, `(() => {
        const nav = document.querySelector("nav.utility-rail");
        if (!nav || getComputedStyle(nav).position !== "fixed") return false;
        const rect = nav.getBoundingClientRect();
        const usable = [...nav.querySelectorAll("button")].filter(button => button.getClientRects().length > 0);
        return Math.abs(rect.bottom - innerHeight) <= 1 && usable.length === 6
          && usable.every(button => button.offsetWidth >= 44 && button.offsetHeight >= 44);
      })()`, `${vp.name} workspace bottom navigation`);
      await waitForPagePredicate(cdp, `(() => {
        const canvases = [...document.querySelectorAll(".vela-container canvas")]
          .filter(canvas => canvas.width > 0 && canvas.clientWidth > 0);
        return devicePixelRatio === 3 && canvases.length > 0 && canvases.every(canvas =>
          Math.abs(canvas.width - canvas.clientWidth * 2) <= 2);
      })()`, `${vp.name} Vela canvas drawing density is capped on DPR-3 touch screens`);
      await tapWorkspaceTarget(cdp, 'nav.utility-rail [aria-label="Chart"]');
      await waitForPagePredicate(cdp, 'document.querySelector(\'nav.utility-rail [aria-label="Chart"]\')?.getAttribute("aria-pressed") === "true"', "Chart is active");
      await settleUi(cdp, 200);
      if (!opts.liveApis) {
        await waitForPagePredicate(cdp, "window.__sidebarMounted === false", `${vp.name} chart startup skips the sidebar`);
      }
      recordAudit(vp, "/ compact navigation", await inspectViewportDom(cdp, true));
      await tapWorkspaceTarget(cdp, 'nav.utility-rail [aria-label="Watchlists"]');
      await waitForPagePredicate(cdp, '!!document.querySelector(\'.right-sidebar[aria-label="Watchlist sidebar"] .sidebar-sheet-resizer[aria-valuenow]\')', "Watchlist opens from bottom navigation");
      await tapWorkspaceTarget(cdp, 'nav.utility-rail [aria-label="Chart"]');
      await waitForPagePredicate(cdp, '!document.querySelector(".right-sidebar")', "Chart closes the sheet");
      if (vp.verifySavedLayout && !opts.liveApis) {
        activeLabel = `${vp.name} tablet chart focus`;
        await verifyFocusedChartLayout(cdp, vp.width - 70);
        tabletChartFocusViewports.push(vp.name);
      }

      activeLabel = `${vp.name} compact terminal startup`;
      await cdp.send("Page.navigate", { url: `${baseUrl}/terminal?view=help` });
      await waitForPagePredicate(
        cdp,
        'document.readyState === "complete" && !!document.querySelector(\'.research-terminal.is-single-pane[data-layout-ready="true"]\')',
        `${vp.name} terminal opens in a single pane`,
      );
      await settleUi(cdp, 350);
      const startupRequests = await cdp.send("Runtime.evaluate", {
        expression: `performance.getEntriesByType("resource")
          .map(entry => new URL(entry.name).pathname)
          .filter(path => ["/api/terminal-opportunities", "/api/terminal-fundamentals", "/api/terminal-markets"].includes(path))`,
        returnByValue: true,
      });
      if (startupRequests.result?.value?.length !== 0) {
        throw new Error(`[${vp.name}] Terminal Help preloaded unrelated panels: ${startupRequests.result?.value?.join(", ")}`);
      }
      recordAudit(vp, "/terminal compact startup", await inspectViewportDom(cdp, true));
    }

    let pwaShortcutsChecked = 0;
    let pwaScreenshotsChecked = 0;
    if (serverProc && !opts.liveApis) {
      await setViewport(VIEWPORTS[0]);
      const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
      if (!manifestResponse.ok) throw new Error("Unable to read the installed app manifest");
      const manifest = await manifestResponse.json();
      for (const form of ["narrow", "wide"]) {
        activeLabel = `PWA screenshot ${form}`;
        const screenshot = manifest.screenshots?.find(item => item.form_factor === form);
        if (typeof screenshot?.src !== "string") throw new Error(`Missing PWA screenshot for ${form}`);
        const url = new URL(screenshot.src, baseUrl);
        if (url.origin !== baseUrl || screenshot.type !== "image/png") throw new Error(`Invalid PWA screenshot for ${form}`);
        const response = await fetch(url, { redirect: "manual" });
        if (!response.ok || response.headers.get("content-type") !== "image/png") {
          await response.body?.cancel();
          throw new Error(`PWA screenshot for ${form} is unavailable without authentication`);
        }
        const png = Buffer.from(await response.arrayBuffer());
        if (png.length < 24 || png.subarray(1, 4).toString() !== "PNG" ||
          `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}` !== screenshot.sizes) {
          throw new Error(`PWA screenshot for ${form} differs from its manifest size`);
        }
        pwaScreenshotsChecked++;
      }
      for (const [name, selector] of [
        ["Watchlist", 'aside[aria-label="Watchlist sidebar"]'],
        ["Alerts", 'aside[aria-label="Alerts sidebar"]'],
        ["Terminal", ".research-terminal"],
      ]) {
        activeLabel = `PWA shortcut ${name}`;
        const shortcut = manifest.shortcuts?.find(item => item.name === name);
        if (typeof shortcut?.url !== "string") throw new Error(`Missing PWA shortcut for ${name}`);
        const url = new URL(shortcut.url, baseUrl);
        if (url.origin !== baseUrl) throw new Error(`PWA shortcut for ${name} must remain on this site`);
        const unauthenticated = await fetch(url, { redirect: "manual" });
        const redirect = new URL(unauthenticated.headers.get("location") ?? "/", baseUrl);
        if (unauthenticated.status !== 303 || redirect.pathname !== "/login"
          || redirect.searchParams.get("next") !== url.pathname + url.search) {
          throw new Error(`The login gate did not retain the ${name} shortcut destination`);
        }
        await unauthenticated.body?.cancel();
        await cdp.send("Page.navigate", { url: url.href });
        await waitForPagePredicate(
          cdp,
          `location.pathname + location.search === ${JSON.stringify(url.pathname + url.search)}
            && !!document.querySelector(${JSON.stringify(selector)})
            && document.documentElement.scrollWidth <= innerWidth`,
          `mobile PWA shortcut ${name}`,
        );
        pwaShortcutsChecked++;
      }
    }

    if (http5xx.length > 0) {
      failures.push(`HTTP 5xx responses detected (${http5xx.length}):\n${http5xx.join("\n")}`);
    }
    if (consoleErrors.length > 0) {
      failures.push(`Browser console/page errors detected (${consoleErrors.length}):\n${consoleErrors.join("\n")}`);
    }

    if (failures.length > 0) {
      console.error(`MOBILE VIEWPORT AUDIT FAILED (${failures.length} issue(s)):\n${failures.join("\n")}`);
      process.exitCode = 1;
      return;
    }

    // The audit owns this server and browser profile. Prove the installed service
    // worker still requires login online and can show a data-free page offline.
    let offlineNavigationChecked = false;
    let deploymentUpdateChecked = false;
    let pineWorkerLifecycleChecked = false;
    if (serverProc && !opts.liveApis) {
      await setViewport(VIEWPORTS[0]);
      activeLabel = "deployment update";
      advertisedRevision = "affenterminal--r20261120100102-bbbbbbbb";
      await waitForPagePredicate(
        cdp,
        `(() => {
          const banner = document.querySelector(".deployment-update");
          if (!banner) {
            window.dispatchEvent(new Event("focus"));
            return false;
          }
          const buttons = [...(banner?.querySelectorAll("button") ?? [])];
          return buttons.length === 2 && buttons.every(button => {
            const rect = button.getBoundingClientRect();
            return rect.height >= 44 && rect.width >= 44 && rect.left >= 0 && rect.right <= innerWidth;
          });
        })()`,
        "new deployment message and mobile touch targets",
      );
      advertisedRevision = null;
      const reload = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const button = document.querySelector(".deployment-update .primary");
          if (!button) return null;
          setTimeout(() => button.click(), 0);
          return performance.timeOrigin;
        })()`,
        returnByValue: true,
      });
      const previousTimeOrigin = reload.result?.value;
      if (typeof previousTimeOrigin !== "number") throw new Error("Unable to click deployment reload");
      await waitForPagePredicate(
        cdp,
        `performance.timeOrigin !== ${previousTimeOrigin}
          && !!document.querySelector(".research-terminal")
          && !document.querySelector(".deployment-update")`,
        "manual reload clears the deployment hint",
      );
      deploymentUpdateChecked = true;

      activeLabel = "Pine worker lifecycle";
      const errorsBeforePine = consoleErrors.length;
      await setViewport(VIEWPORTS[3]);
      await cdp.send("Page.navigate", { url: `${baseUrl}/` });
      await waitForPagePredicate(
        cdp,
        '!!document.querySelector(\'.workspace-panel-strip [data-panel="pine"]\') && !document.querySelector(".boot-screen")',
        "workspace ready to open the Pine editor",
      );
      await cdp.send("Runtime.evaluate", {
        expression: `document.querySelector('.workspace-panel-strip [data-panel="pine"]').click()`,
      });
      await waitForPagePredicate(
        cdp,
        '[...document.querySelectorAll("button")].some(button => button.textContent.trim() === "Add to chart" && !button.disabled)',
        "Pine editor can add a study",
      );
      await cdp.send("Runtime.evaluate", {
        expression: `[...document.querySelectorAll("button")].find(button => button.textContent.trim() === "Add to chart").click()`,
      });
      await waitForPagePredicate(
        cdp,
        "window.__pineLifecycle.started === 1",
        "a Pine worker starts for the installed study",
      );
      for (const [index, mode] of ["simulation", "auto"].entries()) {
        await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            if (!document.querySelector('select[aria-label="Market data mode"]')) {
              document.querySelector('button[aria-label="Main menu"]').click();
            }
          })()`,
        });
        await waitForPagePredicate(
          cdp,
          `!!document.querySelector('select[aria-label="Market data mode"]')`,
          "market data mode picker",
        );
        await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const select = document.querySelector('select[aria-label="Market data mode"]');
            select.value = ${JSON.stringify(mode)};
            select.dispatchEvent(new Event('change', { bubbles: true }));
          })()`,
        });
        await waitForPagePredicate(
          cdp,
          `window.__pineLifecycle.started === ${index + 2}
            && window.__pineLifecycle.terminated === ${index + 1}`,
          `previous Pine worker closes when switching to ${mode}`,
        );
      }
      if (consoleErrors.length !== errorsBeforePine) {
        throw new Error(`Pine worker cycle reported browser errors:\n${consoleErrors.slice(errorsBeforePine).join("\n")}`);
      }
      pineWorkerLifecycleChecked = true;

      activeLabel = "offline navigation";
      await setViewport(VIEWPORTS[0]);
      await waitForPagePredicate(cdp, "!!navigator.serviceWorker.controller", "active service worker");
      await cdp.send("Network.clearBrowserCookies");
      await cdp.send("Page.navigate", { url: `${baseUrl}/terminal?view=opps` });
      await waitForPagePredicate(
        cdp,
        `location.pathname === "/login" && !!document.querySelector('form[action="/login"]')`,
        "online navigation still requires login",
      );
      const stopped = once(serverProc, "exit", { signal: AbortSignal.timeout(8_000) });
      serverProc.kill("SIGTERM");
      await stopped;
      serverProc = null;
      const offlineUrl = `${baseUrl}/terminal?view=opps`;
      await cdp.send("Page.navigate", { url: offlineUrl });
      await waitForPagePredicate(
        cdp,
        `document.querySelector("h1")?.textContent === "Keine Verbindung"
          && document.querySelector("main a")?.href === ${JSON.stringify(offlineUrl)}
          && document.documentElement.scrollWidth <= innerWidth`,
        "offline notice, retry URL and mobile layout",
      );
      offlineNavigationChecked = true;
    }

    console.log("MOBILE VIEWPORT AUDIT PASS");
    console.log(
      JSON.stringify(
        {
          viewports: VIEWPORTS.map((v) => v.name),
          scenariosChecked: results.length,
          offlineNavigationChecked,
          deploymentUpdateChecked,
          pineWorkerLifecycleChecked,
          compactDockSnapChecked,
          sidebarSheetsChecked,
          phoneDrawingOverlayChecked,
          phoneChartFocusChecked,
          tabletChartFocusViewports,
          compactNavigationViewports: COMPACT_NAV_VIEWPORTS.map(v => v.name),
          compactCanvasDensity: 2,
          pwaShortcutsChecked,
          pwaScreenshotsChecked,
          maxDocOverflowRatio: Math.max(...results.map((r) => r.docScrollWidth / Math.max(1, r.innerWidth))),
          totalMobileControlsAudited: results
            .filter((r) => r.viewport !== "1440x900")
            .reduce((acc, r) => acc + r.checkedControls, 0),
        },
        null,
        2,
      ),
    );
  } finally {
    cdp?.close();
    if (chrome && chrome.exitCode === null) {
      chrome.kill("SIGKILL");
      await new Promise((r) => setTimeout(r, 150));
    }
    if (serverProc && serverProc.exitCode === null) {
      serverProc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
      if (serverProc.exitCode === null) serverProc.kill("SIGKILL");
    }
    await Promise.all(tempChromeDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})));
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

await run();
