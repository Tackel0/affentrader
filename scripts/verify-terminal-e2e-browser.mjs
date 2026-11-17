import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

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
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
          ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

const CHROME_PATH = resolveChromePath();

const MOCK_OSINT_PAYLOAD = {
  fetchedAt: Date.now(),
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
      updatedAt: 1763121600000,
      source: "Digitraffic Marine AIS",
    },
    {
      id: "ais-244112000",
      mmsi: 244112000,
      name: "BALTIC CARGO",
      category: "cargo",
      shipType: 70,
      lat: 55.67,
      lon: 12.56,
      sogKnots: 10.8,
      cogDeg: 180,
      destination: "HAMBURG",
      updatedAt: 1763121600000,
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
    {
      id: "adsb-ae9912",
      icao: "ae9912",
      callsign: "RCH402",
      aircraftType: "KC135",
      category: "military-tanker",
      lat: 35.2,
      lon: 24.1,
      altitudeFt: 28000,
      speedKnots: 430,
      headingDeg: 115,
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
      publishedAt: "2026-11-14T12:00:00Z",
    },
  ],
  correlatedTickers: [
    { symbol: "YF:BZ=F", label: "Brent Crude", sector: "Energy" },
    { symbol: "YF:FRO", label: "Frontline", sector: "Tanker" },
  ],
  feedStatus: {
    ais: { ok: true, count: 2, provider: "Digitraffic Marine AIS (Baltic / N. Europe)" },
    adsb: { ok: true, count: 2, provider: "adsb.lol" },
    marine: { ok: true, count: 1 },
  },
};

