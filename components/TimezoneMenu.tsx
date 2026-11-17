"use client";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { EXCHANGE_ZONE, LOCAL_ZONE, TIMEZONES, formatClock, offsetLabel, resolveZone } from "@/lib/timezones";
import { symbolInfo } from "@/lib/symbolId";
import { useDismiss } from "./WorkspaceMenus";

/** Clock and display time zone picker for the chart's time axis, crosshair and tooltips. */
export function TimezoneMenu() {
  const choice = useChartStore((s) => s.timezone);
  const symbol = useChartStore((s) => s.symbol);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const ref = useDismiss(open, () => setOpen(false));
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const zone = resolveZone(choice, symbol);
  const exchangeZone = symbolInfo(symbol)?.timezone;
  const pick = (value: string) => {
    useChartStore.getState().set({ timezone: value });
    setOpen(false);
  };
  return (
    <div ref={ref} className="timezone-host">
      <button className="mono utc-clock" aria-haspopup="menu" aria-expanded={open} aria-label="Chart time zone" onClick={() => setOpen(!open)}>
        {now ? formatClock(zone, now) : "--:--:--"} ({now ? offsetLabel(zone, now) : "UTC"})
      </button>
      {open ? (
        <div className="tv-popover timezone-menu" role="menu">
          <button role="menuitemradio" aria-checked={choice === LOCAL_ZONE} onClick={() => pick(LOCAL_ZONE)}>
            Local time {choice === LOCAL_ZONE ? <Check size={13} /> : null}
          </button>
          <button role="menuitemradio" aria-checked={choice === EXCHANGE_ZONE} onClick={() => pick(EXCHANGE_ZONE)}>
            Exchange time {exchangeZone ? `· ${exchangeZone.split("/").pop()?.replace(/_/g, " ")}` : "· UTC for this market"}
            {choice === EXCHANGE_ZONE ? <Check size={13} /> : null}
          </button>
          <hr />
          {TIMEZONES.map((z) => (
            <button key={z.id} role="menuitemradio" aria-checked={choice === z.id} onClick={() => pick(z.id)}>
              <span>
                {z.label} <small>{now ? offsetLabel(z.id, now) : ""}</small>
              </span>
              {choice === z.id ? <Check size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
