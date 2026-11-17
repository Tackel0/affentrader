import { afterEach, describe, expect, it, vi } from "vitest";
import { priceScaleGesture } from "@/lib/chart/controls";
const click = { type: "click", detail: 1, button: 0, shiftKey: false };
afterEach(() => vi.useRealTimers());
describe("price axis gesture arbitration", () => {
  it("opens exactly one alert after a single click without consuming the native click", () => {
    vi.useFakeTimers(); const gesture = priceScaleGesture(), alert = vi.fn(); gesture.handle(click, alert);
    vi.advanceTimersByTime(499); expect(alert).not.toHaveBeenCalled(); vi.advanceTimersByTime(1); expect(alert).toHaveBeenCalledTimes(1);
  });
  it("cancels the pending alert for native double-click autoscale", () => {
    vi.useFakeTimers(); const gesture = priceScaleGesture(), alert = vi.fn(); gesture.handle(click, alert);
    vi.advanceTimersByTime(200); gesture.handle({ ...click, detail: 2 }, alert); gesture.handle({ ...click, type: "dblclick", detail: 2 }, alert);
    vi.runAllTimers(); expect(alert).not.toHaveBeenCalled();
  });
  it("keeps context-menu and Shift-limit actions immediate", () => {
    vi.useFakeTimers(); const gesture = priceScaleGesture(), alert = vi.fn(), limit = vi.fn();
    gesture.handle({ ...click, type: "contextmenu", button: 2 }, alert); expect(alert).toHaveBeenCalledTimes(1);
    gesture.handle({ ...click, shiftKey: true }, limit); expect(limit).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels pending actions on teardown/other controls and ignores middle clicks", () => {
    vi.useFakeTimers(); const gesture = priceScaleGesture(), alert = vi.fn(); gesture.handle(click, alert); gesture.cancel();
    gesture.handle({ ...click, button: 1 }, alert); vi.runAllTimers(); expect(alert).not.toHaveBeenCalled();
  });
});
