// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, within, cleanup } from "@testing-library/react";
import { AffenTerminalWindow } from "@/components/AffenTerminalWindow";
import { OpportunitiesHub } from "@/components/OpportunitiesHub";
import { useChartStore } from "@/stores/useChartStore";
import { useLinkStore } from "@/stores/useLinkStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

describe("AffenTerminalWindow Shell & Telemetry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    useChartStore.setState({ symbol: "YF:QCOM", timeframe: "1D" });
    useLinkStore.setState({ group: "red" });
    useWorkspaceStore.setState({ theme: "dark" });
    document.documentElement.dataset.theme = "dark";
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ==========================================
  // Tier 1: Feature Coverage (Happy Paths)
  // ==========================================
  describe("Tier 1: Feature Coverage", () => {
    it("retains completed groups when an opportunity scan fails and resumes the same page", async () => {
      let pageOneRequests = 0;
      const request = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
        const page = Number(new URL(String(input), "http://localhost").searchParams.get("page"));
        if (page === 1 && ++pageOneRequests === 1) return Response.json({ error: "Temporarily unavailable" }, { status: 503 });
        return Response.json({ market: "us", benchmark: "S&P 500", benchmarkSession: "2026-11-13", page, pages: 2,
          evaluated: page === 0 ? 24 : 8, universe: page === 0 ? 24 : 8, totalUniverse: 32,
          dataSources: [], opportunities: [], unavailable: [] });
      });
      render(<OpportunitiesHub />);
      await screen.findByText("Gruppe 1 von 2");
      fireEvent.click(screen.getByRole("button", { name: "Gesamtscan fortsetzen" }));
      expect((await screen.findByRole("alert")).textContent).toContain("Temporarily unavailable");
      expect(screen.getByText(/24\/32 Aktien ausgewertet/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Gesamtscan fortsetzen" }));
      await screen.findByText("Gruppe 2 von 2");
      expect(pageOneRequests).toBe(2);
      expect(request.mock.calls.some(([input]) => String(input).includes("/api/terminal-opportunities?market=us&page=1"))).toBe(true);
      expect(screen.getByText(/32\/32 Aktien ausgewertet/)).toBeTruthy();
      expect(request.mock.calls.filter(([input]) => String(input).includes("page=0"))).toHaveLength(1);
      request.mockRestore();
    });

    it("renders the terminal brand and linked symbol in the window header", () => {
      const { container } = render(<AffenTerminalWindow initialView="opps" initialTicker="QCOM" />);
      const brand = container.querySelector(".affen-brand-block")!;
      expect(brand.textContent).toContain("AffenTerminal");

      const sync = container.querySelector(".affen-sync-block")!;
      expect(sync.querySelector('[aria-label="Verknüpftes Symbol QCOM"]')?.textContent).toBe("QCOM");
      expect(screen.getByRole("main").querySelector(".research-terminal")).not.toBeNull();
    });

    it("displays live UTC formatted clock in header actions", () => {
      const { container } = render(<AffenTerminalWindow />);
      const clock = container.querySelector(".affen-header-actions span.mono.muted");
      expect(clock).not.toBeNull();
      expect(clock?.textContent).toContain("UTC");
    });

    it("renders window link color chips with accessible radio roles", () => {
      const { container } = render(<AffenTerminalWindow />);
      const radioGroup = container.querySelector('.link-groups[role="radiogroup"]')!;
      expect(radioGroup).not.toBeNull();

      const chips = within(radioGroup as HTMLElement).getAllByRole("radio");
      expect(chips.length).toBeGreaterThanOrEqual(5);

      // 'red' was set in beforeEach -> should have aria-checked="true"
      const redChip = chips.find((c) => c.className.includes("red"));
      expect(redChip?.getAttribute("aria-checked")).toBe("true");
    });

    it("renders theme toggle button reflecting current theme state", () => {
      const { container } = render(<AffenTerminalWindow />);
      const themeBtn = container.querySelector(".affen-header-actions button.button.small");
      expect(themeBtn).not.toBeNull();
      // When current theme is dark, button suggests switching to 'Light'
      expect(themeBtn?.getAttribute("aria-label")).toBe("Light");
    });
  });

  // ==========================================
  // Tier 2: Boundary & Corner Cases
  // ==========================================
  describe("Tier 2: Boundary & Corner Cases", () => {
    it("allows switching window link group to 'off' and updates store", async () => {
      const { container } = render(<AffenTerminalWindow />);
      const radioGroup = container.querySelector('.link-groups[role="radiogroup"]')!;
      const offChip = within(radioGroup as HTMLElement).getByRole("radio", { name: "Off" });

      await act(async () => {
        fireEvent.click(offChip);
      });

      expect(useLinkStore.getState().group).toBe("off");
      expect(offChip.getAttribute("aria-checked")).toBe("true");
    });

    it("switches between all link groups (green, blue, yellow, red) and persists to sessionStorage", async () => {
      const { container } = render(<AffenTerminalWindow />);
      const radioGroup = container.querySelector('.link-groups[role="radiogroup"]')!;
      const chips = within(radioGroup as HTMLElement).getAllByRole("radio");

      for (const color of ["green", "blue", "yellow", "red"] as const) {
        const chip = chips.find((c) => c.className.includes(color))!;
        expect(chip).toBeDefined();
        await act(async () => {
          fireEvent.click(chip);
        });
        expect(useLinkStore.getState().group).toBe(color);
        expect(chip.getAttribute("aria-checked")).toBe("true");
        expect(window.sessionStorage.getItem("affentrader-link-group")).toBe(color);
      }
    });

    it("focuses opener or opens chart workspace window when clicking Chart Workspace", async () => {
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      const { container } = render(<AffenTerminalWindow />);
      const chartBtn = within(container.querySelector(".affen-header-actions") as HTMLElement).getByRole("button", {
        name: /Chart Workspace/i,
      });

      await act(async () => {
        fireEvent.click(chartBtn);
      });
      expect(openSpy).toHaveBeenCalledWith("/", "affenterminal-chart");

      const focusSpy = vi.fn();
      const origOpener = window.opener;
      Object.defineProperty(window, "opener", { value: { closed: false, focus: focusSpy }, configurable: true });
      try {
        await act(async () => {
          fireEvent.click(chartBtn);
        });
        expect(focusSpy).toHaveBeenCalledTimes(1);
      } finally {
        Object.defineProperty(window, "opener", { value: origOpener, configurable: true });
      }
    });

    it("honors ?ticker= query parameter on external window mount", () => {
      const origUrl = window.location.href;
      window.history.replaceState({}, "", "/terminal?ticker=MSFT");
      try {
        render(<AffenTerminalWindow initialTicker="QCOM" />);
        expect(useChartStore.getState().symbol).toBe("YF:MSFT");
      } finally {
        window.history.replaceState({}, "", origUrl);
      }
    });

    it("handles macro feed failure gracefully without rendering ribbon or throwing", async () => {
      const origFetch = global.fetch;
      vi.spyOn(global, "fetch").mockImplementation(async (url, init) => {
        if (String(url).includes("/api/feeds?kind=macro")) {
          return { ok: false, status: 500 } as Response;
        }
        return origFetch(url, init);
      });

      const { container } = render(<AffenTerminalWindow />);
      // Should not render macro ribbon if offline
      expect(container.querySelector(".affen-macro-ribbon")).toBeNull();
    });
  });

  // ==========================================
  // Tier 3: Cross-Feature Integration
  // ==========================================
  describe("Tier 3: Cross-Feature Integration", () => {
    it("toggles theme between dark and light, updating html dataset and store", async () => {
      const { container } = render(<AffenTerminalWindow />);
      const themeBtn = container.querySelector(".affen-header-actions button.button.small")!;

      // Click to toggle to Light
      await act(async () => {
        fireEvent.click(themeBtn);
      });
      expect(useWorkspaceStore.getState().theme).toBe("light");
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(themeBtn.getAttribute("aria-label")).toBe("Dark");

      // Click to toggle back to Dark
      await act(async () => {
        fireEvent.click(themeBtn);
      });
      expect(useWorkspaceStore.getState().theme).toBe("dark");
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(themeBtn.getAttribute("aria-label")).toBe("Light");
    });

    it("updates document.title with terminal branding and active symbol label", async () => {
      render(<AffenTerminalWindow initialTicker="NVDA" />);

      await act(async () => {
        useChartStore.setState({ symbol: "YF:NVDA" });
      });

      expect(document.title).toContain("AffenTerminal · NVDA");
    });
  });

  // ==========================================
  // Tier 4: Real-World Workflow
  // ==========================================
  describe("Tier 4: Real-World Workflow", () => {
    it("renders macro pulse ribbon with cross-asset tickers and Fear & Greed index", async () => {
      const { container } = render(<AffenTerminalWindow />);

      // Wait for macro pulse ribbon to mount
      await act(async () => {
        await Promise.resolve();
      });

      const ribbon = container.querySelector(".affen-macro-ribbon");
      expect(ribbon).not.toBeNull();
      expect(ribbon?.textContent).toContain("PULSE");
      expect(ribbon?.textContent).toContain("S&P 500");
      expect(ribbon?.textContent).toContain("Bitcoin");
      expect(ribbon?.textContent).toContain("F&G: 72 (Greed)");
    });

    it("clicks macro pulse chip and updates chart store symbol to 1D timeframe", async () => {
      const { container } = render(<AffenTerminalWindow />);

      await act(async () => {
        await Promise.resolve();
      });

      const ribbon = container.querySelector(".affen-macro-ribbon")!;
      const chips = ribbon.querySelectorAll("button.chip");
      expect(chips.length).toBeGreaterThan(0);

      // Click the Bitcoin chip
      const btcChip = Array.from(chips).find((c) => c.textContent?.includes("Bitcoin"))!;
      expect(btcChip).toBeDefined();

      await act(async () => {
        fireEvent.click(btcChip);
      });

      expect(useChartStore.getState().symbol).toBe("BTCUSDT");
      expect(useChartStore.getState().timeframe).toBe("1D");
    });
  });
});
