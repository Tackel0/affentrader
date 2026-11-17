"use client";
import { useEffect, useRef, useState } from "react";
import type { DrawingTypeKey } from "@luxalgo/vela";
import { GripVertical } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { nativeDrawingTool } from "@/lib/drawings/preferences";

export function DrawingFavorites() {
  const favorites = useChartStore(s => s.drawingPreferences.favorites), drawing = useChartStore(s => s.drawing);
  const [tools, setTools] = useState<{ type: DrawingTypeKey; label: string; icon: string }[]>([]);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLDivElement>(null), drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  useEffect(() => {
    let disposed = false;
    void import("@luxalgo/vela").then(vela => {
      if (!disposed) setTools(vela.drawingTypes().map(tool => ({ type: tool.type, label: tool.label, icon: tool.icon })));
    });
    return () => { disposed = true; };
  }, []);
  const constrain = (x: number, y: number) => {
    const node = root.current, parent = node?.parentElement;
    return { x: Math.max(4, Math.min(Math.max(4, (parent?.clientWidth ?? 0) - (node?.offsetWidth ?? 0) - 4), x)),
      y: Math.max(4, Math.min(Math.max(4, (parent?.clientHeight ?? 0) - (node?.offsetHeight ?? 0) - 4), y)) };
  };
  useEffect(() => {
    if (!root.current?.parentElement) return;
    const observer = new ResizeObserver(() => setPosition(current => current ? constrain(current.x, current.y) : null));
    observer.observe(root.current.parentElement);
    return () => observer.disconnect();
  }, [favorites.length, tools.length]);
  const selected = favorites.flatMap(type => { const tool = tools.find(item => item.type === type); return tool ? [tool] : []; });
  if (!selected.length) return null;
  return <div ref={root} className="drawing-favorites" role="toolbar" aria-label="Favorite drawing tools"
    style={position ? { left: position.x, top: position.y, transform: "none" } : undefined}>
    <button className="drawing-favorites-grip" aria-label="Move favorite drawing tools" title="Drag to move · arrow keys to position"
      onPointerDown={event => {
        const rect = root.current!.getBoundingClientRect(), parent = root.current!.parentElement!.getBoundingClientRect();
        drag.current = { x: event.clientX, y: event.clientY, left: rect.left - parent.left, top: rect.top - parent.top };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={event => {
        const start = drag.current;
        if (start && event.buttons === 1) setPosition(constrain(start.left + event.clientX - start.x, start.top + event.clientY - start.y));
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Home") { setPosition(null); return; }
        const rect = root.current!.getBoundingClientRect(), parent = root.current!.parentElement!.getBoundingClientRect();
        setPosition(constrain(rect.left - parent.left + (event.key === "ArrowLeft" ? -10 : event.key === "ArrowRight" ? 10 : 0),
          rect.top - parent.top + (event.key === "ArrowUp" ? -10 : event.key === "ArrowDown" ? 10 : 0)));
      }}><GripVertical size={16} /></button>
    <div className="drawing-favorites-tools">
      {selected.map(tool => <button key={tool.type} aria-label={`Favorite: ${tool.label}`} title={tool.label}
        aria-pressed={nativeDrawingTool(drawing) === tool.type} onClick={() => useChartStore.getState().set({ drawing: tool.type })}>
        <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: tool.icon }} />
      </button>)}
    </div>
  </div>;
}
