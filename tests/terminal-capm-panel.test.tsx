// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, act, within, cleanup } from "@testing-library/react";
import { ResearchTerminal } from "@/components/ResearchTerminal";
import { useChartStore } from "@/stores/useChartStore";

describe("Terminal CAPM Panel", () => {
  const mockCapmSuccess = {
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
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    useChartStore.setState({ symbol: "YF:AAPL", timeframe: "1D" });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ==========================================
  // Tier 1: Feature Coverage (Happy Paths)
  // ==========================================
  describe("Tier 1: Feature Coverage", () => {
    it("renders CAPM configuration form with Ticker, Benchmark, and Risk-free rate", () => {
      const { container } = render(<ResearchTerminal initialView="capm" externalWindow={false} />);
      const capmContainer = container.querySelector(".stock-base-evidence")!;
      expect(capmContainer).not.toBeNull();

      expect(capmContainer.textContent).toContain("Ticker");
      expect(capmContainer.textContent).toContain("Benchmark");
      expect(capmContainer.textContent).toContain("Risk-free rate %");

      const submitBtn = within(capmContainer as HTMLElement).getByRole("button", { name: /Calculate/i });
      expect(submitBtn).toBeDefined();
    });

    it("submits form with valid parameters and triggers API fetch", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      const { container } = render(
        <ResearchTerminal initialView="capm" initialTicker="AAPL" externalWindow={false} />
      );

      const capmForm = container.querySelector(".stock-base-evidence form")!;
      const rateInput = container.querySelector('input[type="number"]') as HTMLInputElement;

      await act(async () => {
        fireEvent.change(rateInput, { target: { value: "4.25" } });
      });
      await act(async () => {
        fireEvent.submit(capmForm);
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/terminal-capm?ticker=AAPL&market=us&rf=4.25"),
        expect.anything()
      );
    });

    it("displays calculated regression statistics when API succeeds", async () => {
      const { container } = render(
        <ResearchTerminal initialView="capm" initialTicker="AAPL" externalWindow={false} />
      );

      const capmForm = container.querySelector(".stock-base-evidence form")!;
      const rateInput = container.querySelector('input[type="number"]') as HTMLInputElement;

      await act(async () => {
        fireEvent.change(rateInput, { target: { value: "4.25" } });
      });
      await act(async () => {
        fireEvent.submit(capmForm);
      });

      // Verify stats list rendered
      const dl = container.querySelector(".stock-base-evidence dl");
      expect(dl).not.toBeNull();

      const dlText = dl?.textContent ?? "";
      expect(dlText).toContain("Beta");
      expect(dlText).toContain("1.15");
      expect(dlText).toContain("Jensen alpha (annual log %)");
      expect(dlText).toContain("4.50%");
      expect(dlText).toContain("R²");
      expect(dlText).toContain("0.620");
      expect(dlText).toContain("Annual volatility");
      expect(dlText).toContain("22.00%");
      expect(dlText).toContain("Model return (annual)");
      expect(dlText).toContain("11.50%");
      expect(dlText).toContain("Sharpe (annual)");
      expect(dlText).toContain("0.52");

      // Verify meta description
      expect(container.textContent).toContain("Apple Inc. vs ^GSPC · 252 paired daily returns");
    });
  });

  // ==========================================
  // Tier 2: Boundary & Corner Cases (Input Validation)
  // ==========================================
  describe("Tier 2: Boundary & Corner Cases", () => {
    it("rejects annual risk-free rate below -20% (e.g. -25%)", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      const { container } = render(
        <ResearchTerminal initialView="capm" initialTicker="AAPL" externalWindow={false} />
      );

      const capmForm = container.querySelector(".stock-base-evidence form")!;
      const rateInput = container.querySelector('input[type="number"]') as HTMLInputElement;

      await act(async () => {
        fireEvent.change(rateInput, { target: { value: "-25" } });
      });
      await act(async () => {
        fireEvent.submit(capmForm);
      });

      // Error message rendered in status
      const statusMsg = container.querySelector("p.form-help[role='status']");
      expect(statusMsg?.textContent).toContain("Enter a valid ticker and annual risk-free rate (−20% to 50%).");

      // Fetch should NOT have been called
      expect(fetchSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("/api/terminal-capm"),
        expect.anything()
      );
    });

    it("rejects annual risk-free rate above 50% (e.g. 55%)", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      const { container } = render(
        <ResearchTerminal initialView="capm" initialTicker="AAPL" externalWindow={false} />
      );

      const capmForm = container.querySelector(".stock-base-evidence form")!;
      const rateInput = container.querySelector('input[type="number"]') as HTMLInputElement;

      await act(async () => {
        fireEvent.change(rateInput, { target: { value: "55" } });
      });
      await act(async () => {
        fireEvent.submit(capmForm);
      });

      const statusMsg = container.querySelector("p.form-help[role='status']");
      expect(statusMsg?.textContent).toContain("Enter a valid ticker and annual risk-free rate (−20% to 50%).");
      expect(fetchSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("/api/terminal-capm"),
        expect.anything()
      );
    });

    it("rejects invalid ticker characters (e.g. $$$INVALID)", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      const { container } = render(
        <ResearchTerminal initialView="capm" initialTicker="AAPL" externalWindow={false} />
      );

      const capmForm = container.querySelector(".stock-base-evidence form")!;
      const tickerInput = container.querySelector(".stock-base-evidence input[maxlength='24']") as HTMLInputElement;

      await act(async () => {
        fireEvent.change(tickerInput, { target: { value: "$$$INVALID" } });
      });
      await act(async () => {
        fireEvent.submit(capmForm);
      });

      const statusMsg = container.querySelector("p.form-help[role='status']");
      expect(statusMsg?.textContent).toContain("Enter a valid ticker and annual risk-free rate (−20% to 50%).");
      expect(fetchSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("/api/terminal-capm"),
        expect.anything()
      );
    });

    it("accepts boundary rates exactly at -20% and 50%", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      const { container } = render(
        <ResearchTerminal initialView="capm" initialTicker="AAPL" externalWindow={false} />
      );

      const capmForm = container.querySelector(".stock-base-evidence form")!;
      const rateInput = container.querySelector('input[type="number"]') as HTMLInputElement;

      // Lower boundary: -20
      await act(async () => {
        fireEvent.change(rateInput, { target: { value: "-20" } });
      });
      await act(async () => {
        fireEvent.submit(capmForm);
      });
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("rf=-20"),
        expect.anything()
      );

      // Upper boundary: 50
      await act(async () => {
        fireEvent.change(rateInput, { target: { value: "50" } });
      });
      await act(async () => {
        fireEvent.submit(capmForm);
      });
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("rf=50"),
        expect.anything()
      );
    });
  });

  // ==========================================
  // Tier 3: Cross-Feature Integration
  // ==========================================
  describe("Tier 3: Cross-Feature Integration", () => {
    it("handles API failure gracefully and renders error message", async () => {
      const origFetch = global.fetch;
      vi.spyOn(global, "fetch").mockImplementation(async (url, init) => {
        if (String(url).includes("/api/terminal-capm")) {
          return {
            ok: false,
            json: async () => ({ error: "Benchmark price series unavailable." }),
          } as Response;
        }
        return origFetch(url, init);
      });

      const { container } = render(
        <ResearchTerminal initialView="capm" initialTicker="AAPL" externalWindow={false} />
      );

      const capmForm = container.querySelector(".stock-base-evidence form")!;
      await act(async () => {
        fireEvent.submit(capmForm);
      });

      const statusMsg = container.querySelector("p.form-help[role='status']");
      expect(statusMsg?.textContent).toContain("Benchmark price series unavailable.");
    });

    it("clears previous analysis and resets state when ticker input changes", async () => {
      const { container } = render(
        <ResearchTerminal initialView="capm" initialTicker="AAPL" externalWindow={false} />
      );

      const capmForm = container.querySelector(".stock-base-evidence form")!;
      await act(async () => {
        fireEvent.submit(capmForm);
      });

      // Verify analysis is rendered
      expect(container.querySelector(".stock-base-evidence dl")).not.toBeNull();

      // Change ticker input
      const tickerInput = container.querySelector(".stock-base-evidence input[maxlength='24']") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(tickerInput, { target: { value: "MSFT" } });
      });

      // Analysis should reset
      expect(container.querySelector(".stock-base-evidence dl")).toBeNull();
    });

    it("shows loading state while calculating and resets analysis when benchmark or rate changes", async () => {
      let resolveFetch!: (value: Response) => void;
      const origFetch = global.fetch;
      vi.spyOn(global, "fetch").mockImplementation((url, init) => {
        if (String(url).includes("/api/terminal-capm")) {
          return new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          });
        }
        return origFetch(url, init);
      });

      const { container } = render(
        <ResearchTerminal initialView="capm" initialTicker="AAPL" externalWindow={false} />
      );
      const capmRoot = container.querySelector(".terminal-primary-pane .stock-base-evidence") as HTMLElement;
      const capmForm = capmRoot.querySelector("form")!;

      await act(async () => {
        fireEvent.submit(capmForm);
      });

      const loadingBtn = within(capmRoot).getByRole("button", { name: /Loading/i }) as HTMLButtonElement;
      expect(loadingBtn.disabled).toBe(true);

      await act(async () => {
        resolveFetch({
          ok: true,
          json: async () => mockCapmSuccess,
        } as Response);
      });

      expect(capmRoot.querySelector("dl")).not.toBeNull();

      // Changing benchmark select resets previous analysis
      const benchmarkSelect = capmRoot.querySelector("select") as HTMLSelectElement;
      await act(async () => {
        fireEvent.change(benchmarkSelect, { target: { value: "xetra" } });
      });
      expect(capmRoot.querySelector("dl")).toBeNull();
    });
  });

  // ==========================================
  // Tier 4: Real-World Workflow
  // ==========================================
  describe("Tier 4: Real-World Workflow", () => {
    it("executes full institutional CAPM valuation workflow for European asset", async () => {
      const origFetch = global.fetch;
      vi.spyOn(global, "fetch").mockImplementation(async (url, init) => {
        if (String(url).includes("/api/terminal-capm")) {
          return {
            ok: true,
            json: async () => ({
              ticker: "SAP.DE",
              name: "SAP SE",
              benchmark: "^GDAXI",
              currency: "EUR",
              asOf: "2026-11-14",
              riskFree: 2.75,
              beta: 0.92,
              alpha: 0.038,
              r2: 0.54,
              volatility: 0.185,
              capmReturn: 0.098,
              sharpe: 0.46,
              observations: 250,
            }),
          } as Response;
        }
        return origFetch(url, init);
      });

      const { container } = render(
        <ResearchTerminal initialView="capm" initialTicker="SAP.DE" externalWindow={false} />
      );

      // Select German Xetra benchmark
      const marketSelect = container.querySelector(".stock-base-evidence select") as HTMLSelectElement;
      await act(async () => {
        fireEvent.change(marketSelect, { target: { value: "xetra" } });
      });

      // Set EUR risk-free rate 2.75%
      const rateInput = container.querySelector('input[type="number"]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(rateInput, { target: { value: "2.75" } });
      });

      // Calculate
      const capmForm = container.querySelector(".stock-base-evidence form")!;
      await act(async () => {
        fireEvent.submit(capmForm);
      });

      // Verify results
      expect(container.textContent).toContain("SAP SE vs ^GDAXI · 250 paired daily returns");
      const dlText = container.querySelector(".stock-base-evidence dl")?.textContent ?? "";
      expect(dlText).toContain("0.92");
      expect(dlText).toContain("3.80%");
      expect(dlText).toContain("0.540");
      expect(dlText).toContain("18.50%");
      expect(dlText).toContain("9.80%");
      expect(dlText).toContain("0.46");
    });
  });
});
