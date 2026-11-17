import { describe, expect, it } from "vitest";
import { parsePickerHex, paletteDestination, explicitPickerColor } from "@/lib/chart/colorPickerEnhancement";

describe("native exact-color controls", () => {
  it("retains opaque explicit choices independently of legacy six-digit default markers", () => {
    for (const value of ["#d1d4dc", "#ffffff", "#b2b5be", "#3a3d45", "#a3a9b5", "#ABCDEF", "#000000"]) {
      expect(explicitPickerColor(value)).toBe(`${value}ff`);
      expect(parsePickerHex(explicitPickerColor(value), 1)).toEqual(parsePickerHex(value, 1));
      expect(explicitPickerColor(explicitPickerColor(value))).toBe(explicitPickerColor(value));
    }
    for (const value of ["#aabbcc80", "rgba(1,2,3,0.4)", "#abc", "invalid"]) expect(explicitPickerColor(value)).toBe(value);
  });
  it("accepts CSS hex lengths and preserves unquantized opacity when omitted", () => {
    expect(parsePickerHex(" AbC ", .37123)).toEqual({ hex: "#aabbcc", alpha: .37123 });
    expect(parsePickerHex("#ABCDEF", .7)).toEqual({ hex: "#abcdef", alpha: .7 });
    expect(parsePickerHex("#abcd", 1)).toEqual({ hex: "#aabbcc", alpha: 221 / 255 });
    expect(parsePickerHex("#12345680", 1)).toEqual({ hex: "#123456", alpha: 128 / 255 });
    expect(parsePickerHex("0000", 1)).toEqual({ hex: "#000000", alpha: 0 });
  });
  it("rejects incomplete drafts and arbitrary CSS without emitting a fallback color", () => {
    for (const value of ["", "#", "#12", "#12345", "#1234567", "#123456789", "red", "#gggggg", "rgb(1,2,3)", "##123", "12 3456"])
      expect(parsePickerHex(value, 1), value).toBeNull();
  });
  it("moves through ten-column swatches with bounded row and whole-palette shortcuts", () => {
    expect(paletteDestination(12, "ArrowRight", 80)).toBe(13);
    expect(paletteDestination(12, "ArrowDown", 80)).toBe(22);
    expect(paletteDestination(12, "ArrowUp", 80)).toBe(2);
    expect(paletteDestination(0, "ArrowLeft", 80)).toBe(0);
    expect(paletteDestination(79, "ArrowDown", 80)).toBe(79);
    expect(paletteDestination(12, "Home", 80)).toBe(10);
    expect(paletteDestination(12, "End", 80)).toBe(19);
    expect(paletteDestination(12, "Home", 80, true)).toBe(0);
    expect(paletteDestination(12, "End", 80, true)).toBe(79);
    expect(paletteDestination(12, "Enter", 80)).toBe(12);
  });
});
