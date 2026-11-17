"use client";
import { useEffect, useRef, type FormEvent } from "react";
import type { AlertTrigger } from "@/types/alerts";
import { defaultExpiry, parseUtcInput, TRIGGER_LABELS, utcInput } from "@/lib/alerts/schedule";

export function AlertTimingFields({ trigger, expiresAt, onTrigger, onExpiry, price = false, watchlist = false, hideTrigger = false, legacyLabel = "Existing transition settings" }: {
  trigger: AlertTrigger | "legacy";
  expiresAt?: number;
  onTrigger: (trigger: AlertTrigger | "legacy") => void;
  onExpiry: (time: number | undefined) => void;
  price?: boolean;
  watchlist?: boolean;
  hideTrigger?: boolean;
  legacyLabel?: string;
}) {
  const expirationInput = useRef<HTMLInputElement>(null);
  const emittedTime = useRef(expiresAt);
  useEffect(() => {
    if (!Object.is(emittedTime.current, expiresAt)) {
      if (expirationInput.current) expirationInput.current.value = utcInput(expiresAt);
      emittedTime.current = expiresAt;
    }
  }, [expiresAt]);
  const editExpiration = (event: FormEvent<HTMLInputElement>) => {
    const time = parseUtcInput(event.currentTarget.value) ?? Number.NaN;
    if (Object.is(time, emittedTime.current)) return;
    emittedTime.current = time;
    onExpiry(time);
  };
  const options: AlertTrigger[] = price ? ["once", "every_time"] : ["once", "once_per_bar", "once_per_close", "once_per_minute"];
  if (trigger !== "legacy" && !options.includes(trigger)) options.push(trigger);
  return <div className="alert-timing-fields">
    {!hideTrigger ? <label>Trigger
      <select aria-label="Alert trigger" value={trigger} onChange={event => onTrigger(event.target.value as AlertTrigger | "legacy")}>
        {trigger === "legacy" ? <option value="legacy">{legacyLabel}</option> : null}
        {options.map(option => <option value={option} key={option}>{TRIGGER_LABELS[option]}</option>)}
      </select>
    </label> : null}
    <div className="form-grid">
      <label>Expiration (UTC)
        <input ref={expirationInput} aria-label="Expiration UTC" type="datetime-local" step={1} required={watchlist || expiresAt !== undefined} disabled={!watchlist && expiresAt === undefined}
          defaultValue={utcInput(expiresAt)} onInput={editExpiration} onChange={editExpiration} />
      </label>
      <label className="expiry-open-ended">
        <input type="checkbox" aria-label="Open-ended alert" disabled={watchlist} checked={!watchlist && expiresAt === undefined}
          onChange={event => onExpiry(event.target.checked ? undefined : defaultExpiry())} />
        Open-ended alert
      </label>
    </div>
    {watchlist ? <p className="form-help">Watchlist alerts need an expiration. Only once tracks each symbol independently.</p> : null}
    <p className="form-help">Alerts also stop after over a year without an edit or trigger. Saving an edit renews this activity period.</p>
  </div>;
}
