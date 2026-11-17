"use client";
import { useChartStore } from "@/stores/useChartStore";
import { useStrategyStore } from "@/stores/useStrategyStore";
import type {
  StrategyWorkerRequest,
  StrategyWorkerResponse,
} from "@/types/strategy";
import { loadStrategyDataset, strategyTimeframe } from "./data";
import { parseStrategyDocument } from "./settings";
import { loadMagnifierDataset } from "./magnifier";
import { intervalMs, nextBucket } from "@/lib/market/intervals";

let active: {
  id: string;
  worker: Worker | null;
  abort: AbortController;
} | null = null;
export function cancelStrategy() {
  active?.abort.abort();
  active?.worker?.terminate();
  active = null;
  useStrategyStore
    .getState()
    .set({ status: "idle", progress: "Test cancelled", error: null });
}
function release(id: string) {
  if (active?.id !== id) return;
  active.abort.abort();
  active.worker?.terminate();
  active = null;
}
export async function startStrategy(inspect = false) {
  cancelStrategy();
  const id = crypto.randomUUID(),
    abort = new AbortController();
  active = { id, worker: null, abort };
  const store = useStrategyStore.getState();
  store.set({
    status: "loading",
    error: null,
    progress: inspect
      ? "Inspecting Pine strategy…"
      : "Preparing historical data…",
  });
  try {
    const document = parseStrategyDocument(store.document),
      chart = useChartStore.getState();
    const libraries = { ...chart.pineLibraries };
    let dataset = inspect
      ? null
      : await loadStrategyDataset(
          chart.symbol,
          chart.timeframe,
          document.settings,
          abort.signal,
          (progress) => {
            if (active?.id === id)
              useStrategyStore.getState().set({ progress });
          },
        );
    if (dataset && document.settings.useBarMagnifier)
      dataset = await loadMagnifierDataset(dataset, document.settings, abort.signal, (progress) => {
        if (active?.id === id) useStrategyStore.getState().set({ progress });
      });
    if (active?.id !== id) return;
    const worker = new Worker(
      new URL("../../workers/strategy.worker.ts", import.meta.url),
    );
    active.worker = worker;
    const send = (message: StrategyWorkerRequest) =>
      worker.postMessage(message);
    worker.onerror = (event) => {
      if (active?.id !== id) return;
      useStrategyStore.getState().set({
        status: "error",
        error: event.message || "The strategy worker failed to start.",
        progress: "",
      });
      release(id);
    };
    worker.onmessage = async ({
      data,
    }: MessageEvent<StrategyWorkerResponse>) => {
      if (active?.id !== id || data.id !== id) return;
      const state = useStrategyStore.getState();
      if (data.type === "progress")
        state.set({
          status: "running",
          progress: `Calculating · ${data.completed.toLocaleString()} / ${data.total.toLocaleString()} bars`,
        });
      else if (data.type === "inputs") {
        const sameSource = state.document.source === document.source;
        state.set({
          inputSchema: sameSource ? data.inputs : [],
          status: "idle",
          progress: sameSource
            ? "Inputs loaded"
            : "Source changed; inspect inputs again.",
        });
        release(id);
      } else if (data.type === "result") {
        state.set({
          report: data.report,
          status: "complete",
          progress: `Completed · ${data.report.barCount.toLocaleString()} bars`,
        });
        release(id);
      } else if (data.type === "error") {
        state.set({ status: "error", error: data.message, progress: "" });
        release(id);
      } else if (data.type === "fetch" && dataset) {
        try {
          const timeframe = strategyTimeframe(data.timeframe),
            step = intervalMs(timeframe);
          const to = Math.min(
            data.to ?? Infinity,
            nextBucket(dataset.market.timeframe, dataset.bars.at(-1)!.time),
          );
          const from = data.from ?? dataset.bars[0].time;
          const format = (v: number) => new Date(v).toISOString().slice(0, 19);
          const secondary = await loadStrategyDataset(
            data.symbol,
            timeframe,
            {
              ...document.settings,
              bars: Math.max(
                100,
                Math.min(
                  20000,
                  Math.max(data.limit, Math.ceil((to - from) / step)),
                ),
              ),
              from: format(from),
              to: format(to),
            },
            abort.signal,
          );
          if (active?.id === id)
            send({
              type: "series",
              requestId: data.requestId,
              dataset: secondary,
            });
        } catch (error) {
          if (active?.id === id)
            send({
              type: "series",
              requestId: data.requestId,
              error: error instanceof Error ? error.message : String(error),
            });
        }
      }
    };
    if (inspect)
      send({ type: "inspect", id, source: document.source, libraries });
    else if (dataset) {
      store.set({ status: "running", progress: "Compiling Pine strategy…" });
      send({ type: "run", request: { id, document, dataset, libraries } });
    }
  } catch (error) {
    if (active?.id !== id) return;
    store.set({
      status: "error",
      progress: "",
      error: error instanceof Error ? error.message : String(error),
    });
    release(id);
  }
}