function mockApiResponse(urlStr) {
  const url = new URL(urlStr, "http://127.0.0.1");
  if (url.pathname === "/api/osint-map") return MOCK_OSINT_PAYLOAD;
  if (url.pathname === "/api/feeds") {
    const kind = url.searchParams.get("kind");
    if (kind === "macro") {
      return {
        fearGreed: { value: 54, classification: "Neutral", source: "CNN" },
        crossAssets: [
          { symbol: "YF:^GSPC", label: "S&P 500", price: 5980.4, changePct: 0.42 },
          { symbol: "YF:^VIX", label: "VIX", price: 15.2, changePct: -1.4 },
          { symbol: "YF:BZ=F", label: "Brent", price: 73.8, changePct: 0.9 },
        ],
      };
    }
    if (kind === "yields") return { curves: [] };
    if (kind === "news") return { items: [], failed: [] };
    return { events: [] };
  }
  if (url.pathname === "/api/terminal-capm") {
    return {
      ticker: url.searchParams.get("ticker") || "INTC",
      name: "Intel Corp.",
      benchmark: "S&P 500",
      currency: "USD",
      asOf: "2026-11-13",
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
  if (url.pathname === "/api/terminal-opportunities") {
    return {
      market: "US S&P 500",
      benchmark: "SPY",
      benchmarkSession: "2026-11-13",
      generatedAt: Date.now(),
      evaluated: 24,
      universe: 24,
      dataSources: ["Yahoo Finance", "TradingView", "SEC Form 4 XML"],
      opportunities: [],
      unavailable: [],
    };
  }
  if (url.pathname === "/api/terminal-fundamentals") {
    const ticker = url.searchParams.get("ticker") || "INTC";
    return {
      ticker,
      lastClose: 24.5,
      fundamentals: {
        ticker,
        name: "Intel Corp.",
        sector: "Electronic Technology",
        currency: "USD",
        marketCapBn: 108.2,
        forwardPe: null,
        sectorMedianPe: 24.0,
        historicalMedianPe: null,
        peVsHistoryPct: null,
        evToEbitda: 14.2,
        sectorMedianEvEbitda: 18.0,
        priceToFcf: null,
        fcfYieldPct: null,
        pegRatio: null,
        netDebtToEbitda: 1.5,
        operatingMarginPct: 4.1,
        netMarginPct: 1.2,
        roePct: 2.4,
        epsRevisionPct: null,
        revenueGrowthPct: 3.1,
        analystTarget: 91.04,
        fairValue: 35.0,
        analystConsensus: {
          buy: 8,
          hold: 20,
          sell: 7,
          ratingLabel: "Hold",
          analystCount: 35,
          targetLow: 18,
          targetMean: 25.4,
          targetHigh: 91,
          recentActions: [],
        },
        insiderBuys90d: 0,
        insiderNetValueUsd: 0,
        recentInsiderFilings: [],
        earningsSurprisePct: 12.0,
        lastEarningsDate: "2026-10-30",
        dataSources: ["TradingView", "Yahoo Finance"],
        source: "tradingview+sec+yahoo",
      },
      quant: null,
    };
  }
  if (url.pathname === "/api/terminal-markets") return { rows: [] };
  if (url.pathname === "/api/stock-heatmap") {
    return { market: "us", sectors: ["Technology"], rows: [], generatedAt: Date.now(), source: "Mock" };
  }
  return {};
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", (err) => reject(err));
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
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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

async function run() {
  const bundle = await build({
    entryPoints: ["tests/browser/terminal-overlays-e2e.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    write: false,
  });

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<title>Affentrader E2E Headless Chrome</title>
<style>
  :root { --bg: #0b0e14; --surface: #121722; --surface2: #182030; --text: #e6edf3; --muted: #8b949e; --border: #263042; --accent: #2962ff; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 12px system-ui, sans-serif; }
  #chart { width: 960px; height: 540px; position: relative; }
  #osint-root, #terminal-root { width: 1100px; min-height: 480px; }
  .button, .chip { padding: 4px 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
  .button.primary { background: var(--accent); color: #fff; }
  .segmented { display: inline-flex; gap: 4px; }
</style>
</head>
<body>
  <div id="chart"></div>
  <div id="osint-root"></div>
  <div id="terminal-root"></div>
  <script type="module" src="/fixture.js"></script>
</body>
</html>`;

  const unexpectedRequests = [];
  const server = createServer((req, res) => {
    const reqUrl = req.url || "/";
    const reqPathname = new URL(reqUrl, "http://127.0.0.1").pathname;
    if (reqPathname === "/" || reqPathname === "/terminal") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
      return;
    }
    if (reqPathname === "/fixture.js") {
      res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(bundle.outputFiles[0].contents);
      return;
    }
    if (reqPathname.startsWith("/api/")) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(mockApiResponse(reqUrl)));
      return;
    }
    unexpectedRequests.push(reqUrl);
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const tempDirs = [];

  let chrome;
  let cdp;
  const launchChrome = async (extraArgs = []) => {
    const userDataDir = await mkdtemp(join(tmpdir(), "affentrader-chrome-e2e-"));
    tempDirs.push(userDataDir);
    const proc = spawn(
      CHROME_PATH,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1280,1200",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        ...extraArgs,
        "about:blank",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const browserWsUrl = await new Promise((resolve, reject) => {
      let stderr = "";
      const timer = setTimeout(() => {
        if (proc.exitCode === null) proc.kill("SIGKILL");
        reject(new Error(`Chrome DevTools startup timeout. stderr=${stderr}`));
      }, 15_000);
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
        const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      proc.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Chrome exited early (${code}). stderr=${stderr}`));
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

    const parsedWs = new URL(browserWsUrl);
    const listRes = await fetch(`http://127.0.0.1:${parsedWs.port}/json/list`);
    const targets = await listRes.json();
    const pageTarget = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!pageTarget) throw new Error(`No inspectable Chrome page target found: ${JSON.stringify(targets)}`);

    cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Log.enable");

    const evalPageE2E = async (navUrl) => {
      await cdp.send("Page.navigate", { url: navUrl });
      const res = await cdp.send("Runtime.evaluate", {
        expression: `(async () => {
          const deadline = Date.now() + 25000;
          while (!window.__e2ePromise && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
          if (!window.__e2ePromise) throw new Error("window.__e2ePromise never initialized for ${navUrl}");
          return await window.__e2ePromise;
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (res.exceptionDetails) {
        throw new Error(`Browser E2E threw exception on ${navUrl}: ${JSON.stringify(res.exceptionDetails)}`);
      }
      return res.result.value;
    };

    const mainRoute = await evalPageE2E(`${baseUrl}/`);
    const terminalRoute = await evalPageE2E(`${baseUrl}/terminal`);
    const terminalReload = await evalPageE2E(`${baseUrl}/terminal?verify=reload`);

    const consoleErrors = [];
    for (const ev of cdp.events) {
      if (ev.method === "Runtime.exceptionThrown") {
        const d = ev.params?.exceptionDetails;
        consoleErrors.push(`Runtime.exceptionThrown: ${d?.exception?.description ?? d?.text ?? JSON.stringify(d)}`);
      } else if (ev.method === "Runtime.consoleAPICalled" && ev.params?.type === "error") {
        consoleErrors.push(`console.error: ${JSON.stringify(ev.params?.args?.map((a) => a.value ?? a.description))}`);
      } else if (ev.method === "Log.entryAdded" && ev.params?.entry?.level === "error") {
        consoleErrors.push(`Log.error: ${ev.params.entry.text} (${ev.params.entry.url ?? "no-url"})`);
      }
    }

    if (unexpectedRequests.length > 0) {
      throw new Error(`Unexpected 404 requests: ${unexpectedRequests.join(", ")}\nConsole errors: ${consoleErrors.join(" | ")}`);
    }
    if (consoleErrors.length > 0) {
      throw new Error(`Uncaught browser/console errors detected (${consoleErrors.length}):\n${consoleErrors.join("\n")}`);
    }

    console.log("HEADLESS CHROME E2E PASS");
    console.log(JSON.stringify({ mainRoute, terminalRoute, terminalReload }, null, 2));
  } finally {
    cdp?.close();
    if (chrome && chrome.exitCode === null) {
      chrome.kill("SIGKILL");
      await new Promise((r) => setTimeout(r, 150));
    }
    server.close();
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})));
  }
}

await run();
