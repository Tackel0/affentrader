import { PineWorkerEngine } from "@luxalgo/vela-pinets";
import { expect, it, vi } from "vitest";

it("drops library replies that arrive after the chart's Pine worker has closed", async () => {
  let receive: ((event: { data: unknown }) => void) | undefined;
  const worker = {
    postMessage: vi.fn<(message: unknown) => void>(),
    addEventListener: (_type: "message", listener: (event: { data: unknown }) => void) => { receive = listener; },
    terminate: vi.fn(),
  };
  const createWorker = vi.fn(() => worker);
  let returnLibrary!: (source: string) => void;
  const importResolver = vi.fn(() => new Promise<string>((resolve) => { returnLibrary = resolve; }));
  const engine = new PineWorkerEngine({ createWorker, importResolver });
  const prepared = engine.prepare('indicator("Lifecycle")', "test");
  receive?.({ data: { kind: "prepared", reqId: 1, prepared: { inputs: [] } } });
  await prepared;

  receive?.({ data: { kind: "resolveImport", reqId: 2, path: "local/Example/1", info: {} } });
  expect(importResolver).toHaveBeenCalledOnce();
  engine.terminate();
  returnLibrary('library("Example")');
  await Promise.resolve();
  await Promise.resolve();

  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(createWorker).toHaveBeenCalledOnce();
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
});
