/** Chrome can announce DevTools before its initial about:blank target exists. */
export async function waitForChromePageTarget(browserWsUrl, {
  timeoutMs = 10_000,
  pollMs = 100,
  fetchImpl = fetch,
} = {}) {
  const port = new URL(browserWsUrl).port;
  const deadline = performance.now() + timeoutMs;
  let lastError = "No inspectable page target yet";
  while (performance.now() < deadline) {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now()))),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`DevTools returned HTTP ${response.status}`);
      }
      const targets = await response.json();
      if (!Array.isArray(targets)) throw new Error("Invalid DevTools target list");
      const page = targets.find((target) => target?.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page;
      lastError = "No inspectable page target yet";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    const remaining = deadline - performance.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)));
  }
  throw new Error(`Chrome page target timeout after ${timeoutMs}ms: ${lastError}`);
}
