"use client";
import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { X } from "lucide-react";
import { getSymbol } from "@/lib/symbols";
export function IconButton({
  label,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`icon-button ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
const modalStack: symbol[] = [];
export function Modal({
  title,
  children,
  onClose,
  className = "",
  initialFocusSelector,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  initialFocusSelector?: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    id = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const token = Symbol("modal");
    modalStack.push(token);
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const initialFocus = initialFocusSelector ? el?.querySelector<HTMLElement>(initialFocusSelector) : undefined;
    (initialFocus ?? el?.querySelector<HTMLElement>("input,textarea,select,button"))?.focus();
    const handle = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key === "Tab") {
        const focusable = Array.from(
          el?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,textarea,select,[tabindex="0"]',
          ) ?? [],
        ).filter((x) => x.offsetParent !== null);
        const first = focusable[0],
          last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle, true);
    return () => {
      const idx = modalStack.lastIndexOf(token);
      if (idx >= 0) modalStack.splice(idx, 1);
      document.removeEventListener("keydown", handle, true);
      prev?.focus();
    };
  }, [initialFocusSelector]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={`modal ${className}`}
      >
        <div className="modal-header">
          <h2 id={id}>{title}</h2>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
export function AssetBadge({
  symbol,
  size = "small",
}: {
  symbol: string;
  size?: "small" | "large";
}) {
  const asset = getSymbol(symbol);
  return (
    <span
      className={`asset-badge ${size}`}
      style={{
        background: `${asset.color}1b`,
        color: asset.color,
        borderColor: `${asset.color}35`,
      }}
    >
      {asset.base === "BTC"
        ? "₿"
        : asset.base === "ETH"
          ? "Ξ"
          : asset.base === "SOL"
            ? "≋"
            : asset.base.slice(0, 1)}
    </span>
  );
}
export function Sparkline({
  values,
  positive = true,
  width = 64,
  height = 26,
}: {
  values: number[];
  positive?: boolean;
  width?: number;
  height?: number;
}) {
  if (values.length < 2)
    return <span style={{ width, height, display: "inline-block" }} />;
  const min = Math.min(...values),
    max = Math.max(...values),
    range = max - min || max * 0.001 || 1;
  const points = values
    .map(
      (v, i) =>
        `${(i / (values.length - 1)) * width},${height - 3 - ((v - min) / range) * (height - 6)}`,
    )
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label="Recent price trend"
    >
      <polyline
        fill="none"
        stroke={positive ? "#32b99b" : "#ed6675"}
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  );
}
