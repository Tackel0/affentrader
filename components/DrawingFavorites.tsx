"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DrawingTypeKey } from "@luxalgo/vela";
import { GripVertical, Minimize2, Search, Star } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { nativeDrawingTool } from "@/lib/drawings/preferences";
import { getPrimaryChart } from "@/hooks/useVelaChart";
import { Modal } from "./ui";

interface CatalogTool {
  type: DrawingTypeKey;
  label: string;
  icon: string;
}

const PRESET_FAVORITES: readonly DrawingTypeKey[] = [
  "trendline",
  "hline",
  "hray",
  "fibretracement",
  "box",
  "position",
];

function useDrawingCatalog(): CatalogTool[] {
  const [tools, setTools] = useState<CatalogTool[]>([]);
  useEffect(() => {
    let disposed = false;
    void import("@luxalgo/vela").then((vela) => {
      if (!disposed) {
        setTools(vela.drawingTypes().map((tool) => ({ type: tool.type, label: tool.label, icon: tool.icon })));
      }
    });
    return () => {
      disposed = true;
    };
  }, []);
  return tools;
}

function updateFavorites(next: DrawingTypeKey[]) {
  const state = useChartStore.getState();
  const deduped = [...new Set(next)].slice(0, 100);
  state.set({
    drawingPreferences: {
      ...state.drawingPreferences,
      favorites: deduped,
    },
  });
}

/** Free-floating translucent frosted-glass object bar inside the chart with user-starred favorite drawing tools. */
export function DrawingFavorites() {
  const favorites = useChartStore((s) => s.drawingPreferences.favorites);
  const drawing = useChartStore((s) => s.drawing);
  const tools = useDrawingCatalog();
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);

  const constrain = (x: number, y: number) => {
    const node = root.current;
    const parent = node?.parentElement;
    return {
      x: Math.max(6, Math.min(Math.max(6, (parent?.clientWidth ?? 0) - (node?.offsetWidth ?? 0) - 6), x)),
      y: Math.max(6, Math.min(Math.max(6, (parent?.clientHeight ?? 0) - (node?.offsetHeight ?? 0) - 6), y)),
    };
  };

  useEffect(() => {
    if (!root.current?.parentElement) return;
    const observer = new ResizeObserver(() => setPosition((current) => (current ? constrain(current.x, current.y) : null)));
    observer.observe(root.current.parentElement);
    return () => observer.disconnect();
  }, [favorites.length, tools.length, collapsed]);

  const selected = useMemo(
    () => favorites.flatMap((type) => {
      const tool = tools.find((item) => item.type === type);
      return tool ? [tool] : [];
    }),
    [favorites, tools],
  );

  if (!selected.length) return null;

  const activeNative = nativeDrawingTool(drawing);
  const activateTool = (type: DrawingTypeKey) => {
    if (activeNative === type) {
      getPrimaryChart()?.drawings.setMode(null);
      useChartStore.getState().set({ drawing: "cursor" });
      return;
    }
    useChartStore.getState().set({ drawing: type });
  };

  const beginDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const rect = root.current!.getBoundingClientRect();
    const parent = root.current!.parentElement!.getBoundingClientRect();
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: rect.left - parent.left,
      top: rect.top - parent.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) start.moved = true;
    setPosition(constrain(start.left + dx, start.top + dy));
  };

  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div
      ref={root}
      className={`drawing-favorites${collapsed ? " is-collapsed" : ""}`}
      role="toolbar"
      aria-label="Favorite drawing tools"
      style={position ? { left: position.x, top: position.y, bottom: "auto", transform: "none" } : undefined}
    >
      <button
        type="button"
        className="drawing-favorites-grip"
        aria-label="Move favorite drawing tools"
        title="Ziehen zum Verschieben · Pfeiltasten zum Positionieren"
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
          event.preventDefault();
          if (event.key === "Home") {
            setPosition(null);
            return;
          }
          const rect = root.current!.getBoundingClientRect();
          const parent = root.current!.parentElement!.getBoundingClientRect();
          setPosition(
            constrain(
              rect.left - parent.left + (event.key === "ArrowLeft" ? -10 : event.key === "ArrowRight" ? 10 : 0),
              rect.top - parent.top + (event.key === "ArrowUp" ? -10 : event.key === "ArrowDown" ? 10 : 0),
            ),
          );
        }}
      >
        <GripVertical size={15} />
      </button>
      {collapsed ? (
        <button
          type="button"
          className="drawing-favorites-expand"
          aria-label="Favoriten-Objektleiste ausklappen"
          title="Favoriten-Objektleiste ausklappen"
          onClick={() => setCollapsed(false)}
        >
          <Star size={15} fill="currentColor" />
          <span className="drawing-favorites-count">{selected.length}</span>
        </button>
      ) : (
        <>
          <div className="drawing-favorites-tools">
            {selected.map((tool) => (
              <button
                key={tool.type}
                type="button"
                aria-label={`Favorite: ${tool.label}`}
                title={tool.label}
                aria-pressed={activeNative === tool.type}
                onClick={() => activateTool(tool.type)}
              >
                <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: tool.icon }} />
              </button>
            ))}
          </div>
          <span className="drawing-favorites-sep" aria-hidden="true" />
          <button
            type="button"
            className="drawing-favorites-edit"
            aria-label="Objekt-Favoriten anpassen"
            title="Favoriten anpassen"
            onClick={() => useChartStore.getState().set({ drawingFavoritesOpen: true })}
          >
            <Star size={15} />
          </button>
          <button
            type="button"
            className="drawing-favorites-collapse"
            aria-label="Favoriten-Objektleiste minimieren"
            title="Leiste minimieren"
            onClick={() => setCollapsed(true)}
          >
            <Minimize2 size={14} />
          </button>
        </>
      )}
    </div>
  );
}

