// Mocks for JSDOM component testing environment

if (typeof window !== "undefined") {
  // ResizeObserver mock
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  }

  // matchMedia mock
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }

  // BroadcastChannel mock
  class MockBroadcastChannel {
    name: string;
    onmessage: ((event: MessageEvent) => void) | null = null;
    constructor(name: string) {
      this.name = name;
    }
    postMessage(_data: unknown) {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
      return false;
    }
  }
  if (!window.BroadcastChannel) {
    window.BroadcastChannel = MockBroadcastChannel as unknown as typeof BroadcastChannel;
  }

  // HTMLCanvasElement 2D context mock
  if (typeof HTMLCanvasElement !== "undefined") {
    HTMLCanvasElement.prototype.getContext = function () {
      return {
        fillRect: () => {},
        clearRect: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
        putImageData: () => {},
        createImageData: () => [],
        setTransform: () => {},
        drawImage: () => {},
        save: () => {},
        fillText: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        stroke: () => {},
        translate: () => {},
        scale: () => {},
        rotate: () => {},
        arc: () => {},
        fill: () => {},
        measureText: () => ({ width: 50 }),
        transform: () => {},
        rect: () => {},
        clip: () => {},
      } as unknown as RenderingContext;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  }

  // scrollTo and scrollIntoView mocks
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!window.scrollTo) {
    window.scrollTo = () => {};
  }

  // Fullscreen API mocks (JSDOM does not implement requestFullscreen / exitFullscreen)
  if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.requestFullscreen) {
    HTMLElement.prototype.requestFullscreen = async () => {};
  }
  if (typeof Document !== "undefined" && !Document.prototype.exitFullscreen) {
    Document.prototype.exitFullscreen = async () => {};
  }

  // Default mock fetch for background sub-panel data feeds
  const originalFetch = global.fetch;
  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    if (urlStr.includes("/api/terminal-opportunities")) {
      return {
        ok: true,
        json: async () => ({
          market: "us",
          benchmark: "^GSPC",
          benchmarkSession: "2026-11-14",
          universe: 100,
          evaluated: 100,
          opportunities: [],
          unavailable: [],
          dataSources: ["TradingView", "SEC Form 4", "Yahoo Finance"],
          generatedAt: Date.now(),
        }),
      } as Response;
    }
    if (urlStr.includes("/api/terminal-fundamentals")) {
      return { ok: true, json: async () => ({ snapshot: null }) } as Response;
    }
    if (urlStr.includes("/api/terminal-markets")) {
      return { ok: true, json: async () => ({ rows: [] }) } as Response;
    }
    if (urlStr.includes("/api/feeds") && urlStr.includes("news")) {
      return { ok: true, json: async () => ({ items: [], failed: [] }) } as Response;
    }
    if (urlStr.includes("/api/feeds") && urlStr.includes("macro")) {
      return {
        ok: true,
        json: async () => ({
          crossAssets: [
            { symbol: "^GSPC", label: "S&P 500", price: "5,800.50", changePct: 0.8 },
            { symbol: "BTCUSDT", label: "Bitcoin", price: "$92,400", changePct: 2.5 },
          ],
          fearGreed: { value: 72, classification: "Greed" },
          fred: [],
        }),
      } as Response;
    }
    if (urlStr.includes("/api/feeds") && urlStr.includes("yields")) {
      return { ok: true, json: async () => ({ curves: [] }) } as Response;
    }
    if (urlStr.includes("/api/feeds")) {
      return { ok: true, json: async () => ({ events: [] }) } as Response;
    }
    if (urlStr.includes("/api/market")) {
      return { ok: true, json: async () => [] } as Response;
    }
    if (urlStr.includes("/api/osint-map")) {
      return {
        ok: true,
        json: async () => ({
          generatedAt: Date.now(),
          vessels: [],
          flights: [],
          chokepoints: [],
          routes: [],
          correlatedTickers: [],
          feedStatus: {
            ais: { ok: true, count: 0, provider: "mock" },
            adsb: { ok: true, count: 0, provider: "mock" },
          },
          weather: [],
        }),
      } as Response;
    }
    if (urlStr.includes("/api/stock-heatmap")) {
      return { ok: true, json: async () => ({ rows: [] }) } as Response;
    }
    if (urlStr.includes("/api/stock-base")) {
      return { ok: true, json: async () => ({ bases: [] }) } as Response;
    }
    if (urlStr.includes("/api/terminal-capm")) {
      return {
        ok: true,
        json: async () => ({
          ticker: "AAPL",
          name: "Apple Inc.",
          benchmark: "^GSPC",
          currency: "USD",
          asOf: "2026-11-14",
          riskFree: 4.25,
          beta: 1.15,
          alpha: 0.045,
          r2: 0.62,
          volatility: 0.22,
          capmReturn: 0.115,
          sharpe: 0.52,
          observations: 252,
        }),
      } as Response;
    }
    if (originalFetch) return originalFetch(input, init);
    return { ok: true, json: async () => ({}) } as Response;
  };
}
