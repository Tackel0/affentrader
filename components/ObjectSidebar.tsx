"use client";
import { X } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { DataWindow } from "./DataWindow";
import { ObjectTree } from "./ObjectTree";
import { IconButton } from "./ui";
export function ObjectSidebar({ onClose }: { onClose?: () => void } = {}) {
  const tab = useChartStore(state => state.objectPanelTab);
  return <div className="object-sidebar">
    <div className="panel-tabs" role="tablist" aria-label="Objects and chart data" onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "objects" : event.key === "End" ? "data" : tab === "objects" ? "data" : "objects";
      useChartStore.getState().set({ objectPanelTab: next });
      document.getElementById(next === "objects" ? "objects-tab" : "data-window-tab")?.focus();
    }}>
      <button type="button" role="tab" id="objects-tab" tabIndex={tab === "objects" ? 0 : -1} aria-selected={tab === "objects"} aria-controls="objects-tabpanel" className={tab === "objects" ? "active" : ""} onClick={() => useChartStore.getState().set({ objectPanelTab: "objects" })}>Object tree</button>
      <button type="button" role="tab" id="data-window-tab" tabIndex={tab === "data" ? 0 : -1} aria-selected={tab === "data"} aria-controls="data-window-tabpanel" className={tab === "data" ? "active" : ""} onClick={() => useChartStore.getState().set({ objectPanelTab: "data" })}>Data window</button>
      {onClose ? (
        <IconButton label="Close sidebar" className="object-sidebar-close" onClick={onClose}>
          <X size={16} />
        </IconButton>
      ) : null}
    </div>
    <div role="tabpanel" id={tab === "objects" ? "objects-tabpanel" : "data-window-tabpanel"} aria-labelledby={tab === "objects" ? "objects-tab" : "data-window-tab"}>
      {tab === "objects" ? <ObjectTree /> : <DataWindow />}
    </div>
  </div>;
}
