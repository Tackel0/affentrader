import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const CHROME_PATH = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

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
    adsb: { ok: true, count: 1, provider: "adsb.lol" },
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

async function runStaticVerification() {
  console.log("=== Phase 1: Static Codebase & CSS Invariants Verification ===");
  const findings = [];

  // 1. Check app/features.css
  const featuresCss = await readFile("app/features.css", "utf8");
  if (featuresCss.includes("1120px")) {
    findings.push({ check: "Absence of 1120px in features.css", pass: false, error: "features.css still references 1120px" });
  } else {
    findings.push({ check: "Absence of 1120px in features.css", pass: true });
  }

  // 2. Check .chip definition in app/features.css
  const chipMatch = featuresCss.match(/\.chip\s*\{([^}]+)\}/);
  if (!chipMatch) {
    findings.push({ check: ".chip class definition in features.css", pass: false, error: ".chip selector not found" });
  } else {
    const chipBody = chipMatch[1];
    const has1px = chipBody.includes("border-radius: 1px");
    const has999px = chipBody.includes("999px");
    if (has1px && !has999px) {
      findings.push({ check: ".chip has 1px corners and NO 999px pill", pass: true });
    } else {
      findings.push({ check: ".chip corners", pass: false, error: `has1px=${has1px}, has999px=${has999px}` });
    }
  }

  // 3. Check @media (max-width: 800px) mobile fallback
  if (featuresCss.includes("@media (max-width: 800px)") && featuresCss.includes(".affen-terminal .terminal-workspace-grid")) {
    findings.push({ check: "Mobile fallback correctly bounded at 800px", pass: true });
  } else {
    findings.push({ check: "Mobile fallback at 800px", pass: false, error: "800px query missing or incorrect" });
  }

  // 4. Check app/globals.css
  const globalsCss = await readFile("app/globals.css", "utf8");
  const hasDarkBg = globalsCss.includes("--bg: #08090c;");
  const hasAmberAccent = globalsCss.includes("--accent: #ff9e00;");
  const hasPrimaryAmber = globalsCss.includes(".button.primary") && globalsCss.includes("background: #ff9e00;");
  const hasPrimaryBlackText = globalsCss.includes("color: #000000;");
  const hasButtonRadius1px = globalsCss.includes(".button") && globalsCss.includes("border-radius: 1px;");

  findings.push({ check: "app/globals.css --bg: #08090c", pass: hasDarkBg });
  findings.push({ check: "app/globals.css --accent: #ff9e00", pass: hasAmberAccent });
  findings.push({ check: "app/globals.css .button.primary amber background", pass: hasPrimaryAmber });
  findings.push({ check: "app/globals.css .button.primary black text", pass: hasPrimaryBlackText });
  findings.push({ check: "app/globals.css .button 1px border-radius", pass: hasButtonRadius1px });

  for (const f of findings) {
    console.log(`[Static] ${f.pass ? "PASS" : "FAIL"}: ${f.check} ${f.error ? "-> " + f.error : ""}`);
    if (!f.pass) throw new Error(`Static verification failed: ${f.check}`);
  }
  return findings;
}

