import { describe, expect, it, vi } from "vitest";
import { ProfileTradeCollection } from "@/lib/orderflow/profileTradeCollection";
import { sessionProfileDescriptor } from "@/lib/orderflow/volumeProfileIndicator";
import { buildSessionVolumeProfiles } from "@/lib/orderflow/volumeProfileModel";
import { defaultVolumeProfile } from "@/lib/orderflow/volumeProfileSettings";
import { sessionCalendar } from "@/lib/orderflow/sessionCalendar";
import type { NativeIndicatorContext } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import type { VolumeProfileChannel } from "@/lib/orderflow/volumeProfileRenderer";
const tick = (i: number, changes: Partial<Tick> = {}): Tick => ({ id: `svp-${i}`, symbol: "HL:BTC", time: i * 1000,
  price: 100 + i % 10, quantity: 1, side: i % 2 ? "buy" : "sell", simulated: false, ...changes });
describe("collected Session Volume Profile executions", () => {
  it("retains quantities beyond the 5,000-entry market tape and matches the full batch reference", () => {
    const collection = new ProfileTradeCollection(), source = Array.from({ length: 6500 }, (_, i) => tick(i));
    collection.add(source.slice(0, 5000).reverse()); for (const trade of source.slice(5000)) collection.add([trade]);
    const style = { ...defaultVolumeProfile(), rowSize: 1 };
    expect(buildSessionVolumeProfiles(collection.snapshot(), style, "HL:BTC")).toEqual(buildSessionVolumeProfiles(source, style, "HL:BTC"));
    expect(collection.size).toBe(6500); collection.add(source.slice(-5000)); expect(collection.size).toBe(6500);
  });
  it("copies delivered executions, isolates source transitions and rejects old opposite-source deliveries", () => {
    const collection = new ProfileTradeCollection(), first = tick(0); collection.add([first]); first.quantity = 100;
    expect(collection.snapshot()[0].quantity).toBe(1); const snapshot = collection.snapshot(); expect(collection.snapshot()).toBe(snapshot);
    collection.add([tick(2, { simulated: true })]); collection.add([tick(1)]);
    expect(collection.snapshot()).toMatchObject([{ simulated: true, quantity: 1 }]); expect(collection.rejected).toBe(1);
  });
  it("keeps explicit capacity failure latched rather than reverting to the last rendered subtotal", () => {
    const collection = new ProfileTradeCollection(2); collection.add([tick(0), tick(1)]);
    expect(() => collection.add([tick(2)])).toThrow(/no observed session volume was truncated/);
    expect(collection.size).toBe(2); expect(() => collection.snapshot()).toThrow(/100,000/); expect(() => collection.add([])).toThrow(/100,000/);
  });
  it("consumes direct events, preserves observed history through settings/hide, and cancels stale subscriptions", () => {
    vi.useFakeTimers();
    try {
      const source = Array.from({ length: 6500 }, (_, i) => tick(i));
      let seed: Tick[] = source.slice(0, 5000), receive: ((tick?: Tick) => void) | undefined;
      let channel: VolumeProfileChannel | null = null;
      const instance = sessionProfileDescriptor(() => seed, (_symbol, callback) => { receive = callback; return () => { receive = undefined; }; }).create();
      const context = { symbol: "HL:BTC", live: true, emit() {}, pushData(value: VolumeProfileChannel | null) { channel = value; }, setStatus() {} } as unknown as NativeIndicatorContext;
      instance.start(context, { rowSize: 1 }); const old = receive!;
      for (const trade of source.slice(5000)) receive!(trade);
      seed = source.slice(-5000); vi.advanceTimersByTime(16); expect(channel!.current!.model!.retained).toBe(6500);
      expect(channel!.current!.model!.sessions[0].valueArea.total).toBe(6500);
      instance.setInputs({ rowSize: 2, buyColor: "#123456" }); expect(channel!.current!.model!.retained).toBe(6500);
      instance.suspend(); seed = [tick(6500)]; expect(channel).toBeNull(); instance.resume(); expect(channel!.current!.model!.retained).toBe(6501);
      old(tick(1000000)); vi.runAllTimers(); expect(channel!.current!.model!.retained).toBe(6501);
      instance.stop(); expect(channel).toBeNull(); expect(receive).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });
  it.each([
    { zone: "America/New_York", start: "2026-03-07T12:00:00Z", minutes: 1440, anchor: 570, weekdays: false },
    { zone: "America/New_York", start: "2026-10-31T12:00:00Z", minutes: 390, anchor: 570, weekdays: true },
    { zone: "Europe/Berlin", start: "2026-10-24T12:00:00Z", minutes: 60, anchor: 150, weekdays: false },
    { zone: "UTC", start: "2026-10-23T12:00:00Z", minutes: 720, anchor: 1200, weekdays: true },
  ])("keeps warmed calendar assignments identical to cold resolution across $zone boundaries", ({ zone, start, minutes, anchor, weekdays }) => {
    const style = { ...defaultVolumeProfile(), sessionZone: zone, sessionStartMinutes: anchor, sessionMinutes: minutes, weekdaysOnly: weekdays };
    const warm = sessionCalendar(style, "HL:BTC"), origin = Date.parse(start);
    const times = Array.from({ length: 50 }, (_, i) => origin + i * 90 * 60000);
    const window = warm.at(times[0]); if (window) times.push(window.start - 1, window.start, window.end - 1, window.end);
    for (const time of [...times, ...times.reverse()]) expect(warm.at(time)).toEqual(sessionCalendar(style, "HL:BTC").at(time));
  });
});
