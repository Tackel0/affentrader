// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeploymentUpdate } from "@/components/DeploymentUpdate";

const revision = "affenterminal--r20261120100101-aaaaaaaa";
const health = (next: string) => new Response(JSON.stringify({ ok: true, revision: next }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deployment update hint", () => {
  it("offers a reload after detecting a different healthy revision and dismisses only that revision", async () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const fetch = vi.fn()
      .mockResolvedValueOnce(health(revision))
      .mockResolvedValueOnce(health("revision-b"))
      .mockResolvedValueOnce(health("revision-b"))
      .mockResolvedValueOnce(health("revision-c"));
    vi.stubGlobal("fetch", fetch);
    render(<DeploymentUpdate loadedRevision={revision} />);
    await act(async () => {});
    expect(screen.queryByRole("status")).toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/health", expect.objectContaining({ cache: "no-store" }));

    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(screen.getByRole("status").textContent).toBe("Neue Version verfügbar");
    expect(screen.getByRole("button", { name: "Neu laden" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update-Hinweis schließen" }));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(screen.queryByRole("status")).toBeNull();

    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(screen.getByRole("status").textContent).toBe("Neue Version verfügbar");
  });

  it("coalesces visibility and focus checks, then aborts the request on unmount", async () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetch);
    const { unmount } = render(<DeploymentUpdate loadedRevision={revision} />);
    expect(fetch).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    expect(fetch).toHaveBeenCalledTimes(1);
    const signal = fetch.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("keeps failed network and health responses from announcing an update", async () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError("Network offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, revision: "revision-b" })))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    render(<DeploymentUpdate loadedRevision={revision} />);
    await act(async () => {});
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
