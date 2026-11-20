import { expect, test, vi } from "vitest";
import { bindBottomPanelResize } from "@/lib/chart/bottomPanelResize";

test("coalesces desktop drags, snaps compact panels, and restores the last size on cancel", () => {
  let queued: FrameRequestCallback | undefined;
  const requestFrame = vi.fn((callback: FrameRequestCallback) => { queued = callback; return 1; });
  const cancelFrame = vi.fn(() => { queued = undefined; });
  const disconnect = vi.fn();
  const observe = vi.fn();
  const compact = { matches: false };
  const window = Object.assign(new EventTarget(), { matchMedia: () => compact });
  const handle = Object.assign(new EventTarget(), {
    dataset: {}, setAttribute: vi.fn(), removeAttribute: vi.fn(), setPointerCapture: vi.fn(),
    hasPointerCapture: () => true, releasePointerCapture: vi.fn(),
  });
  let size = "";
  const panel = { style: { getPropertyValue: () => size, setProperty: (_key: string, next: string) => { size = next; } } };
  const content = { getBoundingClientRect: () => ({ height: Number.parseInt(size) || 370 }) };
  const chart = { getBoundingClientRect: () => ({ height: 750 - content.getBoundingClientRect().height }) };
  vi.stubGlobal("window", window);
  vi.stubGlobal("getComputedStyle", (node: unknown) => node === chart ? { minHeight: "150px" } : { maxHeight: "none" });
  vi.stubGlobal("ResizeObserver", class { observe = observe; disconnect = disconnect; });
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  const binding = bindBottomPanelResize(panel as unknown as HTMLElement, content as HTMLElement, handle as unknown as HTMLElement, chart as HTMLElement);
  const pointer = (type: string, clientY: number, pointerId = 1) => handle.dispatchEvent(Object.assign(new Event(type), {
    clientY, pointerId, button: 0, isPrimary: true,
  }));

  try {
    expect(observe.mock.calls).toEqual([[chart], [content]]);
    expect(handle.setAttribute).toHaveBeenCalledWith("aria-valuemax", "600");
    pointer("pointerdown", 400);
    pointer("pointermove", 380);
    pointer("pointermove", 350);
    pointer("pointermove", 50, 2);
    expect(requestFrame).toHaveBeenCalledOnce();
    expect(size).toBe("");
    queued?.(0);
    expect(size).toBe("420px");

    pointer("pointermove", 330);
    pointer("pointerup", 310);
    expect(size).toBe("460px");
    expect(cancelFrame).toHaveBeenCalledWith(1);
    pointer("pointerdown", 310);
    pointer("pointermove", 20);
    queued?.(0);
    expect(size).toBe("600px");
    pointer("pointercancel", 20);
    expect(size).toBe("460px");

    compact.matches = true;
    pointer("pointerdown", 310);
    pointer("pointerup", 360);
    expect(size).toBe("400px");
    expect(handle.setAttribute).toHaveBeenCalledWith("aria-valuetext", "Half height");
    const press = (key: string) => handle.dispatchEvent(Object.assign(new Event("keydown"), { key }));
    press("ArrowDown");
    expect(size).toBe("200px");
    expect(handle.setAttribute).toHaveBeenCalledWith("aria-valuetext", "Peek");
    press("ArrowUp");
    press("ArrowUp");
    expect(size).toBe("600px");
    expect(handle.setAttribute).toHaveBeenCalledWith("aria-valuetext", "Full height");

    pointer("pointerdown", 310);
    pointer("pointermove", 360);
  } finally {
    binding.dispose();
    vi.unstubAllGlobals();
  }
  expect(queued).toBeUndefined();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(size).toBe("600px");
  expect(handle.dataset).toEqual({});
  expect(handle.releasePointerCapture).toHaveBeenCalledTimes(4);
});
