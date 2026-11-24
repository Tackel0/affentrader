"use client";
import { useEffect, useRef, useState } from "react";
import type { DrawingToolbar, Vela } from "@luxalgo/vela";
import { EyeOff, LockKeyhole, Star, Trash2 } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { getPrimaryChart, subscribePrimaryChart } from "@/hooks/useVelaChart";
import { nativeDrawingTool } from "@/lib/drawings/preferences";
import { chartTheme } from "@/lib/chart/theme";
import { IconButton } from "./ui";
import { DrawingToolsMenu } from "./WorkspaceMenus";

/** Vela's public, workspace-docked toolbar controls whichever chart is currently active. */
export function DrawingRail({
  id,
  phone = false,
  onRequestClose,
}: {
  id?: string;
  phone?: boolean;
  onRequestClose?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null), native = useRef<DrawingToolbar | null>(null);
  const closeRef = useRef(onRequestClose);
  closeRef.current = onRequestClose;
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  const stayExplicitRef = useRef(false);
  const [owner, setOwner] = useState<Vela | null>(null), [ready, setReady] = useState(false), [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const preferences = useChartStore(s => s.drawingPreferences), drawing = useChartStore(s => s.drawing);
  const version = useChartStore(s => s.drawingsVersion), theme = useWorkspaceStore(s => s.theme);
  useEffect(() => subscribePrimaryChart(setOwner), []);
  useEffect(() => {
    let disposed = false;
    void import("@luxalgo/vela").then(vela => {
      if (disposed || !host.current) return;
      const definition = vela.defaultToolbar();
      const rail = new vela.DrawingToolbar(host.current, chartTheme(useWorkspaceStore.getState().theme),
        type => {
          const state = useChartStore.getState();
          if (type === null) {
            getPrimaryChart()?.drawings.setMode(null);
            getPrimaryChart()?.drawings.setTool(null);
            state.set({
              drawing: "cursor",
              ...(state.drawingPreferences.stay
                ? { drawingPreferences: { ...state.drawingPreferences, stay: false } }
                : {}),
            });
            if (phoneRef.current) closeRef.current?.();
            return;
          }
          const clearStaleStay =
            phoneRef.current && !stayExplicitRef.current && state.drawingPreferences.stay;
          state.set({
            drawing: type,
            ...(clearStaleStay
              ? { drawingPreferences: { ...state.drawingPreferences, stay: false } }
              : {}),
          });
          if (phoneRef.current) closeRef.current?.();
        },
        snap => useChartStore.getState().set({ drawingPreferences: { ...useChartStore.getState().drawingPreferences, snap } }),
        () => {
          const chart = getPrimaryChart();
          const next = chart?.drawings.getMode() === "measure" ? null : "measure";
          chart?.drawings.setMode(next);
          if (phoneRef.current && next) closeRef.current?.();
        },
        () => {
          const chart = getPrimaryChart();
          const next = chart?.drawings.getMode() === "eraser" ? null : "eraser";
          chart?.drawings.setMode(next);
          if (phoneRef.current && next) closeRef.current?.();
        },
        (type, on) => {
          const state = useChartStore.getState(), favorites = state.drawingPreferences.favorites.filter(t => t !== type);
          if (on) favorites.push(type);
          state.set({ drawingPreferences: { ...state.drawingPreferences, favorites } });
        },
        stay => {
          stayExplicitRef.current = stay;
          useChartStore.getState().set({ drawingPreferences: { ...useChartStore.getState().drawingPreferences, stay } });
        },
        { dock: "static", width: phoneRef.current ? 48 : 52, onCollapse: setCollapsed },
      );
      rail.setDefinition(definition);
      rail.setVisible(true);
      rail.setShortcuts({ trendline: "Alt+T" });
      native.current = rail;
      setReady(true);
    }).catch(reason => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; native.current?.destroy(); native.current = null; };
  }, []);

  // Touch-first ergonomics on phone/coarse pointers:
  // 1) Tapping any multi-tool category icon opens its flyout submenu directly (no impossible 11px hover chevron).
  // 2) Clamp any open flyout inside the visible safe viewport so it never overlaps the bottom dock or clips off-screen.
  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const handleCaptureClick = (event: MouseEvent) => {
      const isCoarse =
        phoneRef.current ||
        (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches);
      if (!isCoarse) return;
      const target = event.target as HTMLElement | null;
      const iconBtn = target?.closest(".vela-dtb-icon");
      if (!iconBtn) return;
      const cell = iconBtn.closest(".vela-dtb-cell");
      const arrow = cell?.querySelector<HTMLButtonElement>(".vela-dtb-arrow");
      if (!arrow) return;
      event.preventDefault();
      event.stopPropagation();
      arrow.click();
    };

    const clampFlyouts = () => {
      const flyouts = el.querySelectorAll<HTMLElement>(".vela-dtb-flyout");
      if (!flyouts.length) return;
      const hostRect = el.getBoundingClientRect();
      const topPad = phoneRef.current ? 12 : 8;
      const bottomDockReserve = phoneRef.current ? 74 : 16;
      const viewportTop = Math.max(topPad, hostRect.top);
      const viewportBottom = Math.max(viewportTop + 180, window.innerHeight - bottomDockReserve);
      const maxH = Math.min(phoneRef.current ? 360 : 480, Math.max(160, viewportBottom - viewportTop));
      for (const fly of flyouts) {
        fly.style.maxHeight = `${maxH}px`;
        if (phoneRef.current) {
          fly.style.left = `${hostRect.width + 8}px`;
        }
        const flyRect = fly.getBoundingClientRect();
        const naturalH = Math.min(fly.scrollHeight || flyRect.height || 240, maxH);
        const currentTopAbs = hostRect.top + (parseFloat(fly.style.top) || 0);
        let clampedAbs = currentTopAbs;
        if (clampedAbs + naturalH > viewportBottom) {
          clampedAbs = Math.max(viewportTop, viewportBottom - naturalH);
        }
        if (clampedAbs < viewportTop) {
          clampedAbs = viewportTop;
        }
        fly.style.top = `${Math.round(clampedAbs - hostRect.top)}px`;
      }
    };

    el.addEventListener("click", handleCaptureClick, true);
    const observer = new MutationObserver(() => {
      requestAnimationFrame(clampFlyouts);
    });
    observer.observe(el, { childList: true });
    return () => {
      el.removeEventListener("click", handleCaptureClick, true);
      observer.disconnect();
    };
  }, [ready]);

  useEffect(() => { native.current?.setTheme(chartTheme(theme)); }, [theme, ready]);
  useEffect(() => {
    const rail = native.current;
    if (!rail) return;
    for (const type of Object.values(preferences.lastTools)) rail.setActiveTool(type);
    rail.setActiveTool(nativeDrawingTool(drawing));
  }, [preferences.lastTools, drawing, ready]);
  useEffect(() => {
    const rail = native.current;
    if (!rail) return;
    rail.setMagnetMode(preferences.snap);
    rail.setStayMode(preferences.stay);
    rail.setFavorites(preferences.favorites);
  }, [preferences.snap, preferences.stay, preferences.favorites, ready]);
  useEffect(() => {
    if (!owner) return;
    const sync = () => {
      native.current?.setMeasureActive(owner.drawings.getMode() === "measure");
      native.current?.setEraserActive(owner.drawings.getMode() === "eraser");
    };
    sync();
    return owner.on("drawing:mode", sync);
  }, [owner, ready]);
  // DrawingsVersion changes on native create/edit/remove and keeps the batch controls current.
  const drawings = owner && version >= 0 ? owner.drawings.all() : [];
  const locked = drawings.length > 0 && drawings.every(doc => doc.locked), hidden = drawings.length > 0 && drawings.every(doc => doc.visible === false);
  const batch = (field: "locked" | "visible", value: boolean) => owner?.drawings.updateMany(drawings.map(doc => ({ id: doc.id, patch: { [field]: value } })));
  return (
    <aside id={id} className={`drawing-toolbar native-drawing-rail ${collapsed ? "is-collapsed" : ""}`} aria-label="Drawing tools">
      <div className="native-drawing-host" ref={host} />
      {error ? <span role="alert" className="drawing-load-error" title={error}>Tools unavailable</span> : null}
      <div className="drawing-rail-actions">
        <IconButton
          label="Objekt-Favoriten anpassen"
          className={preferences.favorites.length ? "active drawing-favorites-trigger" : "drawing-favorites-trigger"}
          aria-pressed={preferences.favorites.length > 0}
          onClick={() => useChartStore.getState().set({ drawingFavoritesOpen: true })}
        >
          <Star size={18} fill={preferences.favorites.length ? "currentColor" : "none"} />
        </IconButton>
        <DrawingToolsMenu onSelect={phone ? () => closeRef.current?.() : undefined} />
        <IconButton label={locked ? "Unlock all drawings" : "Lock all drawings"} aria-pressed={locked} className={locked ? "active" : ""}
          disabled={!drawings.length} onClick={() => batch("locked", !locked)}><LockKeyhole size={19} /></IconButton>
        <IconButton label={hidden ? "Show all drawings" : "Hide all drawings"} aria-pressed={hidden} className={hidden ? "active" : ""}
          disabled={!drawings.length} onClick={() => batch("visible", hidden)}><EyeOff size={19} /></IconButton>
        <IconButton label="Remove all drawings" disabled={!drawings.length}
          onClick={() => owner?.drawings.removeMany(drawings.map(doc => doc.id))}><Trash2 size={19} /></IconButton>
      </div>
    </aside>
  );
}
