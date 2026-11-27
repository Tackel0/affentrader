"use client";
import { useId } from "react";

export interface AffenMarkProps {
  size?: number;
  variant?: "icon" | "tile";
  className?: string;
}

/**
 * Minimalist geometric AffenTerminal brand mark — brushed titanium primate crest
 * with signature amber-gold bullish apex on OLED obsidian dark.
 */
export function AffenMark({
  size = 24,
  variant = "icon",
  className,
}: AffenMarkProps) {
  const uid = useId().replace(/:/g, "");
  const bgId = `am-bg-${uid}`;
  const metalId = `am-metal-${uid}`;
  const amberId = `am-amber-${uid}`;
  const rimId = `am-rim-${uid}`;

  if (variant === "tile") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
      >
        <defs>
          <radialGradient id={bgId} cx="50%" cy="14%" r="86%">
            <stop offset="0%" stopColor="#1B202C" />
            <stop offset="56%" stopColor="#0A0C12" />
            <stop offset="100%" stopColor="#040508" />
          </radialGradient>
          <linearGradient id={metalId} x1="20%" y1="10%" x2="80%" y2="92%">
            <stop offset="0%" stopColor="#F8FAFD" />
            <stop offset="55%" stopColor="#CFD6E3" />
            <stop offset="100%" stopColor="#8892A6" />
          </linearGradient>
          <linearGradient id={amberId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFD66B" />
            <stop offset="50%" stopColor="#FF9E00" />
            <stop offset="100%" stopColor="#D97200" />
          </linearGradient>
          <linearGradient id={rimId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.24" />
            <stop offset="55%" stopColor="#FFFFFF" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#FF9E00" stopOpacity="0.28" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="14.5" fill={`url(#${bgId})`} />
        <rect
          x="0.75"
          y="0.75"
          width="62.5"
          height="62.5"
          rx="13.8"
          stroke={`url(#${rimId})`}
          strokeWidth="1"
        />
        <path
          d="M18.6 27.6 C13 27.6 12 34.4 17 36.4"
          stroke={`url(#${metalId})`}
          strokeWidth="2.9"
          strokeLinecap="round"
        />
        <path
          d="M45.4 27.6 C51 27.6 52 34.4 47 36.4"
          stroke={`url(#${metalId})`}
          strokeWidth="2.9"
          strokeLinecap="round"
        />
        <path
          d="M17.5 29 C17.5 17.5 23.2 13 32 13 C40.8 13 46.5 17.5 46.5 29 C46.5 35.5 44.5 41.5 42 45.5 C39.4 49.6 35.8 51.5 32 51.5 C28.2 51.5 24.6 49.6 22 45.5 C19.5 41.5 17.5 35.5 17.5 29 Z"
          fill={`url(#${metalId})`}
        />
        <path
          d="M21.8 27.8 C21.8 22.8 25.4 20.6 29.2 22.2 C30.6 22.8 31.4 23.7 32 24.6 C32.6 23.7 33.4 22.8 34.8 22.2 C38.6 20.6 42.2 22.8 42.2 27.8 C42.2 30.8 40.7 32.8 39 34 C41.2 35.6 42.4 38.2 41.8 41.4 C40.9 45.6 37 48.2 32 48.2 C27 48.2 23.1 45.6 22.2 41.4 C21.6 38.2 22.8 35.6 25 34 C23.3 32.8 21.8 30.8 21.8 27.8 Z"
          fill="#090B11"
        />
        <circle cx="27.2" cy="28.2" r="2.1" fill={`url(#${amberId})`} />
        <circle cx="36.8" cy="28.2" r="2.1" fill={`url(#${amberId})`} />
        <path
          d="M29.3 37.8 L32 35.1 L34.7 37.8"
          stroke={`url(#${amberId})`}
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1="28.2"
          y1="43"
          x2="35.8"
          y2="43"
          stroke="#CFD6E3"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeOpacity="0.65"
        />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M17.5 27.6 C11 27.6 10 35.4 15.6 37.6"
        stroke="currentColor"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      <path
        d="M46.5 27.6 C53 27.6 54 35.4 48.4 37.6"
        stroke="currentColor"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      <path
        d="M16 29 C16 16.5 22.4 11.5 32 11.5 C41.6 11.5 48 16.5 48 29 C48 36 45.8 42.4 43 46.8 C40.2 51.2 36.2 53.2 32 53.2 C27.8 53.2 23.8 51.2 21 46.8 C18.2 42.4 16 36 16 29 Z"
        stroke="currentColor"
        strokeWidth="3.6"
        strokeLinejoin="round"
      />
      <circle cx="26.4" cy="28" r="2.6" fill="var(--accent, #ff9e00)" />
      <circle cx="37.6" cy="28" r="2.6" fill="var(--accent, #ff9e00)" />
      <path
        d="M28.6 38.6 L32 35.2 L35.4 38.6"
        stroke="var(--accent, #ff9e00)"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="27.4"
        y1="44.4"
        x2="36.6"
        y2="44.4"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeOpacity="0.7"
      />
    </svg>
  );
}
