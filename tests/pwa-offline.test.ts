import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const workerSource = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://terminal.example.test";

function setup() {
  type WorkerRequest = { method: string; mode: string; url: string };
  type FetchEvent = { request: WorkerRequest; respondWith: (response: Promise<Response>) => void };
  const handlers = new Map<string, (event: FetchEvent) => void>();
  const fetch = vi.fn<(request: WorkerRequest) => Promise<Response>>();
  runInNewContext(workerSource, {
    self: { location: { origin }, addEventListener: (name: string, fn: (event: FetchEvent) => void) => handlers.set(name, fn) },
    URL, Response, fetch,
  });
  return {
    fetch,
    navigate(path: string, method = "GET", mode = "navigate") {
      const request = { method, mode, url: new URL(path, origin).href };
      const respondWith = vi.fn<FetchEvent["respondWith"]>();
      handlers.get("fetch")?.({ request, respondWith });
      return { request, response: respondWith.mock.calls[0]?.[0] };
    },
  };
}

describe("PWA offline navigation", () => {
  it.each([200, 303, 401, 503])("returns an actual HTTP %i unchanged", async (status) => {
    const worker = setup();
    const serverResponse = new Response("server response", { status });
    worker.fetch.mockResolvedValueOnce(serverResponse);
    const { request, response } = worker.navigate("/terminal?view=opps");
    expect(worker.fetch).toHaveBeenCalledWith(request);
    expect(await response).toBe(serverResponse);
  });

  it("serves a script-free, data-free retry page only after a failed network request", async () => {
    const worker = setup();
    worker.fetch.mockRejectedValueOnce(new TypeError("Network unavailable"));
    const { response } = worker.navigate("/terminal?view=private-marker");
    const page = (await response)!;
    expect(page.status).toBe(503);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await page.text();
    expect(html).toContain("Keine Verbindung");
    expect(html).toContain('<a href="">Erneut versuchen</a>');
    expect(html).not.toMatch(/private-marker|<script|<form/);
  });

  it("leaves login submissions, APIs, assets and cross-origin requests to the browser", () => {
    const worker = setup();
    expect(worker.navigate("/login", "POST").response).toBeUndefined();
    expect(worker.navigate("/api/sync").response).toBeUndefined();
    expect(worker.navigate("/_next/static/chunk.js").response).toBeUndefined();
    expect(worker.navigate("/terminal", "GET", "cors").response).toBeUndefined();
    expect(worker.navigate("https://other.example.test/terminal").response).toBeUndefined();
    expect(worker.fetch).not.toHaveBeenCalled();
  });
});
