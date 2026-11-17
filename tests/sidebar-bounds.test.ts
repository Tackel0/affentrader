import { expect, it, vi } from "vitest";
import { bindSidebarChartBounds, sidebarBottomInset } from "@/lib/chart/sidebarBounds";
import { bindSidebarResize } from "@/lib/chart/sidebarResize";
it("keeps the sidebar's bottom above Replay, range and expanded panel controls", () => {
  expect(sidebarBottomInset(1772, 1643)).toBe(129);
  expect(sidebarBottomInset(812, 680.2)).toBe(132);
  expect(sidebarBottomInset(812, 410)).toBe(402);
  expect(sidebarBottomInset(812, 820)).toBe(0);
  expect(sidebarBottomInset(NaN, 100)).toBe(0);
});

it("previews the latest drag once per frame and commits only on pointer release", () => {
  let queued: FrameRequestCallback | undefined, width = 300;
  const requestFrame = vi.fn((callback: FrameRequestCallback) => { queued = callback; return 1; });
  const cancelFrame = vi.fn(() => { queued = undefined; });
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  const handle = Object.assign(new EventTarget(), {
    dataset: {}, setAttribute: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn(),
  });
  const sidebar = { style: { width: "" }, getBoundingClientRect: () => ({ width }) };
  const commit = vi.fn((next: number) => { width = next; });
  const unsubscribe = vi.fn();
  const off = bindSidebarResize(sidebar as unknown as HTMLElement, handle as unknown as HTMLElement, {
    read: () => width, commit, subscribe: () => unsubscribe,
  });
  const pointer = (type: string, clientX: number, pointerId = 1) => handle.dispatchEvent(Object.assign(new Event(type), {
    clientX, pointerId, button: 0, isPrimary: true,
  }));
  try {
    pointer("pointerdown", 301);
    pointer("pointermove", 290);
    pointer("pointermove", 250);
    pointer("pointermove", 0, 2);
    expect(requestFrame).toHaveBeenCalledOnce();
    expect(sidebar.style.width).toBe("300px");
    queued?.(0);
    expect(sidebar.style.width).toBe("351px");
    expect(handle.setAttribute).toHaveBeenLastCalledWith("aria-valuenow", "351");
    expect(commit).not.toHaveBeenCalled();

    pointer("pointermove", 220);
    pointer("pointerup", 220);
    expect(commit).toHaveBeenCalledExactlyOnceWith(381);
    expect(sidebar.style.width).toBe("381px");
    expect(cancelFrame).toHaveBeenCalledWith(1);

    pointer("pointerdown", 220);
    pointer("pointermove", 200);
    queued?.(0);
    expect(sidebar.style.width).toBe("401px");
    pointer("pointercancel", 200);
    expect(sidebar.style.width).toBe("381px");
    expect(commit).toHaveBeenCalledTimes(1);
    pointer("pointerdown", 220);
    pointer("pointermove", 200);
  } finally {
    off();
    vi.unstubAllGlobals();
  }
  expect(queued).toBeUndefined();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(handle.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
});
it("tracks actual layout changes and releases observers, events and styles on sidebar close", () => {
  const before = { HTMLElement: globalThis.HTMLElement, ResizeObserver: globalThis.ResizeObserver, window: globalThis.window };
  const target = new EventTarget(), styles = new Map<string, string>(); let chartBottom = 1643, callback = () => {};
  const disconnect = vi.fn(), observed: unknown[] = [];
  class Element { getBoundingClientRect() { return { bottom: 1772 }; } }
  class Observer { constructor(fn: () => void) { callback = fn; } observe(value: unknown) { observed.push(value); } disconnect = disconnect; }
  vi.stubGlobal("HTMLElement", Element); vi.stubGlobal("ResizeObserver", Observer); vi.stubGlobal("window", target);
  try {
    const owner = new Element(), sidebar = { offsetParent: owner, style: { setProperty: (key: string, value: string) => styles.set(key, value), removeProperty: (key: string) => styles.delete(key) } };
    const chart = { getBoundingClientRect: () => ({ bottom: chartBottom }) };
    const off = bindSidebarChartBounds(sidebar as unknown as HTMLElement, chart as HTMLElement);
    expect(observed).toEqual([chart, owner]); expect(styles.get("--sidebar-chart-bottom")).toBe("129px");
    chartBottom = 1604; callback(); expect(styles.get("--sidebar-chart-bottom")).toBe("168px");
    chartBottom = 1300; target.dispatchEvent(new Event("resize")); expect(styles.get("--sidebar-chart-bottom")).toBe("472px");
    off(); expect(styles.size).toBe(0); expect(disconnect).toHaveBeenCalledOnce(); target.dispatchEvent(new Event("resize")); expect(styles.size).toBe(0);
  } finally { for (const [key, value] of Object.entries(before)) vi.stubGlobal(key, value); }
});
