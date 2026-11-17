import { describe, expect, it } from "vitest";
import { EXCHANGE_ZONE, LOCAL_ZONE, TIMEZONES, formatClock, isValidZone, offsetLabel, resolveZone } from "@/lib/timezones";
import { registerSymbolInfo } from "@/lib/symbolId";

describe("time zones", () => {
  it("lists only valid IANA zones", () => {
    for (const zone of TIMEZONES) expect(isValidZone(zone.id), zone.id).toBe(true);
    expect(new Set(TIMEZONES.map((z) => z.id)).size).toBe(TIMEZONES.length);
  });
  it("rejects nonsense", () => {
    expect(isValidZone("Mars/Olympus")).toBe(false);
    expect(isValidZone("")).toBe(false);
    expect(isValidZone(42)).toBe(false);
    expect(isValidZone(EXCHANGE_ZONE)).toBe(true);
    expect(isValidZone(LOCAL_ZONE)).toBe(true);
  });
  it("formats the same instant differently per zone", () => {
    const instant = new Date("2026-01-15T12:00:00Z");
    expect(formatClock("UTC", instant)).toBe("12:00:00");
    expect(formatClock("America/New_York", instant)).toBe("07:00:00");
    expect(formatClock("Asia/Tokyo", instant)).toBe("21:00:00");
  });
  it("labels offsets and follows daylight saving", () => {
    const winter = new Date("2026-01-15T12:00:00Z");
    const summer = new Date("2026-07-15T12:00:00Z");
    expect(offsetLabel("UTC", winter)).toBe("UTC");
    expect(offsetLabel("Europe/Berlin", winter)).toBe("UTC+1");
    expect(offsetLabel("Europe/Berlin", summer)).toBe("UTC+2");
    expect(offsetLabel("America/New_York", winter)).toBe("UTC-5");
    expect(offsetLabel("Asia/Kolkata", winter)).toBe("UTC+5:30");
  });
  it("resolves the exchange zone from the symbol and falls back to UTC", () => {
    registerSymbolInfo({ symbol: "YF:SIE.DE", name: "Siemens", exchange: "XETRA", currency: "EUR", type: "stock", delayed: true, timezone: "Europe/Berlin" });
    expect(resolveZone(EXCHANGE_ZONE, "YF:SIE.DE")).toBe("Europe/Berlin");
    expect(resolveZone(EXCHANGE_ZONE, "BTCUSDT")).toBe("UTC");
    expect(resolveZone(EXCHANGE_ZONE)).toBe("UTC");
    expect(resolveZone("Asia/Tokyo", "BTCUSDT")).toBe("Asia/Tokyo");
    expect(resolveZone("garbage")).toBe("UTC");
    expect(isValidZone(resolveZone(LOCAL_ZONE))).toBe(true);
  });
});
