"use client";
import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { X } from "lucide-react";
import { getSymbol } from "@/lib/symbols";
import { assetIconUrl } from "@/lib/assetIcon";
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
    const FOCUSABLE_SELECTOR =
      'a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex]:not([tabindex="-1"])';
    const isVisibleFocusable = (node: HTMLElement) => {
      if (node.hidden || node.closest("[hidden]")) return false;
      const style = window.getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    const initialFocus = initialFocusSelector ? el?.querySelector<HTMLElement>(initialFocusSelector) : undefined;
    (initialFocus ?? el?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR))?.focus();
    const handle = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key === "Tab") {
        const focusable = Array.from(el?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []).filter(isVisibleFocusable);
        if (!focusable.length) {
          e.preventDefault();
          return;
        }
        const first = focusable[0],
          last = focusable.at(-1)!;
        const active = document.activeElement as HTMLElement | null;
        if (!active || !el?.contains(active)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handle, true);
    return () => {
      const idx = modalStack.lastIndexOf(token);
      if (idx >= 0) modalStack.splice(idx, 1);
      document.removeEventListener("keydown", handle, true);
      if (prev?.isConnected) prev.focus();
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
const loadedAssetIcons = new Set<string>();
const failedAssetIcons = new Set<string>();

export const AssetBadge = memo(function AssetBadge({
  symbol,
  size = "small",
}: {
  symbol: string;
  size?: "xs" | "small" | "large";
}) {
  const asset = getSymbol(symbol);
  const src = assetIconUrl(symbol);
  const [state, setState] = useState<"idle" | "loaded" | "error">(() =>
    loadedAssetIcons.has(src) ? "loaded" : failedAssetIcons.has(src) ? "error" : "idle",
  );
  useEffect(() => {
    setState(loadedAssetIcons.has(src) ? "loaded" : failedAssetIcons.has(src) ? "error" : "idle");
  }, [src]);
  const fallback =
    asset.base === "BTC"
      ? "₿"
      : asset.base === "ETH"
        ? "Ξ"
        : asset.base === "SOL"
          ? "≋"
          : asset.base.slice(0, 1);
  return (
    <span
      className={`asset-badge ${size}${state === "loaded" ? " has-image" : ""}`}
      style={{
        background: `${asset.color}1b`,
        color: asset.color,
        borderColor: `${asset.color}35`,
      }}
    >
      <span className="asset-badge-fallback" aria-hidden="true">{fallback}</span>
      {state !== "error" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt=""
          aria-hidden="true"
          className="asset-badge-img"
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => {
            loadedAssetIcons.add(src);
            setState("loaded");
          }}
          onError={() => {
            failedAssetIcons.add(src);
            setState("error");
          }}
        />
      ) : null}
    </span>
  );
});
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
