import { describe, expect, it } from "vitest";
import { formatPrice, formatVolume } from "@/lib/symbols";

describe("financial price and change precision", () => {
  it.each([
    [427, "427.00"], [1.169, "1.169"], [.01456, "0.01456"], [.00012345, "0.00012345"],
    [12345.6789, "12,345.68"], [1, "1.00"],
    [99.9999, "99.9999"], [100.0001, "100.00"],
  ] as const)("uses the same precision for gains and losses of %s", (value, expected) => {
    expect(formatPrice(value)).toBe(expected);
    expect(formatPrice(-value)).toBe(`-${expected}`);
  });
  it("keeps compact gains and losses symmetric", () => {
    expect(formatPrice(1200, true)).toBe("1.2K");
    expect(formatPrice(-1200, true)).toBe("-1.2K");
  });
  it("preserves small execution quantities and compact volume labels", () => {
    expect(formatVolume(0.00998123)).toBe("0.00998");
    expect(formatVolume(0.0100199)).toBe("0.01");
    expect(formatVolume(0.25)).toBe("0.25");
    expect(formatVolume(1200.25)).toBe("1.2K");
  });
});
