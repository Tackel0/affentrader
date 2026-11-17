import { describe, expect, it } from "vitest";
import { formatPrice } from "@/lib/symbols";

describe("financial price and change precision", () => {
  it.each([
    [427, "427.00"], [1.169, "1.169"], [.01456, "0.01456"], [.00012345, "0.00012345"],
    [12345.6789, "12,345.68"], [1, "1.00"],
  ] as const)("uses the same precision for gains and losses of %s", (value, expected) => {
    expect(formatPrice(value)).toBe(expected);
    expect(formatPrice(-value)).toBe(`-${expected}`);
  });
  it("keeps compact gains and losses symmetric", () => {
    expect(formatPrice(1200, true)).toBe("1.2K");
    expect(formatPrice(-1200, true)).toBe("-1.2K");
  });
});
