import { executeStrategy, inspectStrategy } from "@/lib/strategy/engine";
import type {
  StrategyDataset,
  StrategyWorkerRequest,
  StrategyWorkerResponse,
} from "@/types/strategy";

const scope = self as unknown as {
  postMessage: (message: StrategyWorkerResponse) => void;
  onmessage: ((event: MessageEvent<StrategyWorkerRequest>) => void) | null;
};
const pending = new Map<
  string,
  { resolve: (value: StrategyDataset) => void; reject: (error: Error) => void }
>();
scope.onmessage = async ({ data }) => {
  if (data.type === "series") {
    const promise = pending.get(data.requestId);
    pending.delete(data.requestId);
    if (data.dataset) promise?.resolve(data.dataset);
    else
      promise?.reject(new Error(data.error ?? "Secondary data unavailable."));
    return;
  }
  const id = data.type === "run" ? data.request.id : data.id;
  try {
    if (data.type === "inspect") {
      const result = await inspectStrategy(data.source, data.libraries);
      scope.postMessage({ type: "inputs", id, ...result });
    } else {
      const report = await executeStrategy(
        data.request,
        (completed, total) =>
          scope.postMessage({ type: "progress", id, completed, total }),
        (symbol, timeframe, limit, from, to) =>
          new Promise((resolve, reject) => {
            const requestId = crypto.randomUUID();
            pending.set(requestId, { resolve, reject });
            scope.postMessage({
              type: "fetch",
              id,
              requestId,
              symbol,
              timeframe,
              limit,
              from,
              to,
            });
          }),
      );
      scope.postMessage({ type: "result", id, report });
    }
  } catch (error) {
    scope.postMessage({
      type: "error",
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
