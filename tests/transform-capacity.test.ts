import { describe, expect, it, vi } from "vitest";
import { pointFigure, renko } from "@/lib/chart/transforms";
import { DerivedTransformError, MAX_DERIVED_MARKS, requirePriceStep } from "@/lib/chart/transformCapacity";
import { clearDerivedIssue, derivedRenderIssue, runDerivedPaint, subscribeDerivedIssues } from "@/lib/chart/derivedRenderState";
import { cachedDerivedValue, clearDerivedCache, derivedBarKey } from "@/lib/chart/derivedCache";
import type { OHLCV } from "@/types/trading";

const bars = (values: number[]): OHLCV[] => values.map((close, time) => ({ time, open: close, high: close, low: close, close, volume: 1 }));
function failure(run: () => unknown, reason: DerivedTransformError["reason"]) {
  try { run(); throw new Error("Expected a complete-series failure"); }
  catch (error) { expect(error).toBeInstanceOf(DerivedTransformError); expect((error as DerivedTransformError).reason).toBe(reason); }
}
describe("bounded derived chart computation", () => {
  it("retains the complete Renko boundary and rejects the next mark without a partial result", () => {
    expect(renko(bars([0, MAX_DERIVED_MARKS]), 1)).toHaveLength(MAX_DERIVED_MARKS);
    failure(() => renko(bars([0, MAX_DERIVED_MARKS + 1]), 1), "capacity");
  });
  it("checks Point & Figure column allocation before expansion", () => {
    expect(pointFigure(bars([0, MAX_DERIVED_MARKS - 1]), 1)[0].boxes).toHaveLength(MAX_DERIVED_MARKS);
    failure(() => pointFigure(bars([0, MAX_DERIVED_MARKS]), 1), "capacity");
  });
  it("bounds Point & Figure total boxes across individually valid columns", () => {
    failure(() => pointFigure(bars([0, 20000, 0, 20000, 0]), 1), "capacity");
  });
  it("rejects non-progressing floating-point steps before a loop can stall", () => {
    failure(() => requirePriceStep(1e16, 1e16 + 1e-9), "precision");
    failure(() => renko(bars([1e16, 1e16 + 100]), 1e-9), "precision");
    failure(() => pointFigure(bars([1e16, 1e16 + 100]), 1e-9), "precision");
  });
  it("keeps fractional Point & Figure grids inclusive and rejects indistinguishable rounded prices", () => {
    expect(pointFigure(bars([0, 0.3]), 0.1)[0].boxes).toEqual([0, 0.1, 0.2, 0.3]);
    failure(() => pointFigure(bars([0, 1e-10]), 1e-11), "precision");
  });
  it("retains unchanged ordinary Renko reversals", () => {
    expect(renko(bars([100, 102, 99]), 1).map(value => [value.open, value.close])).toEqual([[100, 101], [101, 102], [101, 100], [100, 99]]);
  });
  it("caches one capacity failure per input and retries a changed or cleared input", () => {
    const build = vi.fn(() => { throw new DerivedTransformError("capacity"); });
    failure(() => cachedDerivedValue("renko:cache-test", "bad", build), "capacity");
    failure(() => cachedDerivedValue("renko:cache-test", "bad", build), "capacity"); expect(build).toHaveBeenCalledOnce();
    expect(cachedDerivedValue("renko:cache-test", "good", () => [1, 2])).toEqual([1, 2]);
    clearDerivedCache("cache-test"); expect(cachedDerivedValue("renko:cache-test", "good", () => [3])).toEqual([3]);
  });
  it("invalidates revised history with matching endpoints and retains an unchanged series key", () => {
    const first = bars([100, 101, 102]), revised = bars([100, 99, 102]);
    expect(derivedBarKey(first)).toBe(derivedBarKey(first)); expect(derivedBarKey(revised)).not.toBe(derivedBarKey(first));
    const previous = derivedBarKey(first); first[2].volume = 2; expect(derivedBarKey(first)).not.toBe(previous);
  });
  it("publishes one scoped issue, suppresses repeated alerts and clears on successful recovery", () => {
    const token = Symbol(), listener = vi.fn(), off = subscribeDerivedIssues(listener), context = { owner: "cell-1", symbol: "BTC", timeframe: "5m", type: "renko" };
    const paint = () => { throw new DerivedTransformError("capacity"); };
    runDerivedPaint("status-test", token, context, paint); runDerivedPaint("status-test", token, context, paint);
    expect(listener).toHaveBeenCalledOnce(); expect(derivedRenderIssue("status-test")).toMatchObject({ ...context, reason: "capacity" });
    runDerivedPaint("status-test", token, context, () => {}); expect(derivedRenderIssue("status-test")).toBeNull(); expect(listener).toHaveBeenCalledTimes(2);
    off();
  });
  it("prevents old renderer disposal from clearing a newer renderer's issue", () => {
    const old = Symbol(), next = Symbol(), context = { owner: "cell-1", symbol: "BTC", timeframe: "5m", type: "renko" };
    const paint = () => { throw new DerivedTransformError("capacity"); };
    runDerivedPaint("lifecycle-test", old, context, paint); runDerivedPaint("lifecycle-test", next, { ...context, owner: "cell-2" }, paint);
    clearDerivedIssue("lifecycle-test", old); expect(derivedRenderIssue("lifecycle-test")?.owner).toBe("cell-2");
    clearDerivedIssue("lifecycle-test", next); expect(derivedRenderIssue("lifecycle-test")).toBeNull();
  });
  it("does not swallow unrelated renderer defects", () => {
    expect(() => runDerivedPaint("unknown-test", Symbol(), { owner: "cell-1", symbol: "BTC", timeframe: "5m", type: "renko" }, () => { throw new Error("unexpected"); })).toThrow("unexpected");
    expect(derivedRenderIssue("unknown-test")).toBeNull();
  });
});
