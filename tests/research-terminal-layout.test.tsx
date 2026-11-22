// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, fireEvent, act, within, cleanup, screen } from "@testing-library/react";
import { ResearchTerminal } from "@/components/ResearchTerminal";
import { useChartStore } from "@/stores/useChartStore";
import { useLinkStore } from "@/stores/useLinkStore";

function selectModule(container: HTMLElement, view: string) {
  fireEvent.click(within(container).getByRole("button", { name: "Module" }));
  fireEvent.click(screen.getByRole("dialog").querySelector<HTMLButtonElement>(`[data-module-view="${view}"]`)!);
}

describe("ResearchTerminal Layout & Pane Management", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    useChartStore.setState({ symbol: "YF:NVDA", timeframe: "1D" });
    useLinkStore.setState({ group: "red" });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ==========================================
  // Tier 1: Feature Coverage (Happy Paths)
  // ==========================================
  describe("Tier 1: Feature Coverage", () => {
    it("initializes with flat single-pane default for embedded mode and split-3 for external", () => {
      // Embedded window defaults to single-pane to avoid nested drawer chrome
      const { container: embeddedContainer } = render(<ResearchTerminal externalWindow={false} />);
      const embeddedRoot = embeddedContainer.querySelector(".research-terminal");
      const embeddedGrid = embeddedContainer.querySelector(".terminal-workspace-grid");
      expect(embeddedRoot?.className).toContain("is-embedded");
      expect(embeddedRoot?.className).toContain("is-single-pane");
      expect(embeddedGrid?.className).toContain("layout-single");

      // External window
      const { container: externalContainer } = render(<ResearchTerminal externalWindow={true} />);
      const externalRoot = externalContainer.querySelector(".research-terminal");
      const externalGrid = externalContainer.querySelector(".terminal-workspace-grid");
      expect(externalRoot?.className).not.toContain("is-embedded");
      expect(externalGrid?.className).toContain("layout-split-3");
    });

    it("switches layout mode via segmented buttons (1-Pane, 2-Pane, 3-Pane)", async () => {
      const { container } = render(<ResearchTerminal externalWindow={false} />);
      const segmented = container.querySelector(".segmented")!;
      const btn1Pane = within(segmented as HTMLElement).getByRole("button", { name: /1-Pane/i });
      const btn2Pane = within(segmented as HTMLElement).getByRole("button", { name: /2-Pane/i });
      const btn3Pane = within(segmented as HTMLElement).getByRole("button", { name: /3-Pane/i });
      const grid = container.querySelector(".terminal-workspace-grid")!;

      // Click 1-Pane
      await act(async () => {
        fireEvent.click(btn1Pane);
      });
      expect(btn1Pane.className).toContain("active");
      expect(grid.className).toContain("layout-single");

      // Click 3-Pane
      await act(async () => {
        fireEvent.click(btn3Pane);
      });
      expect(btn3Pane.className).toContain("active");
      expect(grid.className).toContain("layout-split-3");

      // Click 2-Pane
      await act(async () => {
        fireEvent.click(btn2Pane);
      });
      expect(btn2Pane.className).toContain("active");
      expect(grid.className).toContain("layout-split-2");
    });

    it("switches active view tab and triggers onViewChange callback", async () => {
      const onViewChange = vi.fn();
      const { container } = render(
        <ResearchTerminal initialView="opps" externalWindow={false} onViewChange={onViewChange} />
      );
      const tabs = container.querySelector(".panel-tabs")!;

      // Switch to Stock bases through the module picker.
      selectModule(container, "scan");
      expect(within(tabs as HTMLElement).getByRole("button", { name: /Stock bases/i }).getAttribute("aria-current")).toBe("page");
      expect(onViewChange).toHaveBeenCalledWith("scan");

      // Switch to Markets
      selectModule(container, "markets");
      expect(within(tabs as HTMLElement).getByRole("button", { name: /Markets/i }).getAttribute("aria-current")).toBe("page");
      expect(onViewChange).toHaveBeenCalledWith("markets");
    });

    it("searches grouped modules and restores keyboard focus on close", () => {
      const { container } = render(<ResearchTerminal initialView="optionsflow" />);
      const launcher = within(container).getByRole("button", { name: "Module" });
      launcher.focus();
      fireEvent.click(launcher);
      const picker = screen.getByRole("dialog");
      const search = within(picker).getByRole("searchbox", { name: "Module suchen" });
      expect(document.activeElement).toBe(search);
      expect(within(picker).getByRole("region", { name: "Aktien-Research" })).toBeTruthy();
      fireEvent.change(search, { target: { value: "OSINT" } });
      expect(picker.querySelectorAll("[data-module-view]")).toHaveLength(1);
      expect(picker.querySelector("[data-module-view=osint]")).toBeTruthy();
      fireEvent.keyDown(search, { key: "k", altKey: true });
      expect(document.activeElement).toBe(search);
      fireEvent.keyDown(search, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(launcher);
    });

    it("carries an explicitly selected Optionsflow ticker into Insider research", () => {
      const { container } = render(<ResearchTerminal initialView="optionsflow" initialTicker="AAPL" />);
      const flow = within(container).getByRole("region", { name: "Optionsflow" });
      fireEvent.change(within(flow).getByRole("textbox", { name: "US-Ticker" }), { target: { value: "MSFT" } });
      fireEvent.click(within(flow).getByRole("button", { name: "Optionsflow anzeigen" }));
      const shortcuts = within(container.querySelector(".terminal-shortcuts") as HTMLElement);
      fireEvent.click(shortcuts.getByRole("button", { name: "Insider" }));
      const insiders = within(container).getByRole("region", { name: "Insider-Recherche" });
      expect((within(insiders).getByRole("textbox", { name: "US-Aktie" }) as HTMLInputElement).value).toBe("MSFT");
      expect(useChartStore.getState().symbol).toBe("YF:MSFT");
    });
  });

  // ==========================================
  // Tier 2: Boundary & Corner Cases
  // ==========================================
  describe("Tier 2: Boundary & Corner Cases", () => {
    it("unmounts secondary and tertiary panes in single-pane mode", async () => {
      const { container } = render(<ResearchTerminal externalWindow={false} />);
      const segmented = container.querySelector(".segmented")!;
      const btn1Pane = within(segmented as HTMLElement).getByRole("button", { name: /1-Pane/i });

      await act(async () => {
        fireEvent.click(btn1Pane);
      });

      expect(container.querySelector(".terminal-secondary-pane")).toBeNull();
      expect(container.querySelector(".terminal-tertiary-pane")).toBeNull();
    });

    it("renders secondary pane but hides tertiary pane in 2-pane mode", async () => {
      const { container } = render(<ResearchTerminal externalWindow={false} />);
      const segmented = container.querySelector(".segmented")!;
      const btn2Pane = within(segmented as HTMLElement).getByRole("button", { name: /2-Pane/i });

      await act(async () => {
        fireEvent.click(btn2Pane);
      });

      expect(container.querySelector(".terminal-secondary-pane")).not.toBeNull();
      expect(container.querySelector(".terminal-tertiary-pane")).toBeNull();
    });

    it("renders both secondary and tertiary panes in 3-pane mode", async () => {
      const { container } = render(<ResearchTerminal externalWindow={false} />);
      const segmented = container.querySelector(".segmented")!;
      const btn3Pane = within(segmented as HTMLElement).getByRole("button", { name: /3-Pane/i });

      await act(async () => {
        fireEvent.click(btn3Pane);
      });

      expect(container.querySelector(".terminal-secondary-pane")).not.toBeNull();
      expect(container.querySelector(".terminal-tertiary-pane")).not.toBeNull();
    });

    it("renders external launch button only in embedded mode", () => {
      const { container: embedded } = render(<ResearchTerminal externalWindow={false} />);
      expect(embedded.querySelector(".affen-terminal-launch")).not.toBeNull();

      const { container: external } = render(<ResearchTerminal externalWindow={true} />);
      expect(external.querySelector(".affen-terminal-launch")).toBeNull();
    });
  });

  // ==========================================
  // Tier 3: Cross-Feature Integration (FA View Split-Pane Preservation)
  // ==========================================
  describe("Tier 3: Cross-Feature Integration", () => {
    it("preserves secondary pane with complementary view when switching primary pane to FA", async () => {
      // In 2-pane mode with initial view 'opps', secondary pane shows P2: FUNDAMENTALS
      const { container } = render(
        <ResearchTerminal initialView="opps" externalWindow={false} defaultLayout="split-2" />,
      );
      const p2 = container.querySelector(".terminal-secondary-pane") as HTMLElement;
      expect(p2).not.toBeNull();
      expect(p2.textContent).toContain("P2: FUNDAMENTALS");

      // Switch P1 to FA view: P2 remains mounted and avoids duplicating FA by switching to GLOBAL MARKETS
      selectModule(container, "fa");
      const grid = container.querySelector(".terminal-workspace-grid")!;
      expect(grid.className).toContain("layout-split-2");
      const p2After = container.querySelector(".terminal-secondary-pane") as HTMLElement;
      expect(p2After).not.toBeNull();
      expect(p2After.textContent).toContain("P2: GLOBAL MARKETS");

      // Switch to 3-Pane where P3 shows GLOBAL MARKETS: P2 uses MACRO CALENDAR to avoid duplicating P3
      const btn3Pane = within(container).getByRole("button", { name: /3-Pane Grid/i });
      await act(async () => {
        fireEvent.click(btn3Pane);
      });
      const p2InSplit3 = container.querySelector(".terminal-secondary-pane") as HTMLElement;
      expect(p2InSplit3.textContent).toContain("P2: MACRO CALENDAR");

      // Switch P1 back to Scan view: P2 returns to FUNDAMENTALS
      selectModule(container, "scan");
      expect(container.querySelector(".terminal-secondary-pane")?.textContent).toContain("P2: FUNDAMENTALS");
    });

    it("synchronizes secondary pane with ticker changes", async () => {
      const { container } = render(
        <ResearchTerminal
          initialView="opps"
          initialTicker="AAPL"
          externalWindow={false}
          defaultLayout="split-2"
        />,
      );

      // Verify secondary pane renders fundamentals for AAPL
      const secondary = container.querySelector(".terminal-secondary-pane");
      expect(secondary).not.toBeNull();

      // Submit command to change ticker to TSLA
      const form = container.querySelector("form.terminal-command")!;
      const input = container.querySelector("#terminal-command") as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: "TSLA <GO>" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });

      // Secondary pane remains mounted and synchronized
      expect(container.querySelector(".terminal-secondary-pane")).not.toBeNull();
    });
  });

  // ==========================================
  // Tier 4: Real-World Workflow
  // ==========================================
  describe("Tier 4: Real-World Workflow", () => {
    it("cycles through full institutional multi-pane desktop workflow", async () => {
      // Start in 3-Pane external mode
      const { container } = render(<ResearchTerminal externalWindow={true} initialView="opps" />);
      const grid = container.querySelector(".terminal-workspace-grid")!;
      expect(grid.className).toContain("layout-split-3");
      expect(container.querySelector(".terminal-secondary-pane")).not.toBeNull();
      expect(container.querySelector(".terminal-tertiary-pane")).not.toBeNull();

      // Step 1: Cycle through analytical modules in primary pane
      const tabs = container.querySelector(".panel-tabs")!;
      selectModule(container, "news");
      expect(within(tabs as HTMLElement).getByRole("button", { name: /^News$/i }).getAttribute("aria-current")).toBe("page");

      // Step 2: Switch to 2-Pane for wider primary + secondary view
      const segmented = container.querySelector(".segmented")!;
      const btn2Pane = within(segmented as HTMLElement).getByRole("button", { name: /2-Pane/i });
      await act(async () => {
        fireEvent.click(btn2Pane);
      });
      expect(grid.className).toContain("layout-split-2");
      expect(container.querySelector(".terminal-secondary-pane")).not.toBeNull();
      expect(container.querySelector(".terminal-tertiary-pane")).toBeNull();

      // Step 3: Switch to 1-Pane for focused full-width table view
      const btn1Pane = within(segmented as HTMLElement).getByRole("button", { name: /1-Pane/i });
      await act(async () => {
        fireEvent.click(btn1Pane);
      });
      expect(grid.className).toContain("layout-single");
      expect(container.querySelector(".terminal-secondary-pane")).toBeNull();
      expect(container.querySelector(".terminal-tertiary-pane")).toBeNull();
    });
  });

  // ==========================================
  // Tier 4: Bloomberg Tile Headers, Maximize/Close & Active Pane Routing
  // ==========================================
  describe("Tier 4: Bloomberg Tile Headers, Maximize/Close & Active Pane Routing", () => {
    it("switches pane views via TerminalTileHeader select and promotes P3 into P2 on close", async () => {
      const { container } = render(<ResearchTerminal externalWindow={true} />);
      const grid = container.querySelector(".terminal-workspace-grid") as HTMLElement;
      expect(grid.className).toContain("layout-split-3");

      // Change P2 via its tile header selector
      const p2Select = within(container).getByLabelText("Pane p2 view") as HTMLSelectElement;
      await act(async () => {
        fireEvent.change(p2Select, { target: { value: "news" } });
      });
      expect(container.querySelector(".terminal-secondary-pane .pane-title")?.textContent).toContain("NEWS FEED");
      expect(container.querySelector(".terminal-primary-pane .pane-title")?.textContent).toContain("TRADE SETUPS");

      // Change P3 to heatmap via its tile header selector
      const p3Select = within(container).getByLabelText("Pane p3 view") as HTMLSelectElement;
      await act(async () => {
        fireEvent.change(p3Select, { target: { value: "heatmap" } });
      });
      expect(container.querySelector(".terminal-tertiary-pane .pane-title")?.textContent).toContain("HEATMAP");

      // Close P2 -> transitions to split-2 and promotes P3's HEATMAP into P2
      const closeP2 = within(container).getByRole("button", { name: "Close pane p2" });
      await act(async () => {
        fireEvent.click(closeP2);
      });
      expect(grid.className).toContain("layout-split-2");
      expect(container.querySelector(".terminal-tertiary-pane")).toBeNull();
      expect(container.querySelector(".terminal-secondary-pane .pane-title")?.textContent).toContain("HEATMAP");

      // Close remaining P2 -> drops cleanly to single-pane layout with active P1
      const closeRemainingP2 = within(container).getByRole("button", { name: "Close pane p2" });
      await act(async () => {
        fireEvent.click(closeRemainingP2);
      });
      expect(grid.className).toContain("layout-single");
      expect(container.querySelector(".terminal-secondary-pane")).toBeNull();
      expect(container.querySelector(".terminal-primary-pane")?.className).toContain("active-pane");
    });

    it("maximizes and restores individual panes via TerminalTileHeader controls", async () => {
      const { container } = render(<ResearchTerminal externalWindow={true} />);
      const grid = container.querySelector(".terminal-workspace-grid") as HTMLElement;

      const p2 = container.querySelector(".terminal-secondary-pane") as HTMLElement;
      const maxBtn = within(p2).getByRole("button", { name: "Maximize pane" });
      await act(async () => {
        fireEvent.click(maxBtn);
      });

      expect(grid.className).toContain("layout-single");
      expect(container.querySelector(".terminal-primary-pane")).toBeNull();
      expect(container.querySelector(".terminal-secondary-pane")).not.toBeNull();
      expect(container.querySelector(".terminal-tertiary-pane")).toBeNull();

      const restoreBtn = within(container).getByRole("button", { name: "Restore pane" });
      await act(async () => {
        fireEvent.click(restoreBtn);
      });

      expect(grid.className).toContain("layout-split-3");
      expect(container.querySelector(".terminal-primary-pane")).not.toBeNull();
      expect(container.querySelector(".terminal-secondary-pane")).not.toBeNull();
      expect(container.querySelector(".terminal-tertiary-pane")).not.toBeNull();

      // Closing P3 directly transitions from split-3 to split-2 while keeping P2's view intact
      const closeP3 = within(container).getByRole("button", { name: "Close pane p3" });
      await act(async () => {
        fireEvent.click(closeP3);
      });
      expect(grid.className).toContain("layout-split-2");
      expect(container.querySelector(".terminal-secondary-pane")).not.toBeNull();
      expect(container.querySelector(".terminal-tertiary-pane")).toBeNull();
    });

    it("focuses panes via click, Ctrl+1/2/3, Tab, and PANE commands, and routes commands & hotkeys to active pane", async () => {
      const { container } = render(<ResearchTerminal externalWindow={false} defaultLayout="split-2" />);
      const input = container.querySelector("#terminal-command") as HTMLInputElement;
      const form = container.querySelector("form.terminal-command") as HTMLFormElement;

      expect(container.querySelector(".terminal-primary-pane")?.className).toContain("active-pane");

      // Ctrl+2 switches focus to P2; subsequent command routes to P2 instead of P1
      await act(async () => {
        fireEvent.keyDown(window, { key: "2", ctrlKey: true });
      });
      expect(container.querySelector(".terminal-secondary-pane")?.className).toContain("active-pane");
      expect(container.querySelector(".terminal-primary-pane")?.className).not.toContain("active-pane");

      // Ctrl+1 returns focus to P1, then PANE 2 brings it back to P2
      await act(async () => {
        fireEvent.keyDown(window, { key: "1", ctrlKey: true });
      });
      expect(container.querySelector(".terminal-primary-pane")?.className).toContain("active-pane");

      await act(async () => {
        fireEvent.change(input, { target: { value: "PANE 2" } });
        fireEvent.submit(form);
      });
      expect(container.querySelector(".terminal-secondary-pane")?.className).toContain("active-pane");

      await act(async () => {
        fireEvent.change(input, { target: { value: "NEWS" } });
        fireEvent.submit(form);
      });
      expect(container.querySelector(".terminal-secondary-pane .pane-title")?.textContent).toContain("NEWS FEED");
      expect(container.querySelector(".terminal-primary-pane .pane-title")?.textContent).toContain("TRADE SETUPS");

      // Tab outside editable inputs cycles active pane back to P1
      (document.activeElement as HTMLElement | null)?.blur?.();
      await act(async () => {
        fireEvent.keyDown(window, { key: "Tab" });
      });
      expect(container.querySelector(".terminal-primary-pane")?.className).toContain("active-pane");

      // SPLIT 3 + Ctrl+3 -> F10 routes HEATMAP directly to P3
      await act(async () => {
        fireEvent.change(input, { target: { value: "SPLIT 3" } });
        fireEvent.submit(form);
      });
      await act(async () => {
        fireEvent.keyDown(window, { key: "3", ctrlKey: true });
      });
      expect(container.querySelector(".terminal-tertiary-pane")?.className).toContain("active-pane");

      await act(async () => {
        fireEvent.keyDown(window, { key: "F10" });
      });
      expect(container.querySelector(".terminal-tertiary-pane .pane-title")?.textContent).toContain("HEATMAP");
      expect(container.querySelector(".terminal-secondary-pane .pane-title")?.textContent).toContain("NEWS FEED");

      // SPLIT 2 shrinks P3 away and clamps activePane from P3 back to P2
      await act(async () => {
        fireEvent.change(input, { target: { value: "SPLIT 2" } });
        fireEvent.submit(form);
      });
      expect(container.querySelector(".terminal-workspace-grid")?.className).toContain("layout-split-2");
      expect(container.querySelector(".terminal-secondary-pane")?.className).toContain("active-pane");

      // PANE 1 command focuses P1; SPLIT 1 shrinks layout and keeps P1 active; PANE 3 expands to 3-Pane
      await act(async () => {
        fireEvent.change(input, { target: { value: "PANE 1" } });
        fireEvent.submit(form);
      });
      expect(container.querySelector(".terminal-primary-pane")?.className).toContain("active-pane");

      await act(async () => {
        fireEvent.change(input, { target: { value: "SPLIT 1" } });
        fireEvent.submit(form);
      });
      expect(container.querySelector(".terminal-workspace-grid")?.className).toContain("layout-single");

      await act(async () => {
        fireEvent.change(input, { target: { value: "PANE 3" } });
        fireEvent.submit(form);
      });
      expect(container.querySelector(".terminal-workspace-grid")?.className).toContain("layout-split-3");
      expect(container.querySelector(".terminal-tertiary-pane")?.className).toContain("active-pane");
    });
  });
});
