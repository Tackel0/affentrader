"use client";
import type { TpoAlertCondition, TpoAlertSettings } from "@/types/tpoAlerts";
import { TIMEZONES } from "@/lib/timezones";
import { TPO_TRADING_HOURS, type TpoTradingHours } from "@/lib/orderflow/tpoTradingHours";
export function TpoAlertConditionEditor({ value, onChange }: { value: TpoAlertCondition; onChange: (value: TpoAlertCondition) => void }) {
  const patch = (settings: Partial<TpoAlertSettings>) => onChange({ ...value, settings: { ...value.settings, ...settings } });
  return <div>
    <div className="form-grid">
      <label>Session period<select aria-label="TPO session period" value={value.settings.sessionPeriod ?? "Day"} onChange={event => patch({ sessionPeriod: event.target.value as TpoAlertSettings["sessionPeriod"] })}>
        {["Day", "Week", "Month"].map(period => <option key={period}>{period}</option>)}
      </select></label>
      <label>Trading hours<select aria-label="TPO trading hours" value={value.settings.tradingHours ?? "Legacy clock"} onChange={event => patch({ tradingHours: event.target.value as TpoTradingHours })}>
        {!value.settings.tradingHours && <option value="Legacy clock" disabled>Legacy clock</option>}
        {TPO_TRADING_HOURS.map(hours => <option key={hours}>{hours}</option>)}
      </select></label>
      {value.settings.tradingHours === "Custom" && (["customStart", "customEnd"] as const).map(key => <label key={key}>{key === "customStart" ? "Custom start" : "Custom end"} (UTC HHMM)<input aria-label={`TPO ${key}`} type="number" min={0} max={2400} step={1} value={value.settings[key] ?? 0} onChange={event => patch({ [key]: Number(event.target.value) })} /></label>)}
      <label>TPO reference<select aria-label="TPO reference" value={value.level} onChange={event => onChange({ ...value, level: event.target.value as TpoAlertCondition["level"] })}>
        <option value="poc">Latest completed POC</option><option value="vah">Latest completed VAH</option><option value="val">Latest completed VAL</option>
      </select></label>
      <label>TPO direction<select aria-label="TPO direction" value={value.direction} onChange={event => onChange({ ...value, direction: event.target.value as TpoAlertCondition["direction"] })}>
        <option value="crossing">Crossing</option><option value="crossing_up">Crossing up</option><option value="crossing_down">Crossing down</option>
      </select></label>
      <label>Session time zone<select aria-label="TPO session time zone" value={value.settings.sessionZone} onChange={event => patch({ sessionZone: event.target.value })}>
        {!TIMEZONES.some(zone => zone.id === value.settings.sessionZone) && <option value={value.settings.sessionZone}>{value.settings.sessionZone}</option>}
        {TIMEZONES.map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
      </select></label>
      <label>Block length<select aria-label="TPO block length" value={value.settings.blockMinutes} onChange={event => patch({ blockMinutes: event.target.value as TpoAlertSettings["blockMinutes"] })}>
        {["5", "15", "30", "60", "240"].map(minutes => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
      </select></label>
      {([
        ["sessionStartMinutes", "Session start (minutes after midnight)", 0, 1439, 1],
        ["sessionMinutes", "Session length (minutes)", 5, 1440, 1],
        ["rowSize", "Price row size (0 = auto)", 0, 1e9, "any"],
        ["targetRows", "Auto rows per session", 20, 500, 1],
        ["valueAreaPercent", "Value area (%)", 1, 100, 1],
      ] as const).map(([key, label, min, max, step]) => <label key={key}>{label}<input aria-label={`TPO ${label}`} type="number" min={min} max={max} step={step} value={value.settings[key]} onChange={event => patch({ [key]: Number(event.target.value) })} /></label>)}
    </div>
    <label className="checkbox-row"><input type="checkbox" checked={value.settings.weekdaysOnly} onChange={event => patch({ weekdaysOnly: event.target.checked })} />TPO weekdays only</label>
    <p className="form-help">Follows the latest fully covered completed profile using these saved parameters. Later chart-setting changes do not edit this alert. Creation, source recovery and each new reference begin a fresh baseline; they do not trigger a crossing. Missing history leaves the condition unavailable.</p>
  </div>;
}
