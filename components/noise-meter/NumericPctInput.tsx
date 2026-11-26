"use client";
import { useEffect, useRef, useState } from "react";

function parseLocalePct(raw: string): number | null {
  const cleaned = raw.trim().replace(/\u2212/g, "-").replace(/,/g, ".");
  if (!cleaned || /^[+-]?\.?$/.test(cleaned)) return null;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDraftPct(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export interface NumericPctInputProps {
  id?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  ariaLabel: string;
  onChange: (value: number) => void;
  className?: string;
  showSteppers?: boolean;
}

/**
 * Controlled-draft percentage input that accepts German comma decimals ("-2,5"),
 * Unicode minus ("−5"), and intermediate editing states ("", "-", "-5.") without
 * prematurely snapping to 0; clamps and normalizes cleanly on blur, ArrowUp/ArrowDown,
 * or optional inline −/+ stepper buttons.
 */
export function NumericPctInput({
  id,
  value,
  min,
  max,
  step = 0.5,
  ariaLabel,
  onChange,
  className,
  showSteppers = false,
}: NumericPctInputProps) {
  const [draft, setDraft] = useState<string>(() => formatDraftPct(value));
  const focusedRef = useRef(false);
  const lastEmittedRef = useRef(value);

  useEffect(() => {
    if (!focusedRef.current || Math.abs(value - lastEmittedRef.current) > 1e-9) {
      setDraft(formatDraftPct(value));
      lastEmittedRef.current = value;
    }
  }, [value]);

  const clampVal = (n: number) => {
    const clamped = Math.max(min, Math.min(max, n));
    const rounded = Math.round(clamped * 100) / 100;
    return Object.is(rounded, -0) ? 0 : rounded;
  };

  const applyStep = (delta: number) => {
    const cur = parseLocalePct(draft) ?? value;
    const next = clampVal(cur + delta);
    lastEmittedRef.current = next;
    setDraft(formatDraftPct(next));
    onChange(next);
  };

  const inputEl = (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      aria-label={ariaLabel}
      className={className ? `noise-pct-input ${className}` : "noise-pct-input"}
      value={draft}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const parsed = parseLocalePct(raw);
        if (parsed !== null) {
          const next = clampVal(parsed);
          lastEmittedRef.current = next;
          onChange(next);
        }
      }}
      onBlur={() => {
        focusedRef.current = false;
        const parsed = parseLocalePct(draft);
        if (parsed !== null) {
          const next = clampVal(parsed);
          if (Math.abs(next - value) > 1e-9) {
            lastEmittedRef.current = next;
            onChange(next);
          }
          setDraft(formatDraftPct(next));
        } else {
          setDraft(formatDraftPct(value));
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          applyStep(e.key === "ArrowUp" ? step : -step);
        } else if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
    />
  );

  if (!showSteppers) return inputEl;

  return (
    <span className="noise-pct-stepper">
      <button
        type="button"
        className="noise-step-btn"
        aria-label={`${ariaLabel} verringern`}
        onClick={() => applyStep(-step)}
      >
        −
      </button>
      {inputEl}
      <button
        type="button"
        className="noise-step-btn"
        aria-label={`${ariaLabel} erhöhen`}
        onClick={() => applyStep(step)}
      >
        +
      </button>
    </span>
  );
}
