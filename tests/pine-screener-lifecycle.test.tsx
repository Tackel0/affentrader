// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenerPanel } from "@/components/ScreenerPanel";
import { marketService } from "@/lib/market/service";
import type { OHLCV } from "@/types/trading";
import type { PineScreenRequest, PineScreenResponse } from "@/workers/pinescreener.worker";

vi.mock("@/lib/market/service", () => ({ marketService: { fetchBars: vi.fn() } }));
vi.mock("@/components/OpportunitiesHub", () => ({ OpportunitiesHub: () => null }));
vi.mock("@/components/StockBaseScanner", () => ({ StockBaseScanner: () => null }));

const bars: OHLCV[] = [{ time: 1, open: 100, high: 110, low: 95, close: 105, volume: 20 }];

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: PineScreenResponse }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  postMessage = vi.fn<(request: PineScreenRequest) => void>();
  terminate = vi.fn();

  constructor() {
    FakeWorker.instances.push(this);
  }
}

function openPineScreener() {
  const view = render(<ScreenerPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Pine screener" }));
  return view;
}

function startScan() {
  fireEvent.click(screen.getByRole("button", { name: "Run script" }));
  return FakeWorker.instances.at(-1)!;
}

function pendingHistory() {
  let resolve!: (history: OHLCV[]) => void;
  const promise = new Promise<OHLCV[]>((done) => { resolve = done; });
  vi.mocked(marketService.fetchBars).mockReturnValueOnce(promise);
  return () => resolve(bars);
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ rows: [{ symbol: "BTCUSDT" }] })));
  vi.mocked(marketService.fetchBars).mockReset().mockResolvedValue(bars);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Pine screener scan lifecycle", () => {
  it("stops a running script immediately and lets a new scan finish", async () => {
    openPineScreener();
    const previous = startScan();
    await waitFor(() => expect(previous.postMessage).toHaveBeenCalledTimes(1));
    const [{ id, symbol }] = previous.postMessage.mock.calls[0];
    const lateReply = previous.onmessage!;

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(previous.terminate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Stopped")).toBeTruthy();
    const current = startScan();
    await waitFor(() => expect(current.postMessage).toHaveBeenCalledTimes(1));
    const [request] = current.postMessage.mock.calls[0];
    await act(async () => lateReply({ data: { id, symbol, values: { oldPlot: 1 } } }));
    expect(screen.queryByText("oldPlot")).toBeNull();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    await act(async () => current.onmessage?.({ data: { id: request.id, symbol, values: { newPlot: 2 } } }));
    expect(screen.getByText("Done · 1 symbols")).toBeTruthy();
    expect(screen.getByText("newPlot")).toBeTruthy();
    expect(current.terminate).toHaveBeenCalledTimes(1);
  });

  it("releases a worker on panel close while history is still loading", async () => {
    const resolveHistory = pendingHistory();
    const view = openPineScreener();
    const worker = startScan();
    await waitFor(() => expect(marketService.fetchBars).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    await act(async () => resolveHistory());
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("aborts the symbol list request when a scan is stopped", async () => {
    openPineScreener();
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      signal = init?.signal ?? undefined;
      signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
    }));
    const worker = startScan();
    expect(signal?.aborted).toBe(false);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Stop" })));
    expect(signal?.aborted).toBe(true);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(marketService.fetchBars).not.toHaveBeenCalled();
    expect(screen.getByText("Stopped")).toBeTruthy();
  });
});
