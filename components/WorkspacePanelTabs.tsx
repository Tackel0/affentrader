"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, Code2, BarChart3, Layers, Wallet, Rows3, PieChart, ListFilter, Newspaper, CalendarDays, LayoutGrid, ChevronDown, Check, Terminal } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import type { BottomTab } from "@/types/trading";
import { useDismiss } from "./WorkspaceMenus";
import { IconButton, Modal } from "./ui";

const PANELS = [
  { id: "overview", name: "Market overview", icon: Activity },
  { id: "pine", name: "Pine editor", icon: Code2 },
  { id: "strategy", name: "Strategy tester", icon: BarChart3 },
  { id: "orderflow", name: "Order flow", icon: Layers },
  { id: "trading", name: "Paper trading", icon: Wallet },
  { id: "dom", name: "DOM", icon: Rows3 },
  { id: "portfolio", name: "Portfolio", icon: PieChart },
  { id: "screener", name: "Screener", icon: ListFilter },
  { id: "terminal", name: "Terminal", icon: Terminal },
  { id: "news", name: "News", icon: Newspaper },
  { id: "calendar", name: "Calendar", icon: CalendarDays },
  { id: "heatmap", name: "Heatmap", icon: LayoutGrid },
] as const;

export function workspacePanelLabel(tab: BottomTab) {
  return PANELS.find(panel => panel.id === tab)?.name ?? "Workspace";
}

export function PhoneWorkspacePanels({ onSelect }: { onSelect: (tab: BottomTab) => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <IconButton label="More workspace panels" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <LayoutGrid size={20} />
    </IconButton>
    {open && <Modal title="Workspace-Module" className="phone-action-sheet phone-workspace-panels" onClose={() => setOpen(false)}>
      <div className="phone-panel-list">
        {PANELS.map(panel => <button type="button" key={panel.id} data-panel={panel.id} onClick={() => {
          setOpen(false);
          onSelect(panel.id);
        }}><panel.icon size={18} /><span>{panel.name}</span></button>)}
      </div>
    </Modal>}
  </>;
}

export function WorkspacePanelTabs({ children }: { children: ReactNode }) {
  const tab = useChartStore(s => s.bottomTab), open = useChartStore(s => s.bottomOpen);
  const strip = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false), [more, setMore] = useState(false);
  const [menuSpace, setMenuSpace] = useState(480);
  const ref = useDismiss(more, () => setMore(false));
  useEffect(() => {
    const node = strip.current;
    if (!node) return;
    const measure = () => {
      setOverflow(node.scrollWidth > node.clientWidth + 1);
      setMenuSpace(Math.max(60, node.getBoundingClientRect().top - 8));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node); measure();
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-panel="${tab}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab, open, overflow]);
  useEffect(() => {
    if (more) (menu.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.current?.querySelector<HTMLElement>("button"))?.focus();
  }, [more]);
  const choose = (id: BottomTab, toggle: boolean) => {
    useChartStore.getState().set({ bottomTab: id, bottomOpen: toggle && id === tab ? !open : true });
    setMore(false);
  };
  return (
    <div className="bottom-panel-tabs">
      <div className="workspace-panel-strip" ref={strip} role="toolbar" aria-label="Workspace panels" onKeyDown={event => {
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? PANELS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + PANELS.length) % PANELS.length;
        choose(PANELS[next].id, false); buttons[next].focus();
      }}>
        {PANELS.map(panel => <button key={panel.id} type="button" className={`panel-tab ${tab === panel.id && open ? "active" : ""}`}
          data-panel={panel.id} aria-pressed={tab === panel.id && open} tabIndex={tab === panel.id ? 0 : -1}
          onClick={() => choose(panel.id, true)}><panel.icon size={14} /><span>{panel.name}</span></button>)}
      </div>
      <div className="workspace-panel-controls" ref={ref}>
        {overflow || more ? <button ref={trigger} type="button" className="panel-overflow-trigger" aria-label="More workspace panels"
          aria-haspopup="menu" aria-expanded={more} onClick={() => {
            setMenuSpace(Math.max(60, (strip.current?.getBoundingClientRect().top ?? 488) - 8)); setMore(!more);
          }}>More<ChevronDown size={12} /></button> : null}
        {more ? <div ref={menu} className="tv-popover workspace-panel-menu" role="menu" aria-label="All workspace panels" style={{ maxHeight: Math.min(480, menuSpace) }} onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); setMore(false); trigger.current?.focus(); return; }
          const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
          const index = items.indexOf(event.target as HTMLButtonElement);
          if (index < 0 || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next].focus();
        }}>
          {PANELS.map(panel => <button key={panel.id} type="button" role="menuitemradio" aria-checked={tab === panel.id && open} tabIndex={-1}
            onClick={() => { choose(panel.id, false); strip.current?.querySelector<HTMLElement>(`[data-panel="${panel.id}"]`)?.focus(); }}>
            <panel.icon size={16} /><span>{panel.name}</span>{tab === panel.id && open ? <Check size={14} /> : null}
          </button>)}
        </div> : null}
        {children}
      </div>
    </div>
  );
}
