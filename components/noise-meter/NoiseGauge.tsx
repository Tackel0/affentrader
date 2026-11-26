"use client";
import type { NoiseVerdictTone } from "@/lib/terminal/noiseMeter";

export function NoiseGauge({ score, tone }: { score: number; tone: NoiseVerdictTone }) {
  const clamped = Math.max(0, Math.min(100, score));
  const angleRad = Math.PI * (1 - clamped / 100);
  const cx = 80;
  const cy = 78;
  const r = 62;
  const dotX = cx + r * Math.cos(angleRad);
  const dotY = cy - r * Math.sin(angleRad);
  const accent =
    tone === "signal"
      ? "var(--green, #10b981)"
      : tone === "noise"
        ? "var(--red, #ef4444)"
        : "#f59e0b";

  return (
    <div className={`noise-gauge tone-${tone}`} aria-label={`NoiseMeter Score ${clamped} von 100`}>
      <svg viewBox="0 0 160 96" className="noise-gauge-svg" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="noiseMeterGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
        <path
          d="M 18 78 A 62 62 0 0 1 142 78"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.14"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          d="M 18 78 A 62 62 0 0 1 142 78"
          fill="none"
          stroke="url(#noiseMeterGrad)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeOpacity="0.9"
        />
        <line
          x1={cx}
          y1={cy}
          x2={cx + (r - 12) * Math.cos(angleRad)}
          y2={cy - (r - 12) * Math.sin(angleRad)}
          stroke={accent}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r="5" fill={accent} />
        <circle cx={dotX} cy={dotY} r="6.5" fill="var(--surface, #131722)" stroke={accent} strokeWidth="3" />
      </svg>
      <div className="noise-gauge-readout">
        <strong className="mono">{clamped}</strong>
        <span>/ 100 Noise</span>
      </div>
      <div className="noise-gauge-scale">
        <span>Signal</span>
        <span>Neutral</span>
        <span>Noise</span>
      </div>
    </div>
  );
}
