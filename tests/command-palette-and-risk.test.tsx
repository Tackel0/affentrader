// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommandPalette } from "@/components/CommandPalette";
import { calculateRiskPositionSize, evaluateTicketRisk } from "@/lib/trading/riskSizing";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

beforeEach(() => {
  useChartStore.getState().set({
    symbol: "BTCUSDT",
    timeframe: "15m",
    commandPaletteOpen: false,
    bottomOpen: false,
    bottomTab: "overview",
    changelogOpen: false,
  });
  useWorkspaceStore.getState().setTheme("light");
});

afterEach(() => {
  cleanup();
});

describe("Risk-based position sizing math", () => {
  it("sizes a buy position cleanly including round-trip fees and computes R:R", () => {
    const res = calculateRiskPositionSize({
      side: "buy",
      entryPrice: 100,
      stopLoss: 95,
      takeProfit: 115,
      accountEquity: 10_000,
      riskAmount: 100,
      feeRate: 0.001,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // stopDistance = 5, feePerUnit = (100 + 95) * 0.001 = 0.195 -> riskPerUnit = 5.195 -> qty <= 19.24
    expect(res.quantity).toBeGreaterThan(19);
    expect(res.quantity).toBeLessThanOrEqual(19.25);
    expect(res.actualRiskAmount).toBeLessThanOrEqual(100.01);
    expect(res.riskRewardRatio).toBeCloseTo(3.0, 5);
    expect(res.cappedByPower).toBe(false);
  });

  it("rejects inverted stop-loss direction for buy and sell orders", () => {
    const badBuy = calculateRiskPositionSize({
      side: "buy",
      entryPrice: 100,
      stopLoss: 105,
      accountEquity: 10_000,
      riskAmount: 100,
    });
    expect(badBuy.ok).toBe(false);

    const badSell = calculateRiskPositionSize({
      side: "sell",
      entryPrice: 100,
      stopLoss: 95,
      accountEquity: 10_000,
      riskAmount: 100,
    });
    expect(badSell.ok).toBe(false);
  });

  it("caps position size to available buying power when risk budget exceeds margin", () => {
    const res = calculateRiskPositionSize({
      side: "buy",
      entryPrice: 100,
      stopLoss: 99.5,
      accountEquity: 10_000,
      riskAmount: 500,
      maxQuantity: 100,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.cappedByPower).toBe(true);
    expect(res.quantity).toBeLessThanOrEqual(100);
  });

  it("evaluates live ticket risk and R:R for a short setup", () => {
    const risk = evaluateTicketRisk({
      side: "sell",
      entryPrice: 200,
      stopLoss: 210,
      takeProfit: 170,
      quantity: 5,
      accountEquity: 10_000,
      feeRate: 0,
    });
    expect(risk.valid).toBe(true);
    expect(risk.riskAmount).toBeCloseTo(50, 6);
    expect(risk.riskPercent).toBeCloseTo(0.5, 6);
    expect(risk.riskRewardRatio).toBeCloseTo(3.0, 6);
  });
});

describe("Global Command Palette (Cmd/Ctrl+K)", () => {
  it("filters dynamic timeframes, switches intervals, and executes module/theme actions via keyboard", () => {
    useChartStore.getState().set({ commandPaletteOpen: true });
    render(<CommandPalette />);

    const dialog = screen.getByRole("dialog", { name: "Command Palette" });
    const input = within(dialog).getByRole("textbox", { name: "Befehl oder Symbol suchen" });

    // Dynamic interval jump ("4h")
    fireEvent.change(input, { target: { value: "4h" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useChartStore.getState().timeframe).toBe("4h");
    expect(useChartStore.getState().commandPaletteOpen).toBe(false);

    // Reopen and switch to Strategy Tester
    act(() => {
      useChartStore.getState().set({ commandPaletteOpen: true });
    });
    const dialog2 = screen.getByRole("dialog", { name: "Command Palette" });
    const input2 = within(dialog2).getByRole("textbox", { name: "Befehl oder Symbol suchen" });
    fireEvent.change(input2, { target: { value: "strategy" } });
    fireEvent.keyDown(input2, { key: "Enter" });
    expect(useChartStore.getState().bottomOpen).toBe(true);
    expect(useChartStore.getState().bottomTab).toBe("strategy");

    // Reopen and toggle Dark Mode
    act(() => {
      useChartStore.getState().set({ commandPaletteOpen: true });
    });
    const dialog3 = screen.getByRole("dialog", { name: "Command Palette" });
    const input3 = within(dialog3).getByRole("textbox", { name: "Befehl oder Symbol suchen" });
    fireEvent.change(input3, { target: { value: "dark mode" } });
    fireEvent.keyDown(input3, { key: "Enter" });
    expect(useWorkspaceStore.getState().theme).toBe("dark");
  });
});
