// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, fireEvent, act, within, cleanup } from "@testing-library/react";
import { ResearchTerminal } from "@/components/ResearchTerminal";
import { parseTerminalCommand } from "@/lib/terminal/commands";
import { resolveOrderExecution } from "@/lib/terminal/orders";
import { useChartStore } from "@/stores/useChartStore";
import { useLinkStore } from "@/stores/useLinkStore";
import { usePaperStore, DEFAULT_TICKET } from "@/stores/usePaperStore";

describe("ResearchTerminal Command Bar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    useChartStore.setState({ symbol: "YF:AAPL", timeframe: "1D" });
    useLinkStore.setState({ group: "red" });
    usePaperStore.setState({ ticket: { ...DEFAULT_TICKET } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ==========================================
  // Tier 1: Feature Coverage (Happy Paths)
  // ==========================================
  describe("Tier 1: Feature Coverage", () => {
    it("renders the Bloomberg command bar input and <GO> button", () => {
      const { container } = render(<ResearchTerminal externalWindow={false} />);
      const form = container.querySelector("form.terminal-command")!;
      const input = container.querySelector("#terminal-command") as HTMLInputElement;
      expect(input).toBeDefined();
      expect(input.placeholder).toContain("<GO>");

      const goButton = within(form as HTMLElement).getByRole("button", { name: /<GO>/i });
      expect(goButton).toBeDefined();
    });

    it("executes single-token view command (FA) via Enter key", async () => {
      const onViewChange = vi.fn();
      const { container } = render(<ResearchTerminal externalWindow={false} onViewChange={onViewChange} />);
      const form = container.querySelector("form.terminal-command")!;
      const input = container.querySelector("#terminal-command") as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: "FA" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });

      expect(onViewChange).toHaveBeenCalledWith("fa");
    });

    it("executes single-token view command (OPPS) via <GO> button click", async () => {
      const onViewChange = vi.fn();
      const { container } = render(
        <ResearchTerminal initialView="fa" externalWindow={false} onViewChange={onViewChange} />
      );
      const form = container.querySelector("form.terminal-command")!;
      const input = container.querySelector("#terminal-command") as HTMLInputElement;
      const goButton = within(form as HTMLElement).getByRole("button", { name: /<GO>/i });

      await act(async () => {
        fireEvent.change(input, { target: { value: "OPPS" } });
      });
      await act(async () => {
        fireEvent.click(goButton);
      });

      expect(onViewChange).toHaveBeenCalledWith("opps");
    });

    it("executes two-token command (NVDA FA) synchronizing view and ticker", async () => {
      const onSelectSymbol = vi.fn();
      const onViewChange = vi.fn();
      const { container } = render(
        <ResearchTerminal
          externalWindow={false}
          onSelectSymbol={onSelectSymbol}
          onViewChange={onViewChange}
        />
      );
      const form = container.querySelector("form.terminal-command")!;
      const input = container.querySelector("#terminal-command") as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: "NVDA FA" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });

      expect(onViewChange).toHaveBeenCalledWith("fa");
      expect(onSelectSymbol).toHaveBeenCalledWith("YF:NVDA");
    });

    it("executes chart command (MSFT <GO>) and updates chart store", async () => {
      const onSelectSymbol = vi.fn();
      const { container } = render(<ResearchTerminal externalWindow={false} onSelectSymbol={onSelectSymbol} />);
      const form = container.querySelector("form.terminal-command")!;
      const input = container.querySelector("#terminal-command") as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: "MSFT <GO>" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });

      expect(onSelectSymbol).toHaveBeenCalledWith("YF:MSFT");
      const statusMsg = container.querySelector("p.form-help[role='status']");
      expect(statusMsg?.textContent).toContain("MSFT");
    });
  });

  // ==========================================
  // Tier 2: Boundary & Corner Cases
  // ==========================================
  describe("Tier 2: Boundary & Corner Cases", () => {
    it("safely ignores empty or whitespace-only command submission", async () => {
      const onViewChange = vi.fn();
      const { container } = render(
        <ResearchTerminal initialView="opps" externalWindow={false} onViewChange={onViewChange} />
      );
      const form = container.querySelector("form.terminal-command")!;
      const input = container.querySelector("#terminal-command") as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: "    " } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });

      // Terminal status message should remain absent
      const statusMsg = container.querySelector("p.form-help[role='status']");
      expect(statusMsg).toBeNull();
    });

    it("displays informative unknown command error on unrecognized inputs", async () => {
      const { container } = render(<ResearchTerminal externalWindow={false} />);
      const form = container.querySelector("form.terminal-command")!;
      const input = container.querySelector("#terminal-command") as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: "XYZUNKNOWN 123" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });

      const statusMsg = container.querySelector("p.form-help[role='status']");
      expect(statusMsg?.textContent).toContain("Unknown command");
      expect(statusMsg?.textContent).toContain("HELP");
    });

    it("rejects invalid ticker characters (e.g. $$$ FA)", async () => {
      const { container } = render(<ResearchTerminal externalWindow={false} />);
      const form = container.querySelector("form.terminal-command")!;
      const input = container.querySelector("#terminal-command") as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: "$$$ FA" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });

      const statusMsg = container.querySelector("p.form-help[role='status']");
      expect(statusMsg?.textContent).toContain("Unknown command");
    });

    it("focuses and selects command input on Alt+K global shortcut", () => {
      const { container } = render(<ResearchTerminal externalWindow={false} />);
      const input = container.querySelector("#terminal-command") as HTMLInputElement;

      const focusSpy = vi.spyOn(input, "focus");
      const selectSpy = vi.spyOn(input, "select");

      fireEvent.keyDown(window, { key: "k", altKey: true });

      expect(focusSpy).toHaveBeenCalled();
      expect(selectSpy).toHaveBeenCalled();
    });

    it("traverses command history with ArrowUp and ArrowDown, clamping boundaries", async () => {
      const { container } = render(<ResearchTerminal externalWindow={false} />);
      const form = container.querySelector("form.terminal-command")!;
      const input = container.querySelector("#terminal-command") as HTMLInputElement;

      // Submit command 1: NEWS
      await act(async () => {
        fireEvent.change(input, { target: { value: "NEWS" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });

      // Submit command 2: MARKETS
      await act(async () => {
        fireEvent.change(input, { target: { value: "MARKETS" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });

      // ArrowUp once -> Should yield most recent command ("MARKETS")
      await act(async () => {
        fireEvent.keyDown(input, { key: "ArrowUp" });
      });
      expect(input.value).toBe("MARKETS");

      // ArrowUp twice -> Should yield previous command ("NEWS")
      await act(async () => {
        fireEvent.keyDown(input, { key: "ArrowUp" });
      });
      expect(input.value).toBe("NEWS");

      // ArrowDown once -> Goes back down to "MARKETS"
      await act(async () => {
        fireEvent.keyDown(input, { key: "ArrowDown" });
      });
      expect(input.value).toBe("MARKETS");

      // ArrowDown again -> Exits history traversal to empty string
      await act(async () => {
        fireEvent.keyDown(input, { key: "ArrowDown" });
      });
      expect(input.value).toBe("");
    });
  });

  // ==========================================
  // Tier 3: Cross-Feature Integration
  // ==========================================
  describe("Tier 3: Cross-Feature Integration", () => {
    it("updates ticker state and chart store when chartSymbol changes externally", async () => {
      const { container } = render(<ResearchTerminal externalWindow={false} initialTicker="AAPL" />);
      const form = container.querySelector("form.terminal-command")!;
      const input = container.querySelector("#terminal-command") as HTMLInputElement;

      // Simulate external chart store change (e.g. from TradingView or Macro ribbon)
      await act(async () => {
        useChartStore.setState({ symbol: "YF:TSLA" });
      });

      await act(async () => {
        fireEvent.change(input, { target: { value: "FA" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });

      // Should now be on FA view for TSLA
      const tabs = container.querySelector(".panel-tabs")!;
      const activeTab = within(tabs as HTMLElement).getByRole("button", { name: /Fundamentals \(FA\)/i });
      expect(activeTab.className).toContain("active");
    });

    it("triggers CAPM workflow from command bar (TSLA CAPM)", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      const { container } = render(<ResearchTerminal externalWindow={false} />);
      const form = container.querySelector("form.terminal-command")!;
      const input = container.querySelector("#terminal-command") as HTMLInputElement;

      await act(async () => {
        fireEvent.change(input, { target: { value: "TSLA CAPM" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });

      // Should switch to CAPM tab and trigger fetch
      const tabs = container.querySelector(".panel-tabs")!;
      const activeTab = within(tabs as HTMLElement).getByRole("button", { name: /^CAPM$/i });
      expect(activeTab.className).toContain("active");
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/terminal-capm?ticker=TSLA"),
        expect.anything()
      );
    });
  });

  // ==========================================
  // Tier 4: Real-World Workflow
  // ==========================================
  describe("Tier 4: Real-World Workflow", () => {
    it("executes rapid Bloomberg terminal navigation sequence", async () => {
      const onViewChange = vi.fn();
      const onSelectSymbol = vi.fn();
      const { container } = render(
        <ResearchTerminal
          externalWindow={false}
          onViewChange={onViewChange}
          onSelectSymbol={onSelectSymbol}
        />
      );
      const form = container.querySelector("form.terminal-command")!;
      const input = container.querySelector("#terminal-command") as HTMLInputElement;

      // Step 1: User hits Alt+K and jumps to Heatmap
      fireEvent.keyDown(window, { key: "k", altKey: true });
      await act(async () => {
        fireEvent.change(input, { target: { value: "HEATMAP" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });
      expect(onViewChange).toHaveBeenLastCalledWith("heatmap");

      // Step 2: User jumps to OSINT
      await act(async () => {
        fireEvent.change(input, { target: { value: "OSINT" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });
      expect(onViewChange).toHaveBeenLastCalledWith("osint");

      // Step 3: User analyzes AMD fundamentals
      await act(async () => {
        fireEvent.change(input, { target: { value: "AMD FA" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });
      expect(onViewChange).toHaveBeenLastCalledWith("fa");
      expect(onSelectSymbol).toHaveBeenCalledWith("YF:AMD");

      // Step 4: History arrow navigation recalls "AMD FA"
      await act(async () => {
        fireEvent.keyDown(input, { key: "ArrowUp" });
      });
      expect(input.value).toBe("AMD FA");
    });
  });

  describe("parseTerminalCommand & resolveOrderExecution", () => {
    it("parses layout, pane, clear, help, and shortcut commands", () => {
      expect(parseTerminalCommand("SPLIT 1")).toEqual({ kind: "layout", mode: "single" });
      expect(parseTerminalCommand("SPLIT 2")).toEqual({ kind: "layout", mode: "split-2" });
      expect(parseTerminalCommand("SPLIT 3")).toEqual({ kind: "layout", mode: "split-3" });
      expect(parseTerminalCommand("1-PANE")).toEqual({ kind: "layout", mode: "single" });
      expect(parseTerminalCommand("2-PANE")).toEqual({ kind: "layout", mode: "split-2" });
      expect(parseTerminalCommand("3-PANE")).toEqual({ kind: "layout", mode: "split-3" });
      expect(parseTerminalCommand("GRID")).toEqual({ kind: "layout", mode: "split-3" });

      expect(parseTerminalCommand("PANE 1")).toEqual({ kind: "pane", pane: "p1" });
      expect(parseTerminalCommand("PANE 2")).toEqual({ kind: "pane", pane: "p2" });
      expect(parseTerminalCommand("PANE 3")).toEqual({ kind: "pane", pane: "p3" });

      expect(parseTerminalCommand("CLEAR")).toEqual({ kind: "clear" });
      expect(parseTerminalCommand("CLS")).toEqual({ kind: "clear" });
      expect(parseTerminalCommand("RESET")).toEqual({ kind: "clear" });

      expect(parseTerminalCommand("QUOTE MSFT")).toEqual({ kind: "chart", ticker: "MSFT" });
      expect(parseTerminalCommand("MSFT QUOTE")).toEqual({ kind: "chart", ticker: "MSFT" });
      expect(parseTerminalCommand("DES NVDA")).toEqual({ kind: "view", view: "fa", ticker: "NVDA" });
      expect(parseTerminalCommand("DES", "AAPL")).toEqual({ kind: "view", view: "fa", ticker: "AAPL" });
      expect(parseTerminalCommand("WEI")).toEqual({ kind: "view", view: "markets" });
      expect(parseTerminalCommand("HELP")).toEqual({ kind: "view", view: "help" });
      expect(parseTerminalCommand("?")).toEqual({ kind: "view", view: "help" });
    });

    it("parses BUY/SELL order syntax and validates tradeability", () => {
      expect(parseTerminalCommand("BUY AAPL")).toEqual({
        kind: "order",
        action: "BUY",
        ticker: "AAPL",
        qty: undefined,
        price: undefined,
      });
      expect(parseTerminalCommand("BUY AAPL 100")).toEqual({
        kind: "order",
        action: "BUY",
        ticker: "AAPL",
        qty: 100,
        price: undefined,
      });
      expect(parseTerminalCommand("SELL NVDA 50 @ 140.5")).toEqual({
        kind: "order",
        action: "SELL",
        ticker: "NVDA",
        qty: 50,
        price: 140.5,
      });
      expect(parseTerminalCommand("BUY TSLA @250")).toEqual({
        kind: "order",
        action: "BUY",
        ticker: "TSLA",
        qty: undefined,
        price: 250,
      });
      expect(parseTerminalCommand("AAPL BUY 25")).toEqual({
        kind: "order",
        action: "BUY",
        ticker: "AAPL",
        qty: 25,
        price: undefined,
      });

      const equityPlan = resolveOrderExecution({ action: "BUY", ticker: "TSLA", qty: 10, price: 250 });
      expect(equityPlan).toEqual({
        ok: true,
        action: "BUY",
        ticker: "TSLA",
        targetSymbol: "YF:TSLA",
        quantity: 10,
        type: "limit",
        price: 250,
      });

      const indexOrder = parseTerminalCommand("BUY ^GSPC 100");
      expect(indexOrder).toEqual({
        kind: "order",
        action: "BUY",
        ticker: "^GSPC",
        qty: 100,
        price: undefined,
      });
      if (indexOrder.kind === "order") {
        const rejected = resolveOrderExecution(indexOrder);
        expect(rejected.ok).toBe(false);
        if (!rejected.ok) {
          expect(rejected.reason).toContain("cash index");
        }
      }

      expect(parseTerminalCommand("BUY AAPL 0")).toEqual({ kind: "unknown", raw: "BUY AAPL 0" });
      expect(parseTerminalCommand("BUY AAPL -5")).toEqual({ kind: "unknown", raw: "BUY AAPL -5" });
      expect(parseTerminalCommand("INVALID_CMD_123 !@#")).toEqual({
        kind: "unknown",
        raw: "INVALID_CMD_123 !@#",
      });
    });
  });

  describe("Bloomberg Command Execution, Autocomplete, Persistence & Hotkeys", () => {
    it("stages BUY/SELL tickets in Paper Store, clears stale limit price on market orders, and rejects ^GSPC", async () => {
      const onSelectSymbol = vi.fn();
      const { container } = render(<ResearchTerminal onSelectSymbol={onSelectSymbol} />);
      const input = container.querySelector("#terminal-command") as HTMLInputElement;
      const form = container.querySelector("form.terminal-command") as HTMLFormElement;

      // Limit SELL order
      await act(async () => {
        fireEvent.change(input, { target: { value: "SELL NVDA 50 @ 140" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });
      expect(usePaperStore.getState().ticket).toEqual(
        expect.objectContaining({ side: "sell", quantity: 50, type: "limit", price: 140 }),
      );
      expect(onSelectSymbol).toHaveBeenCalledWith("YF:NVDA");
      let status = container.querySelector(".terminal-status") as HTMLElement;
      expect(status.className).toContain("is-ok");
      expect(status.textContent).toContain("Staged SELL order: 50 NVDA @ $140");

      // Market BUY clears previous limit price
      await act(async () => {
        fireEvent.change(input, { target: { value: "BUY TSLA" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });
      expect(usePaperStore.getState().ticket.side).toBe("buy");
      expect(usePaperStore.getState().ticket.quantity).toBe(100);
      expect(usePaperStore.getState().ticket.type).toBe("market");
      expect(usePaperStore.getState().ticket.price).toBeUndefined();

      // Cash index order (^GSPC) is rejected without mutating paper ticket
      const ticketBeforeReject = { ...usePaperStore.getState().ticket };
      await act(async () => {
        fireEvent.change(input, { target: { value: "BUY ^GSPC 100" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });
      status = container.querySelector(".terminal-status") as HTMLElement;
      expect(status.className).toContain("is-error");
      expect(status.textContent).toContain("cash index");
      expect(usePaperStore.getState().ticket).toEqual(ticketBeforeReject);

      // Invalid zero quantity order surfaces validation error
      await act(async () => {
        fireEvent.change(input, { target: { value: "BUY AAPL 0" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });
      status = container.querySelector(".terminal-status") as HTMLElement;
      expect(status.className).toContain("is-error");
      expect(status.textContent).toContain("Invalid order quantity");
    });

    it("executes QUOTE, DES, WEI, HELP, and CLEAR commands cleanly", async () => {
      const onSelectSymbol = vi.fn();
      const { container } = render(
        <ResearchTerminal defaultLayout="split-2" onSelectSymbol={onSelectSymbol} />,
      );
      const input = container.querySelector("#terminal-command") as HTMLInputElement;
      const form = container.querySelector("form.terminal-command") as HTMLFormElement;

      const submit = async (cmd: string) => {
        await act(async () => {
          fireEvent.change(input, { target: { value: cmd } });
        });
        await act(async () => {
          fireEvent.submit(form);
        });
      };

      await submit("QUOTE MSFT");
      expect(onSelectSymbol).toHaveBeenCalledWith("YF:MSFT");
      expect(container.querySelector(".terminal-status.is-ok")?.textContent).toContain("MSFT");

      await submit("CLEAR");
      expect(container.querySelector(".terminal-status")).toBeNull();

      await submit("DES NVDA");
      expect(container.querySelector(".terminal-primary-pane .pane-title")?.textContent).toContain("FUNDAMENTALS · NVDA");
      expect(container.querySelector(".terminal-secondary-pane .pane-title")?.textContent).toContain("GLOBAL MARKETS");

      await submit("WEI");
      expect(container.querySelector(".terminal-primary-pane .pane-title")?.textContent).toContain("GLOBAL MARKETS");

      await submit("HELP");
      expect(container.querySelector(".terminal-help")).not.toBeNull();
      expect(container.querySelector(".terminal-help")?.textContent).toContain("Alt+K");
    });

    it("filters autocomplete suggestions and supports ArrowDown, Enter, Tab, and mouseDown selection", async () => {
      const { container } = render(<ResearchTerminal />);
      const input = container.querySelector("#terminal-command") as HTMLInputElement;

      await act(async () => {
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "SPL" } });
      });

      let listbox = within(container).getByRole("listbox", { name: /Command suggestions/i });
      let options = within(listbox).getAllByRole("option");
      const optionTexts = options.map((opt) => opt.textContent ?? "");
      expect(optionTexts.some((t) => t.includes("SPLIT 1"))).toBe(true);
      expect(optionTexts.some((t) => t.includes("SPLIT 2"))).toBe(true);
      expect(options[0].getAttribute("aria-selected")).toBe("true");

      // Switch query to BUY -> ArrowDown twice highlights BUY NVDA 50 @ 135, then Enter stages order
      await act(async () => {
        fireEvent.change(input, { target: { value: "BUY" } });
      });
      listbox = within(container).getByRole("listbox", { name: /Command suggestions/i });
      options = within(listbox).getAllByRole("option");
      expect(options[2].textContent).toContain("BUY NVDA 50 @ 135");

      await act(async () => {
        fireEvent.keyDown(input, { key: "ArrowDown" });
      });
      await act(async () => {
        fireEvent.keyDown(input, { key: "ArrowDown" });
      });
      expect(within(listbox).getAllByRole("option")[2].getAttribute("aria-selected")).toBe("true");
      // ArrowUp steps back to index 1, then ArrowDown returns to index 2 before Enter stages order
      await act(async () => {
        fireEvent.keyDown(input, { key: "ArrowUp" });
      });
      expect(within(listbox).getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
      await act(async () => {
        fireEvent.keyDown(input, { key: "ArrowDown" });
      });
      expect(within(listbox).getAllByRole("option")[2].getAttribute("aria-selected")).toBe("true");
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
      });
      expect(usePaperStore.getState().ticket).toEqual(
        expect.objectContaining({ side: "buy", quantity: 50, type: "limit", price: 135 }),
      );
      expect(container.querySelector(".terminal-autocomplete")).toBeNull();

      // Tab completion on "GRI" populates "GRID" without submitting
      await act(async () => {
        fireEvent.change(input, { target: { value: "GRI" } });
      });
      await act(async () => {
        fireEvent.keyDown(input, { key: "Tab" });
      });
      expect(input.value).toBe("GRI <GO>");
      expect(container.querySelector(".terminal-autocomplete")).toBeNull();

      // Wait: verify GRID completes when typing GRID
      await act(async () => {
        fireEvent.change(input, { target: { value: "GRID" } });
      });
      await act(async () => {
        fireEvent.keyDown(input, { key: "Tab" });
      });
      expect(input.value).toBe("GRID");
      expect(container.querySelector(".terminal-autocomplete")).toBeNull();

      // Mouse selection executes HELP immediately
      await act(async () => {
        fireEvent.change(input, { target: { value: "HELP" } });
      });
      const helpListbox = within(container).getByRole("listbox", { name: /Command suggestions/i });
      const helpOpt = within(helpListbox).getByRole("option", { name: /HELP/i });
      await act(async () => {
        fireEvent.mouseDown(helpOpt);
      });
      expect(container.querySelector(".terminal-help")).not.toBeNull();
    });

    it("persists deduplicated history to localStorage across remounts and handles Alt+K / Escape cleanly", async () => {
      window.localStorage.setItem("affentrader-terminal-history", JSON.stringify(["wei", "OPPS", "WEI"]));
      const firstMount = render(<ResearchTerminal />);
      let input = firstMount.container.querySelector("#terminal-command") as HTMLInputElement;
      const form = firstMount.container.querySelector("form.terminal-command") as HTMLFormElement;

      // Deduplicated history loaded: WEI -> OPPS
      await act(async () => {
        fireEvent.keyDown(input, { key: "ArrowUp" });
      });
      expect(input.value).toBe("WEI");
      await act(async () => {
        fireEvent.keyDown(input, { key: "ArrowUp" });
      });
      expect(input.value).toBe("OPPS");
      await act(async () => {
        fireEvent.keyDown(input, { key: "ArrowDown" });
      });
      expect(input.value).toBe("WEI");

      // Execute MSFT FA -> saved & deduped at head
      await act(async () => {
        fireEvent.change(input, { target: { value: "msft fa" } });
        fireEvent.submit(form);
      });
      await act(async () => {
        fireEvent.change(input, { target: { value: "wei" } });
        fireEvent.submit(form);
      });
      const saved = JSON.parse(window.localStorage.getItem("affentrader-terminal-history") ?? "[]") as string[];
      expect(saved).toEqual(["WEI", "MSFT FA", "OPPS"]);

      firstMount.unmount();

      // Remount recalls persisted history and verifies Alt+K focus + Escape 3-stage close/clear/blur
      const secondMount = render(<ResearchTerminal />);
      input = secondMount.container.querySelector("#terminal-command") as HTMLInputElement;

      const focusSink = secondMount.container.querySelector(".panel-tabs button") as HTMLButtonElement;
      focusSink.focus();
      expect(document.activeElement).toBe(focusSink);

      await act(async () => {
        fireEvent.keyDown(window, { key: "k", altKey: true });
      });
      expect(document.activeElement).toBe(input);

      await act(async () => {
        fireEvent.keyDown(input, { key: "ArrowUp" });
      });
      expect(input.value).toBe("WEI");

      // Open autocomplete with "FA", Escape #1 closes listbox, Escape #2 clears text, Escape #3 blurs
      await act(async () => {
        fireEvent.change(input, { target: { value: "FA" } });
      });
      expect(secondMount.container.querySelector(".terminal-autocomplete")).not.toBeNull();
      await act(async () => {
        fireEvent.keyDown(input, { key: "Escape" });
        fireEvent.keyDown(window, { key: "Escape" });
      });
      expect(secondMount.container.querySelector(".terminal-autocomplete")).toBeNull();
      expect(input.value).toBe("FA");

      await act(async () => {
        fireEvent.keyDown(window, { key: "Escape" });
      });
      expect(input.value).toBe("");
      expect(document.activeElement).toBe(input);

      await act(async () => {
        fireEvent.keyDown(window, { key: "Escape" });
      });
      expect(document.activeElement).not.toBe(input);
    });

    it("triggers F1–F12 hotkeys across all Bloomberg views, hub status, and fullscreen toggle", async () => {
      const reqFs = vi.spyOn(document.documentElement, "requestFullscreen").mockResolvedValue(undefined);
      const exitFs = vi.spyOn(document, "exitFullscreen").mockResolvedValue(undefined);

      const { container } = render(<ResearchTerminal initialView="opps" />);
      const p1Title = () => container.querySelector(".terminal-primary-pane .pane-title")?.textContent ?? "";

      const pressF = async (key: string) => {
        await act(async () => {
          fireEvent.keyDown(window, { key });
        });
      };

      await pressF("F1");
      expect(p1Title()).toContain("COMMANDS CHEAT SHEET");
      await pressF("F3");
      expect(p1Title()).toContain("FUNDAMENTALS");
      await pressF("F4");
      expect(p1Title()).toContain("GLOBAL MARKETS");
      await pressF("F5");
      expect(container.querySelector(".terminal-status.is-ok")?.textContent).toContain("Refreshed active data feeds.");
      await pressF("F6");
      expect(p1Title()).toContain("STOCK BASES");
      await pressF("F7");
      expect(p1Title()).toContain("COMPARE");
      await pressF("F8");
      expect(p1Title()).toContain("NEWS FEED");
      await pressF("F9");
      expect(p1Title()).toContain("TRADE SETUPS");
      expect(container.querySelector(".terminal-status.is-ok")?.textContent).toContain("F9");
      await pressF("F10");
      expect(p1Title()).toContain("HEATMAP");
      await pressF("F11");
      expect(p1Title()).toContain("OSINT RADAR");
      await pressF("F2");
      expect(p1Title()).toContain("TRADE SETUPS");

      // F12 calls requestFullscreen when not fullscreen, and exitFullscreen when fullscreenElement is present
      await pressF("F12");
      expect(reqFs).toHaveBeenCalledTimes(1);

      Object.defineProperty(document, "fullscreenElement", {
        configurable: true,
        get: () => document.documentElement,
      });
      await pressF("F12");
      expect(exitFs).toHaveBeenCalledTimes(1);

      // Restore fullscreenElement descriptor
      Object.defineProperty(document, "fullscreenElement", {
        configurable: true,
        get: () => null,
      });
    });
  });
});
