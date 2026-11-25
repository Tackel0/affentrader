// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, fireEvent, cleanup, screen, waitFor, within } from "@testing-library/react";
import { AlertsPanel, AlertDialog } from "@/components/Alerts";
import { Modal } from "@/components/ui";
import { ScreenerPanel } from "@/components/ScreenerPanel";
import { CalendarPanel } from "@/components/CalendarPanel";
import { SymbolSearch } from "@/components/SymbolSearch";
import { Watchlist } from "@/components/Watchlist";
import { useAlertStore } from "@/stores/useAlertStore";
import { useChartStore } from "@/stores/useChartStore";
import { useScreenerStore } from "@/stores/useScreenerStore";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import { coalesceInFlight, setBoundedCache } from "@/lib/server/cache";
import { clearFeedCache, feedCacheSize, fetchEarnings } from "@/lib/server/feeds";

describe("Platform Audit Improvements (UX, Performance, A11y, Caching)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    clearFeedCache();
  });

  describe("Alerts: sub-$1 price typing & filtered empty state", () => {
    it("allows typing sub-$1 decimal trigger prices like 0.15 without clearing the input", () => {
      useChartStore.setState({
        symbol: "DOGEUSDT",
        alertDraft: { symbol: "DOGEUSDT", price: 0, source: "manual" },
      });
      render(<AlertDialog />);
      const input = screen.getByLabelText("Trigger price") as HTMLInputElement;
      expect(input.value).toBe("");

      fireEvent.change(input, { target: { value: "0" } });
      expect(input.value).toBe("0");

      fireEvent.change(input, { target: { value: "0." } });
      expect(input.value).toBe("0.");

      fireEvent.change(input, { target: { value: "0.15" } });
      expect(input.value).toBe("0.15");
    });

    it("shows a filtered empty state with Show all alerts button when a status filter hides all alerts", () => {
      useAlertStore.setState({
        alerts: [
          {
            id: "a1",
            name: "BTC active",
            symbol: "BTCUSDT",
            condition: "crossing_up",
            price: 100000,
            status: "active",
            repeat: false,
            frequency: "tick",
            timeframe: "15m",
            sound: true,
            browserNotification: false,
            simulated: false,
            createdAt: Date.now(),
          },
        ],
        rules: [],
        logs: [],
        events: [],
      });

      render(<AlertsPanel />);
      expect(screen.getByText("BTC active")).toBeTruthy();

      const filterSelect = screen.getByLabelText("Filter alerts") as HTMLSelectElement;
      fireEvent.change(filterSelect, { target: { value: "paused" } });

      expect(screen.getByText("No paused alerts.")).toBeTruthy();
      const resetBtn = screen.getByRole("button", { name: "Show all alerts" });
      fireEvent.click(resetBtn);

      expect(screen.getByText("BTC active")).toBeTruthy();
    });
  });

  describe("Modal focus trap & safe focus restoration", () => {
    it("traps Tab across links and buttons and handles disconnected trigger elements safely on unmount", () => {
      const trigger = document.createElement("button");
      trigger.textContent = "Launch";
      document.body.appendChild(trigger);
      trigger.focus();

      const onClose = vi.fn();
      const { unmount } = render(
        <Modal title="Focus test" onClose={onClose}>
          <a href="https://example.com">Docs</a>
          <button type="button">Confirm</button>
        </Modal>,
      );

      const closeBtn = screen.getByRole("button", { name: "Close dialog" });
      const confirmBtn = screen.getByRole("button", { name: "Confirm" });
      confirmBtn.focus();
      expect(document.activeElement).toBe(confirmBtn);

      fireEvent.keyDown(document, { key: "Tab" });
      expect(document.activeElement).toBe(closeBtn);

      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(confirmBtn);

      // Remove original trigger before unmounting modal — should not throw or focus detached node
      trigger.remove();
      expect(() => unmount()).not.toThrow();
    });
  });

  describe("ScreenerPanel: saved preset load vs delete & Hotlist retry", () => {
    it("loads a saved preset when clicking its name and only deletes it when clicking the explicit delete button", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({ rows: [], timeframe: "1h", universe: 0, generatedAt: Date.now(), failed: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      useScreenerStore.setState({
        timeframe: "15m",
        filters: [],
        presets: [
          {
            id: "p-rsi",
            name: "Oversold RSI",
            timeframe: "4h",
            filters: [{ id: "f1", field: "rsi", op: "<", value: 30 }],
          },
        ],
      });

      render(<ScreenerPanel />);
      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

      const loadBtn = screen.getByRole("button", { name: "★ Oversold RSI" });
      fireEvent.click(loadBtn);

      // Clicking the preset name loads it and preserves it in presets
      expect(useScreenerStore.getState().timeframe).toBe("4h");
      expect(useScreenerStore.getState().presets).toHaveLength(1);

      const deleteBtn = screen.getByRole("button", { name: "Delete preset Oversold RSI" });
      fireEvent.click(deleteBtn);
      expect(useScreenerStore.getState().presets).toHaveLength(0);
    });

    it("clears the Hotlist error banner after a successful Retry", async () => {
      let attempt = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        attempt++;
        if (attempt <= 2) {
          return new Response(JSON.stringify({ error: "Upstream down" }), { status: 503 });
        }
        return new Response(
          JSON.stringify({
            rows: [
              {
                symbol: "BTCUSDT",
                price: 95000,
                change24h: 4.2,
                quoteVolume: 1_500_000_000,
                volume: 15_000,
                trades: 500_000,
                high24h: 96000,
                low24h: 90000,
                rangePosition: 83,
              },
            ],
            timeframe: null,
            universe: 1,
            generatedAt: Date.now(),
            failed: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });

      render(<ScreenerPanel />);
      fireEvent.click(screen.getByRole("button", { name: "Hotlists" }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("Upstream down");

      const retryBtn = within(alert).getByRole("button", { name: "Retry" });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.queryByRole("alert")).toBeNull();
      });
    });
  });

  describe("CalendarPanel: retry & clickable corporate tickers", () => {
    it("recovers from feed error via Retry and opens ticker chart when clicking an earnings symbol", async () => {
      let earningsAttempts = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("kind=earnings")) {
          earningsAttempts++;
          if (earningsAttempts === 1) {
            return new Response(JSON.stringify({ error: "Nasdaq timeout" }), { status: 503 });
          }
          return new Response(
            JSON.stringify({
              events: [
                {
                  symbol: "NVDA",
                  name: "NVIDIA Corp",
                  time: "after-close",
                  epsForecast: "0.85",
                  lastYearEps: "0.60",
                  marketCap: "3T",
                  fiscalQuarter: "Q4",
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      });

      render(<CalendarPanel />);
      fireEvent.click(screen.getByRole("tab", { name: "Earnings" }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("Nasdaq timeout");

      fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));

      const nvdaBtn = await screen.findByRole("button", { name: "NVDA" });
      fireEvent.click(nvdaBtn);
      expect(useChartStore.getState().symbol).toBe("YF:NVDA");
    });
  });

  describe("SymbolSearch: keyboard navigation & clear button", () => {
    it("supports ArrowDown/ArrowUp selection and clears search query via clear button", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ symbols: [] }), { status: 200 }),
      );
      useChartStore.setState({ searchOpen: true, searchTarget: "chart", symbol: "BTCUSDT" });

      render(<SymbolSearch />);
      const input = screen.getByLabelText("Search symbols") as HTMLInputElement;

      const results = document.querySelectorAll<HTMLButtonElement>(".symbol-result");
      expect(results.length).toBeGreaterThan(1);
      expect(results[0].className).toContain("highlighted");

      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(results[1].className).toContain("highlighted");

      fireEvent.change(input, { target: { value: "ETH" } });
      expect(input.value).toBe("ETH");

      const clearBtn = screen.getByRole("button", { name: "Clear search" });
      fireEvent.click(clearBtn);
      expect(input.value).toBe("");
    });
  });

  describe("Watchlist: dropdown dismiss & 2-step destructive confirmation", () => {
    it("requires a second click to confirm Clear list and dismisses switcher menu on Escape", () => {
      useWatchlistStore.setState({
        activeId: "l1",
        lists: [
          { id: "l1", name: "Main", symbols: ["BTCUSDT", "ETHUSDT"], flags: {} },
          { id: "l2", name: "Alt", symbols: ["SOLUSDT"], flags: {} },
        ],
      });

      render(<Watchlist />);

      // Switcher dropdown closes on Escape
      const switcher = screen.getByRole("button", { name: /Main/i });
      fireEvent.click(switcher);
      expect(switcher.getAttribute("aria-expanded")).toBe("true");
      fireEvent.keyDown(document, { key: "Escape" });
      expect(switcher.getAttribute("aria-expanded")).toBe("false");

      // ListMenu requires 2 clicks for Clear list
      fireEvent.click(screen.getByRole("button", { name: "Watchlist options" }));
      const clearBtn = screen.getByRole("button", { name: "Clear list" });
      fireEvent.click(clearBtn);
      expect(useWatchlistStore.getState().lists[0].symbols).toHaveLength(2);

      const confirmClearBtn = screen.getByRole("button", { name: "Confirm clear?" });
      fireEvent.click(confirmClearBtn);
      expect(useWatchlistStore.getState().lists[0].symbols).toHaveLength(0);
    });
  });

  describe("Server cache: bounded LRU & in-flight coalescing", () => {
    it("deduplicates concurrent loads via coalesceInFlight and bounds feeds cache to 150 entries", async () => {
      const inflight = new Map<string, Promise<number>>();
      let calls = 0;
      const loader = async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 10));
        return 42;
      };
      const [a, b, c] = await Promise.all([
        coalesceInFlight(inflight, "k1", loader),
        coalesceInFlight(inflight, "k1", loader),
        coalesceInFlight(inflight, "k1", loader),
      ]);
      expect([a, b, c]).toEqual([42, 42, 42]);
      expect(calls).toBe(1);
      expect(inflight.size).toBe(0);

      // Verify setBoundedCache LRU cap
      const map = new Map<string, number>();
      for (let i = 0; i < 10; i++) setBoundedCache(map, `k${i}`, i, 5);
      expect(map.size).toBe(5);
      expect([...map.keys()]).toEqual(["k5", "k6", "k7", "k8", "k9"]);

      // Verify fetchEarnings bounds feed cache at 150 entries
      clearFeedCache();
      const mockFetch = vi.fn(async () => new Response(JSON.stringify({ data: { rows: [] } }), { status: 200 }));
      for (let i = 0; i < 160; i++) {
        const d = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
        await fetchEarnings(d, mockFetch as unknown as typeof fetch);
      }
      expect(feedCacheSize()).toBe(150);
    });
  });
});
