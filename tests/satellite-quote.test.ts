import type { OHLCV, Vela } from "@luxalgo/vela";
import { expect, it, vi } from "vitest";
import { bindSatelliteQuote } from "@/lib/chart/satelliteQuote";

const bar = (time: number, close: number): OHLCV => ({ time, open: close, high: close, low: close, close });

it("keeps live and revealed Replay closes separate when history settles late", () => {
  const state = { active: false, cursorTime: null as number | null };
  const events = new Map<string, (bar?: OHLCV) => void>();
  const chart = {
    replay: { state },
    on(name: string, listener: (bar?: OHLCV) => void) {
      events.set(name, listener);
      return () => { events.delete(name); };
    },
  } as unknown as Pick<Vela, "on" | "replay">;
  const publish = vi.fn();
  const binding = bindSatelliteQuote(chart, publish);
  const history = [bar(60_000, 100), bar(120_000, 120), bar(180_000, 130)];
  events.get("bar")?.(bar(180_000, 135));
  binding.setHistory(history);
  expect(publish).toHaveBeenLastCalledWith({ close: 135, replaying: false });
  events.get("bar")?.(bar(60_000, 98));
  expect(publish).toHaveBeenLastCalledWith({ close: 135, replaying: false });

  state.active = true; state.cursorTime = 60_000;
  events.get("replay:start")?.();
  expect(publish).toHaveBeenLastCalledWith({ close: 100, replaying: true });
  state.cursorTime = 120_000;
  events.get("bar")?.(bar(120_000, 112));
  binding.setHistory(history);
  expect(publish).toHaveBeenLastCalledWith({ close: 112, replaying: true });
  state.cursorTime = 60_000;
  events.get("replay:start")?.();
  expect(publish).toHaveBeenLastCalledWith({ close: 100, replaying: true });

  state.active = false; state.cursorTime = null;
  events.get("replay:end")?.();
  expect(publish).toHaveBeenLastCalledWith({ close: 135, replaying: false });
  binding.dispose();
  expect(events.size).toBe(0);
});
