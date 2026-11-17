import { describe, it, expect } from "vitest";
import { AlertEvaluator, conditionMatches } from "@/lib/alerts/engine";
import type { AlertCondition, PriceAlert } from "@/types/trading";
const alert: PriceAlert = {
  id: "test",
  name: "Test",
  symbol: "BTCUSDT",
  condition: "crossing_up",
  price: 100,
  status: "active",
  repeat: true,
  frequency: "tick",
  timeframe: "1m",
  sound: false,
  browserNotification: false,
  simulated: false,
  createdAt: 0,
};
describe("price condition boundaries", () => {
  it.each<[AlertCondition, number, number, boolean]>([
    ["crossing", 99, 100, true],
    ["crossing", 101, 100, true],
    ["crossing", 100, 101, false],
    ["crossing", 100, 99, false],
    ["crossing_up", 99, 101, true],
    ["crossing_up", 101, 99, false],
    ["crossing_down", 101, 99, true],
    ["crossing_down", 99, 101, false],
    ["crossing_up", 99, 99, false],
    ["entering_band", 99, 105, true],
    ["entering_band", 111, 110, true],
    ["entering_band", 105, 109, false],
    ["entering_band", 99, 111, false],
    ["exiting_band", 105, 111, true],
    ["exiting_band", 100, 99, true],
    ["exiting_band", 99, 98, false],
  ])("%s: %s → %s", (condition, prev, next, result) =>
    expect(conditionMatches(condition, prev, next, 100, 110)).toBe(result),
  );
  it("rejects non-finite prices and inverted bands", () => {
    expect(conditionMatches("crossing", NaN, 110, 100)).toBe(false);
    expect(conditionMatches("entering_band", 90, 105, 110, 100)).toBe(false);
  });
});
describe("stateful alert evaluation", () => {
  it("seeds first observation then fires once at the crossing", () => {
    const engine = new AlertEvaluator();
    expect(engine.evaluate([alert], "BTCUSDT", 99, 1, false, "tick")).toEqual(
      [],
    );
    expect(engine.evaluate([alert], "BTCUSDT", 100, 2, false, "tick")).toEqual([
      "test",
    ]);
    expect(engine.evaluate([alert], "BTCUSDT", 101, 3, false, "tick")).toEqual(
      [],
    );
  });
  it("does not cross between live and simulated sequences", () => {
    const e = new AlertEvaluator();
    e.evaluate([alert], "BTCUSDT", 99, 1, true, "tick");
    expect(e.evaluate([alert], "BTCUSDT", 101, 2, false, "tick")).toEqual([]);
  });
  it("does not trigger after threshold edits or resume", () => {
    const e = new AlertEvaluator();
    e.evaluate([alert], "BTCUSDT", 99, 1, false, "tick");
    expect(
      e.evaluate(
        [{ ...alert, price: 100.5 }],
        "BTCUSDT",
        101,
        2,
        false,
        "tick",
      ),
    ).toEqual([]);
    e.evaluate(
      [{ ...alert, status: "paused" }],
      "BTCUSDT",
      99,
      3,
      false,
      "tick",
    );
    expect(e.evaluate([alert], "BTCUSDT", 101, 4, false, "tick")).toEqual([]);
  });
  it("ignores stale events, other markets and wrong close intervals", () => {
    const e = new AlertEvaluator();
    e.evaluate([alert], "BTCUSDT", 99, 10, false, "tick");
    expect(e.evaluate([alert], "BTCUSDT", 101, 9, false, "tick")).toEqual([]);
    expect(e.evaluate([alert], "ETHUSDT", 101, 11, false, "tick")).toEqual([]);
    const close = { ...alert, frequency: "close" as const };
    expect(
      e.evaluate([close], "BTCUSDT", 101, 12, false, "close", "5m"),
    ).toEqual([]);
  });
  it("evaluates close-only conditions on their selected timeframe", () => {
    const e = new AlertEvaluator();
    const a = { ...alert, frequency: "close" as const };
    e.evaluate([a], "BTCUSDT", 99, 1, false, "close", "1m");
    expect(e.evaluate([a], "BTCUSDT", 101, 2, false, "tick")).toEqual([]);
    expect(e.evaluate([a], "BTCUSDT", 101, 2, false, "close", "1m")).toEqual([
      "test",
    ]);
  });
});