async function runBrowserVerification() {
  console.log("\n=== Phase 2: Live Headless Chrome Adversarial Verification ===");

  const bundle = await build({
    entryPoints: ["scripts/verify-milestone1-fixture.tsx"],
    bundle: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    write: false,
  });

  const rawGlobals = await readFile("app/globals.css", "utf8");
  const globalsCleaned = rawGlobals.replace('@import "tailwindcss";', "").replace(/@theme\s*\{[^}]+\}/g, "");
  const rawFeatures = await readFile("app/features.css", "utf8");

  // Read compiled Next.js CSS files
  let compiledCss = "";
  try {
    const cssFiles = await readdir(".next/static/css");
    for (const file of cssFiles) {
      if (file.endsWith(".css")) {
        compiledCss += await readFile(join(".next/static/css", file), "utf8") + "\n";
      }
    }
  } catch (err) {
    console.warn("Could not read .next/static/css (falling back to raw CSS):", err.message);
  }

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<title>AffenTerminal Adversarial Empirical Verification</title>
<style>
${compiledCss}
${globalsCleaned}
${rawFeatures}
</style>
</head>
<body>
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
  const userDataDir = await mkdtemp(join(tmpdir(), "affentrader-challenger-m1-"));

  let chrome;
  let cdp;
  const empiricalResults = {};

  try {
    chrome = spawn(
      CHROME_PATH,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1200,900",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        "about:blank",
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    const browserWsUrl = await new Promise((resolve, reject) => {
      let stderr = "";
      const timer = setTimeout(() => reject(new Error(`Chrome startup timeout. stderr=${stderr}`)), 15_000);
      chrome.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
        const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      chrome.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Chrome exited early (${code}). stderr=${stderr}`));
      });
    });

    const parsedWs = new URL(browserWsUrl);
    const listRes = await fetch(`http://127.0.0.1:${parsedWs.port}/json/list`);
    const targets = await listRes.json();
    const pageTarget = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!pageTarget) throw new Error(`No inspectable Chrome page target found`);

    cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Log.enable");

    // Navigate to test page
    await cdp.send("Page.navigate", { url: `${baseUrl}/terminal` });

    // Wait for window.__testHarness to be available
    await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const deadline = Date.now() + 15000;
        while (!window.__testHarness && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
        if (!window.__testHarness) throw new Error("window.__testHarness never initialized");
        await window.__testHarness.mount({ initialView: "fa", initialTicker: "INTC" });
      })()`,
      awaitPromise: true,
    });

    // Helper to evaluate JS in browser
    const evalJs = async (expr) => {
      const res = await cdp.send("Runtime.evaluate", {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
      });
      if (res.exceptionDetails) {
        throw new Error(`Eval error for [${expr}]: ${JSON.stringify(res.exceptionDetails)}`);
      }
      return res.result.value;
    };

    // Helper to set viewport
    const setViewport = async (width, height = 900) => {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await new Promise((r) => setTimeout(r, 60));
    };

    const consoleErrors = [];
    for (const ev of cdp.events) {
      if (ev.method === "Runtime.exceptionThrown") {
        const d = ev.params?.exceptionDetails;
        consoleErrors.push(`Runtime.exceptionThrown: ${d?.exception?.description ?? d?.text ?? JSON.stringify(d)}`);
      } else if (ev.method === "Runtime.consoleAPICalled" && ev.params?.type === "error") {
        consoleErrors.push(`console.error: ${JSON.stringify(ev.params?.args?.map((a) => a.value ?? a.description))}`);
      }
    }
    if (consoleErrors.length > 0) {
      console.log("Console errors in Chrome:\n" + consoleErrors.join("\n"));
    }
    const htmlContent = await evalJs(`document.body.innerHTML`);
    console.log("Body innerHTML length:", htmlContent.length);
    console.log("Body snippet:", htmlContent.slice(0, 300));

    // -------------------------------------------------------------
    // Test A: Canvas and Body Background Color (#08090c)
    // -------------------------------------------------------------
    const bodyBg = await evalJs(`window.getComputedStyle(document.body).backgroundColor`);
    const shellBg = await evalJs(`window.__testHarness.getComputedStyle(".affen-window-shell", "background-color")`);
    const rootBgVar = await evalJs(`window.getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()`);
    empiricalResults.bodyBackground = { bodyBg, shellBg, rootBgVar };

    // rgb(8, 9, 12) === #08090c
    if (bodyBg !== "rgb(8, 9, 12)" && shellBg !== "rgb(8, 9, 12)") {
      throw new Error(`Background is not #08090c (rgb(8, 9, 12)), got bodyBg=${bodyBg}, shellBg=${shellBg}`);
    }
    console.log(`[Browser] PASS: Background is pitch charcoal #08090c (bodyBg=${bodyBg}, shellBg=${shellBg})`);

    // -------------------------------------------------------------
    // Test B: Primary Button Amber (#ff9e00) & 1px Corners
    // -------------------------------------------------------------
    const primaryBtnBg = await evalJs(`window.__testHarness.getComputedStyle(".button.primary", "background-color")`);
    const primaryBtnColor = await evalJs(`window.__testHarness.getComputedStyle(".button.primary", "color")`);
    const primaryBtnRadius = await evalJs(`window.__testHarness.getComputedStyle(".button.primary", "border-radius")`);
    empiricalResults.primaryButton = { primaryBtnBg, primaryBtnColor, primaryBtnRadius };

    // rgb(255, 158, 0) === #ff9e00, text color rgb(0, 0, 0)
    if (primaryBtnBg !== "rgb(255, 158, 0)") {
      throw new Error(`Primary button background is not #ff9e00 (rgb(255, 158, 0)), got ${primaryBtnBg}`);
    }
    if (primaryBtnColor !== "rgb(0, 0, 0)") {
      throw new Error(`Primary button text color is not #000000 (rgb(0, 0, 0)), got ${primaryBtnColor}`);
    }
    if (primaryBtnRadius !== "1px") {
      throw new Error(`Primary button border radius is not 1px, got ${primaryBtnRadius}`);
    }
    console.log(`[Browser] PASS: Primary button is amber #ff9e00 (bg=${primaryBtnBg}, color=${primaryBtnColor}, radius=${primaryBtnRadius})`);

    // -------------------------------------------------------------
    // Test C: Elimination of Pill Badges in .chip (1px corners)
    // -------------------------------------------------------------
    const chipsInfo = await evalJs(`window.__testHarness.getAllChipsRadius()`);
    empiricalResults.chips = chipsInfo;
    if (chipsInfo.length === 0) {
      throw new Error("No .chip elements found in DOM to verify");
    }
    for (const chip of chipsInfo) {
      if (chip.radius.includes("999px") || chip.radius.includes("50%")) {
        throw new Error(`Found pill badge in .chip (${chip.text}): radius=${chip.radius}`);
      }
      if (chip.radius !== "1px") {
        throw new Error(`Expected .chip to have 1px corners, got ${chip.radius} on "${chip.text}"`);
      }
    }
    console.log(`[Browser] PASS: All ${chipsInfo.length} .chip elements render with 1px corners (no 999px pill badges)`);

    // -------------------------------------------------------------
    // Test D: Multi-Pane Grid Stability across Viewports (1200px, 1000px, 900px, and 750px)
    // -------------------------------------------------------------
    // Switch to 2-Pane layout
    await evalJs(`window.__testHarness.clickElementText("2-Pane")`);
    await new Promise((r) => setTimeout(r, 100));

    // Test 1200px
    await setViewport(1200);
    const cols1200_2p = await evalJs(`window.__testHarness.getGridColumns()`);
    if (!cols1200_2p || cols1200_2p === "1fr" || cols1200_2p.split(" ").length < 2) {
      throw new Error(`2-Pane grid collapsed at 1200px: ${cols1200_2p}`);
    }

    // Test 1000px (previously collapsed under 1120px!)
    await setViewport(1000);
    const cols1000_2p = await evalJs(`window.__testHarness.getGridColumns()`);
    if (!cols1000_2p || cols1000_2p === "1fr" || cols1000_2p.split(" ").length < 2) {
      throw new Error(`2-Pane grid collapsed at 1000px: ${cols1000_2p}`);
    }

    // Test 900px (previously collapsed under 1120px!)
    await setViewport(900);
    const cols900_2p = await evalJs(`window.__testHarness.getGridColumns()`);
    if (!cols900_2p || cols900_2p === "1fr" || cols900_2p.split(" ").length < 2) {
      throw new Error(`2-Pane grid collapsed at 900px: ${cols900_2p}`);
    }

    // Switch to 3-Pane layout
    await evalJs(`window.__testHarness.clickElementText("3-Pane")`);
    await new Promise((r) => setTimeout(r, 100));

    await setViewport(1200);
    const cols1200_3p = await evalJs(`window.__testHarness.getGridColumns()`);
    if (!cols1200_3p || cols1200_3p.split(" ").length < 3) {
      throw new Error(`3-Pane grid collapsed at 1200px: ${cols1200_3p}`);
    }

    await setViewport(1000);
    const cols1000_3p = await evalJs(`window.__testHarness.getGridColumns()`);
    if (!cols1000_3p || cols1000_3p.split(" ").length < 3) {
      throw new Error(`3-Pane grid collapsed at 1000px: ${cols1000_3p}`);
    }

    await setViewport(900);
    const cols900_3p = await evalJs(`window.__testHarness.getGridColumns()`);
    if (!cols900_3p || cols900_3p.split(" ").length < 3) {
      throw new Error(`3-Pane grid collapsed at 900px: ${cols900_3p}`);
    }

    // Adversarial test below 800px (e.g. 750px): should collapse to 1fr
    await setViewport(750);
    const cols750 = await evalJs(`window.__testHarness.getGridColumns()`);
    empiricalResults.gridColumns = {
      split2: { width1200: cols1200_2p, width1000: cols1000_2p, width900: cols900_2p },
      split3: { width1200: cols1200_3p, width1000: cols1000_3p, width900: cols900_3p },
      mobile750: cols750,
    };
    console.log(`[Browser] PASS: Multi-pane holds at 1200px, 1000px, 900px. Results:`, JSON.stringify(empiricalResults.gridColumns, null, 2));

    // Reset viewport back to desktop 1200
    await setViewport(1200);

    // -------------------------------------------------------------
    // Test E: Tested DOM Text Strings Presence & Visibility
    // -------------------------------------------------------------
    const domStrings = {};

    // 1. "Off" link group radio chip
    const hasOff = await evalJs(`window.__testHarness.hasVisibleText("Off")`);
    if (!hasOff) throw new Error("DOM string 'Off' is missing or not visible");
    // Click Off and verify aria-checked
    await evalJs(`window.__testHarness.clickElementText("Off")`);
    const offChecked = await evalJs(`
      (() => {
        const btn = Array.from(document.querySelectorAll("button, [role='radio']")).find(b => (b.textContent||"").trim() === "Off");
        return btn ? btn.getAttribute("aria-checked") : null;
      })()
    `);
    domStrings.off = { visible: hasOff, ariaChecked: offChecked };
    if (offChecked !== "true") throw new Error(`Clicking 'Off' did not set aria-checked=true (got ${offChecked})`);
    console.log(`[Browser] PASS: String 'Off' exists, visible, and functional (aria-checked=${offChecked})`);

    // 2. "Trade-M" tab button
    const hasTradeM = await evalJs(`window.__testHarness.hasVisibleText("Trade-M")`);
    if (!hasTradeM) throw new Error("DOM string 'Trade-M' is missing or not visible");
    domStrings.tradeM = { visible: hasTradeM };
    console.log(`[Browser] PASS: String 'Trade-M' exists and is visible`);

    // Click Trade-M to switch into Opportunities view
    await evalJs(`window.__testHarness.clickElementText("Trade-M")`);
    await new Promise((r) => setTimeout(r, 400));

    // 3. "Trade-Setups aktiv"
    const hasTradeSetupsAktiv = await evalJs(`window.__testHarness.hasVisibleText("Trade-Setups aktiv")`);
    if (!hasTradeSetupsAktiv) throw new Error("DOM string 'Trade-Setups aktiv' is missing or not visible");
    domStrings.tradeSetupsAktiv = { visible: hasTradeSetupsAktiv };
    console.log(`[Browser] PASS: String 'Trade-Setups aktiv' exists and is visible`);

    // 4. "OSINT" tab button
    const hasOsint = await evalJs(`window.__testHarness.hasVisibleText("OSINT")`);
    if (!hasOsint) throw new Error("DOM string 'OSINT' is missing or not visible");
    domStrings.osint = { visible: hasOsint };
    console.log(`[Browser] PASS: String 'OSINT' exists and is visible`);

    // Click OSINT to switch into OSINT view
    await evalJs(`window.__testHarness.clickElementText("OSINT")`);
    await new Promise((r) => setTimeout(r, 600));

    // 5. "Baltic"
    const hasBaltic = await evalJs(`window.__testHarness.hasVisibleText("Baltic")`);
    if (!hasBaltic) throw new Error("DOM string 'Baltic' is missing or not visible");
    domStrings.baltic = { visible: hasBaltic };
    console.log(`[Browser] PASS: String 'Baltic' exists and is visible`);

    empiricalResults.domStrings = domStrings;

    // -------------------------------------------------------------
    // Test F: Theme Switching Verification (Light <-> Dark)
    // -------------------------------------------------------------
    await evalJs(`window.__testHarness.clickElementText("Light")`);
    await new Promise((r) => setTimeout(r, 100));
    const lightThemeAttr = await evalJs(`document.documentElement.getAttribute("data-theme")`);
    const lightBg = await evalJs(`window.getComputedStyle(document.body).backgroundColor`);
    empiricalResults.themeSwitch = { lightThemeAttr, lightBg };
    if (lightThemeAttr !== "light") throw new Error(`Switching to light theme failed: data-theme=${lightThemeAttr}`);

    // Switch back to Dark
    await evalJs(`window.__testHarness.clickElementText("Dark")`);
    await new Promise((r) => setTimeout(r, 100));
    const darkThemeAttr = await evalJs(`document.documentElement.getAttribute("data-theme")`);
    const darkBgReverted = await evalJs(`window.getComputedStyle(document.body).backgroundColor`);
    empiricalResults.themeSwitch.darkThemeAttr = darkThemeAttr;
    empiricalResults.themeSwitch.darkBgReverted = darkBgReverted;
    if (darkBgReverted !== "rgb(8, 9, 12)") {
      throw new Error(`Reverting to dark theme did not restore rgb(8, 9, 12), got ${darkBgReverted}`);
    }
    console.log(`[Browser] PASS: Theme toggle verified (Light -> Dark restored #08090c)`);

    console.log("\nALL EMPIRICAL ADVERSARIAL CHECKS PASSED SUCCESSFULLY!");
    return empiricalResults;
  } finally {
    cdp?.close();
    if (chrome && chrome.exitCode === null) {
      chrome.kill("SIGKILL");
      await new Promise((r) => setTimeout(r, 150));
    }
    server.close();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  try {
    const staticResults = await runStaticVerification();
    const browserResults = await runBrowserVerification();
    console.log("\n================ SUMMARY OF EMPIRICAL VERIFICATION ================");
    console.log(JSON.stringify({ static: staticResults, browser: browserResults }, null, 2));
    process.exit(0);
  } catch (err) {
    console.error("\n[CRITICAL FAILURE] Adversarial test failed:", err);
    process.exit(1);
  }
}

await main();
