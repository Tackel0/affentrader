import { describe, expect, it, vi } from "vitest";
import { waitForChromePageTarget } from "../scripts/chrome-page-target.mjs";

const browser = "ws://127.0.0.1:9222/devtools/browser/test";
const page = { type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/test" };
const json = (value: unknown) => new Response(JSON.stringify(value));

describe("Chrome page readiness", () => {
  it("waits for the initial page after DevTools starts with an empty target list", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json([{ type: "service_worker", webSocketDebuggerUrl: "worker" }, { type: "page" }]))
      .mockResolvedValueOnce(json([page]));
    expect(await waitForChromePageTarget(browser, { fetchImpl, pollMs: 1 })).toEqual(page);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://127.0.0.1:9222/json/list");
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("recovers from transient connection and malformed response errors during startup", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(new Response("starting", { status: 503 }))
      .mockResolvedValueOnce(json({ targets: [] }))
      .mockResolvedValueOnce(json([page]));
    expect(await waitForChromePageTarget(browser, { fetchImpl, pollMs: 1 })).toEqual(page);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("fails within the deadline when Chrome never exposes a usable page", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => json([]));
    await expect(waitForChromePageTarget(browser, { fetchImpl, timeoutMs: 25, pollMs: 2 }))
      .rejects.toThrow("Chrome page target timeout after 25ms: No inspectable page target yet");
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("preserves a useful error when DevTools remains unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(waitForChromePageTarget(browser, { fetchImpl, timeoutMs: 25, pollMs: 2 }))
      .rejects.toThrow("ECONNREFUSED");
  });
});
