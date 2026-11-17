import { describe, it, expect } from "vitest";
import { PineTS } from "pinets";
import { generateHistory } from "@/lib/market/mock";
import {
  STARTER_SCRIPT,
  STRUCTURE_SCRIPT,
  LIQUIDITY_SCRIPT,
  KNN_SCRIPT,
  ICHIMOKU_SCRIPT,
} from "@/lib/indicators/scripts";
describe("bundled Pine scripts execute in the actual PineTS runtime", () => {
  it("resolves registered Pine import libraries", async () => {
    const runtime = new PineTS(
      generateHistory("BTCUSDT", "1m", 20).map((b) => ({
        ...b,
        openTime: b.time,
        closeTime: b.time + 59999,
      })),
    );
    runtime.setImportResolver((path) =>
      path === "Affentrader/Math/1"
        ? '//@version=5\nlibrary("Math")\nexport twice(float x) =>\n    x * 2\n'
        : null,
    );
    const result = await runtime.run(
      '//@version=5\nimport Affentrader/Math/1 as m\nindicator("Library test")\nplot(m.twice(close), "Double")',
    );
    expect(result.plots.Double.data).toHaveLength(20);
  });
  it.each([
    ["EMA crossover", STARTER_SCRIPT],
    ["Market structure", STRUCTURE_SCRIPT],
    ["Liquidity sweeps", LIQUIDITY_SCRIPT],
    ["k-NN", KNN_SCRIPT],
    ["Ichimoku", ICHIMOKU_SCRIPT],
  ])("%s", async (_, script) => {
    const data = generateHistory("BTCUSDT", "15m", 200).map((b) => ({
      openTime: b.time,
      closeTime: b.time + 900000 - 1,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
    const context = await new PineTS(data).run(script);
    expect(Object.keys(context.plots).length).toBeGreaterThan(0);
    expect(
      Object.values(context.plots).some(
        (p) => (p as { data: unknown[] }).data.length > 0,
      ),
    ).toBe(true);
  });
});
