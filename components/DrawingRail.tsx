"use client";
import { useEffect, useRef, useState } from "react";
import type { DrawingToolbar, Vela } from "@luxalgo/vela";
import { EyeOff, LockKeyhole, Trash2 } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { getPrimaryChart, subscribePrimaryChart } from "@/hooks/useVelaChart";
import { nativeDrawingTool } from "@/lib/drawings/preferences";
import { chartTheme } from "@/lib/chart/theme";
import { IconButton } from "./ui";
import { DrawingToolsMenu } from "./WorkspaceMenus";

/** Vela's public, workspace-docked toolbar controls whichever chart is currently active. */
export function DrawingRail() {
  const host = useRef<HTMLDivElement>(null), native = useRef<DrawingToolbar | null>(null);
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
          if (type === null) getPrimaryChart()?.drawings.setMode(null);
          state.set({ drawing: type ?? "cursor" });
        },
        snap => useChartStore.getState().set({ drawingPreferences: { ...useChartStore.getState().drawingPreferences, snap } }),
        () => { const chart = getPrimaryChart(); chart?.drawings.setMode(chart.drawings.getMode() === "measure" ? null : "measure"); },
        () => { const chart = getPrimaryChart(); chart?.drawings.setMode(chart.drawings.getMode() === "eraser" ? null : "eraser"); },
        (type, on) => {
          const state = useChartStore.getState(), favorites = state.drawingPreferences.favorites.filter(t => t !== type);
          if (on) favorites.push(type);
          state.set({ drawingPreferences: { ...state.drawingPreferences, favorites } });
        },
        stay => useChartStore.getState().set({ drawingPreferences: { ...useChartStore.getState().drawingPreferences, stay } }),
        { dock: "static", width: 52, onCollapse: setCollapsed },
      );
      rail.setDefinition(definition);
      rail.setVisible(true);
      rail.setShortcuts({ trendline: "Alt+T" });
      native.current = rail;
      setReady(true);
    }).catch(reason => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; native.current?.destroy(); native.current = null; };
  }, []);
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
    <aside className={`drawing-toolbar native-drawing-rail ${collapsed ? "is-collapsed" : ""}`} aria-label="Drawing tools">
      <div className="native-drawing-host" ref={host} />
      {error ? <span role="alert" className="drawing-load-error" title={error}>Tools unavailable</span> : null}
      <div className="drawing-rail-actions">
        <DrawingToolsMenu />
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
