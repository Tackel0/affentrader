"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Activity, BookOpen, Check, Gauge, Globe2, LayoutGrid, MessagesSquare, Search, TrendingUp, Users } from "lucide-react";
import type { TerminalView } from "@/lib/terminal/commands";
import { TERMINAL_MODULE_GROUPS, TERMINAL_MODULES, type TerminalLayoutMode } from "@/lib/terminal/workspace";
import { Modal } from "./ui";

const shortcuts = ["opps", "journal", "optionsflow", "insiders"] as const;
const icons = {
  opps: TrendingUp,
  journal: BookOpen,
  optionsflow: Activity,
  insiders: Users,
  markets: Globe2,
  social: MessagesSquare,
  noise: Gauge,
};
const shortLabels: Record<TerminalView, string> = {
  opps: "Setups", journal: "Journal", optionsflow: "Optionsflow", insiders: "Insider", markets: "Märkte",
  fa: "Fundamentals", scan: "Stock bases", compare: "Compare", capm: "CAPM", macro: "Makro", social: "Social",
  noise: "NoiseMeter", news: "News", heatmap: "Heatmap", osint: "OSINT", help: "Befehle",
};

export function TerminalShortcuts({ view, onSelect }: { view: TerminalView; onSelect: (view: TerminalView) => void }) {
  const pinned: readonly TerminalView[] = shortcuts;
  const context = pinned.includes(view) ? "markets" : view;
  return <nav className="panel-tabs terminal-shortcuts" aria-label="Terminal-Schnellnavigation">
    {[...pinned, context].map(id => {
      const Icon = id in icons ? icons[id as keyof typeof icons] : LayoutGrid;
      const item = TERMINAL_MODULES.find(module => module.id === id)!;
      return <button type="button" key={id} className={view === id ? "active" : ""}
        data-terminal-view={id} aria-current={view === id ? "page" : undefined} aria-label={item.label} title={item.label}
        onClick={() => onSelect(id)}>
        <Icon size={15} aria-hidden="true" /><span>{shortLabels[id]}</span>
      </button>;
    })}
  </nav>;
}

const layouts = [
  { id: "single", label: "1 Fenster" },
  { id: "split-2", label: "2 Fenster" },
  { id: "split-3", label: "3 Fenster" },
] as const;

export function TerminalModulePicker({ view, layout, onSelect, onLayout, onClose }: {
  view: TerminalView;
  layout: TerminalLayoutMode;
  onSelect: (view: TerminalView) => void;
  onLayout: (layout: TerminalLayoutMode) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLocaleLowerCase("de-DE");
  const items = TERMINAL_MODULES.filter(item => `${item.label} ${shortLabels[item.id]} ${item.command} ${item.group}`.toLocaleLowerCase("de-DE").includes(term));
  const touch = window.matchMedia?.("(pointer: coarse)")?.matches;
  return createPortal(<Modal title="Terminal-Module" className="terminal-module-picker" onClose={onClose}
    initialFocusSelector={touch ? undefined : ".terminal-module-search input"}>
    <form className="terminal-module-search" onSubmit={event => {
      event.preventDefault();
      if (term && items[0]) onSelect(items[0].id);
    }}>
      <Search size={17} aria-hidden="true" />
      <input type="search" aria-label="Module suchen" placeholder="Modulname oder Befehl" value={query}
        onChange={event => setQuery(event.target.value)} autoComplete="off" />
    </form>
    <div className="terminal-module-groups">
      {TERMINAL_MODULE_GROUPS.map(group => {
        const groupItems = items.filter(item => item.group === group);
        if (!groupItems.length) return null;
        return <section key={group} aria-label={group}>
          <h3>{group}</h3>
          {groupItems.map(item => <button key={item.id} type="button" data-module-view={item.id}
            aria-current={item.id === view ? "page" : undefined} onClick={() => onSelect(item.id)}>
            <span>{item.label}</span><kbd>{item.command}</kbd>
            {item.id === view && <Check size={15} aria-hidden="true" />}
          </button>)}
        </section>;
      })}
      {!items.length && <p role="status" className="form-help">Kein Modul gefunden.</p>}
    </div>
    {!term && <div className="terminal-picker-layout" role="group" aria-label="Fensteraufteilung">
      {layouts.map(item => <button key={item.id} className="button small" type="button"
        aria-pressed={layout === item.id} onClick={() => onLayout(item.id)}>{item.label}</button>)}
    </div>}
  </Modal>, document.body);
}