/** Modal / iOS sheet for selecting which drawing objects appear on the floating translucent chart bar. */
export function DrawingFavoritesPicker() {
  const open = useChartStore((s) => s.drawingFavoritesOpen);
  const favorites = useChartStore((s) => s.drawingPreferences.favorites);
  const tools = useDrawingCatalog();
  const [query, setQuery] = useState("");

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tools;
    return tools.filter(
      (tool) => tool.label.toLowerCase().includes(needle) || tool.type.toLowerCase().includes(needle),
    );
  }, [tools, query]);

  if (!open) return null;

  const close = () => {
    setQuery("");
    useChartStore.getState().set({ drawingFavoritesOpen: false });
  };

  const toggle = (type: DrawingTypeKey) => {
    if (favoriteSet.has(type)) {
      updateFavorites(favorites.filter((item) => item !== type));
    } else {
      updateFavorites([...favorites, type]);
    }
  };

  const applyPreset = () => {
    const available = new Set(tools.map((t) => t.type));
    const preset = PRESET_FAVORITES.filter((type) => available.size === 0 || available.has(type));
    updateFavorites(preset.length ? preset : tools.slice(0, 6).map((t) => t.type));
  };

  return (
    <Modal title="Objekt-Favoriten" className="phone-action-sheet drawing-favorites-modal" onClose={close}>
      <div className="drawing-favorites-picker">
        <p className="drawing-favorites-hint">
          Markierte Objekte erscheinen freischwebend und transparent direkt im Chart.
        </p>
        <div className="drawing-favorites-controls">
          <div className="drawing-favorites-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              aria-label="Zeichenobjekte filtern"
              placeholder="Objekte suchen (z. B. Trendline, Fib…)"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="drawing-favorites-quick">
            <button type="button" className="button small" onClick={applyPreset}>
              <Star size={13} /> Standard-Favoriten
            </button>
            <button
              type="button"
              className="button small"
              disabled={!favorites.length}
              onClick={() => updateFavorites([])}
            >
              Alle entfernen
            </button>
            <span className="drawing-favorites-counter">{favorites.length} aktiv</span>
          </div>
        </div>
        <div className="drawing-favorites-grid" role="group" aria-label="Verfügbare Zeichenobjekte">
          {filtered.map((tool) => {
            const active = favoriteSet.has(tool.type);
            return (
              <button
                key={tool.type}
                type="button"
                className={`drawing-favorite-option${active ? " active" : ""}`}
                aria-pressed={active}
                onClick={() => toggle(tool.type)}
              >
                <span className="drawing-favorite-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: tool.icon }} />
                <span className="drawing-favorite-label">{tool.label}</span>
                <Star size={14} className="drawing-favorite-star" fill={active ? "currentColor" : "none"} />
              </button>
            );
          })}
          {!filtered.length ? <p className="form-help">Keine passenden Zeichenobjekte gefunden.</p> : null}
        </div>
      </div>
    </Modal>
  );
}
