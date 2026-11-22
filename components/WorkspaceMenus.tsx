"use client";
import { useEffect, useRef, useState } from "react";
import {
  Menu,
  LayoutGrid,
  ChevronDown,
  Save,
  Sun,
  Moon,
  Plus,
  Trash2,
  Download,
  Upload,
  Search,
  PenLine,
  Grid2X2,
  Check,
  BookTemplate,
  Cloud,
  ExternalLink,
  LockKeyhole,
} from "lucide-react";
import type { DrawingTypeKey } from "@luxalgo/vela";
import { LAYOUTS, useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { useChartStore } from "@/stores/useChartStore";
import { marketService } from "@/lib/market/service";
import { usePwa } from "@/hooks/usePwa";
import { LINK_GROUPS, useLinkStore } from "@/stores/useLinkStore";
import { isPopout, openAffenTerminalWindow, openPopout } from "@/lib/windowScope";
import { Modal, IconButton } from "./ui";
import { useAlpacaStore } from "@/stores/useAlpacaStore";
import { useTradeArchiveStore } from "@/stores/useTradeArchiveStore";
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
    };
  }, [open, close]);
  return ref;
}
export function MainMenu({
  onExport,
  onImport,
}: {
  onExport: () => void;
  onImport: () => void;
}) {
  const [open, setOpen] = useState(false),
    theme = useWorkspaceStore((s) => s.theme),
    mode = useChartStore((s) => s.feedMode),
    session = useChartStore((s) => s.session),
    adjust = useChartStore((s) => s.adjustDividends);
  const pwa = usePwa();
  const linkGroup = useLinkStore((s) => s.group);
  const setLinkGroup = useLinkStore((s) => s.setGroup);
  const popout = isPopout();
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="toolbar-popover-host">
      <IconButton label="Main menu" onClick={() => setOpen(!open)}>
        <Menu size={21} />
      </IconButton>
      {open ? (
        <div className="tv-popover main-menu">
          <div className="menu-product">
            AffenTerminal<span>Pro Market &amp; Orderflow GUI</span>
          </div>
          <button onClick={() => { useAlpacaStore.setState({ open: true }); setOpen(false); }}><Cloud size={16}/>Market data connections…</button>
          <button onClick={() => { useTradeArchiveStore.setState({ open: true }); setOpen(false); }}><Download size={16}/>Local orderflow archive…</button>
          <form action="/logout" method="post"><button type="submit"><LockKeyhole size={16}/>Website sperren / Abmelden</button></form>
          <button
            onClick={() => {
              onExport();
              setOpen(false);
            }}
          >
            <Download size={16} />
            Export workspace
          </button>
          <button
            onClick={() => {
              onImport();
              setOpen(false);
            }}
          >
            <Upload size={16} />
            Import workspace
          </button>
          <button
            onClick={() => {
              useChartStore
                .getState()
                .set({ command: { id: Date.now(), kind: "csv" } });
              setOpen(false);
            }}
          >
            <Download size={16} />
            Export chart data (CSV)
          </button>
          <hr />
          <div className="popover-label">Color theme</div>
          <button
            className={theme === "light" ? "selected" : ""}
            onClick={() => useWorkspaceStore.getState().setTheme("light")}
          >
            <Sun size={16} />
            Light{theme === "light" ? <Check size={14} /> : null}
          </button>
          <button
            className={theme === "dark" ? "selected" : ""}
            onClick={() => useWorkspaceStore.getState().setTheme("dark")}
          >
            <Moon size={16} />
            Dark{theme === "dark" ? <Check size={14} /> : null}
          </button>
          <hr />
          <button onClick={() => window.location.assign("/konto")}>Konto</button>
          <button
            onClick={() => {
              useChartStore.getState().set({ syncOpen: true });
              setOpen(false);
            }}
          >
            <Cloud size={16} />
            Sync across devices…
          </button>
          <div className="popover-label">Windows</div>
          <div className="link-groups" role="radiogroup" aria-label="Link this window to others">
            {LINK_GROUPS.map((g) => (
              <button
                key={g}
                role="radio"
                aria-checked={linkGroup === g}
                className={`link-chip ${g} ${linkGroup === g ? "active" : ""}`}
                title={g === "off" ? "Not linked" : `Linked group: ${g}`}
                onClick={() => setLinkGroup(g)}
              >
                {g === "off" ? "Off" : ""}
              </button>
            ))}
          </div>
          {popout ? null : (
            <>
              <button
                onClick={() => {
                  // A new window joins a group so it follows this one straight away.
                  const group = linkGroup === "off" ? "red" : linkGroup;
                  if (linkGroup === "off") setLinkGroup("red");
                  if (!openPopout(group))
                    useChartStore.getState().toast("Pop-up blocked", "Allow pop-ups for this site to open a second window.", "error");
                  setOpen(false);
                }}
              >
                <ExternalLink size={16} />
                Open in new window
              </button>
              <button
                onClick={() => {
                  const group = linkGroup === "off" ? "red" : linkGroup;
                  if (linkGroup === "off") setLinkGroup("red");
                  if (!openAffenTerminalWindow("opps", undefined, group))
                    useChartStore.getState().toast("Pop-up blocked", "Allow pop-ups for this site to open AffenTerminal GUI.", "error");
                  setOpen(false);
                }}
              >
                <ExternalLink size={16} />
                Open AffenTerminal GUI ↗
              </button>
            </>
          )}
          <div className="popover-label">App</div>
          {pwa.installable ? (
            <button
              onClick={() => {
                void pwa.install();
                setOpen(false);
              }}
            >
              <Download size={16} />
              Install as an app
            </button>
          ) : null}
          <button
            disabled={pwa.busy || pwa.push === "unsupported" || pwa.push === "denied"}
            title={
              pwa.push === "unsupported"
                ? "Needs HTTPS or localhost and a browser with push support"
                : pwa.push === "denied"
                  ? "Notifications are blocked in the browser settings"
                  : "Server-side alerts reach this device even when the tab is closed"
            }
            onClick={() => void pwa.togglePush()}
          >
            <Check size={16} style={{ opacity: pwa.push === "on" ? 1 : 0.25 }} />
            Background notifications: {pwa.push === "on" ? "on" : pwa.push === "off" ? "off" : "unavailable"}
          </button>
          <hr />
          <div className="popover-label">Yahoo stocks, ETFs and forex</div>
          <label className="sync-option">
            Session
            <select
              aria-label="Trading session"
              value={session}
              onChange={(e) => {
                useChartStore.getState().set({ session: e.target.value as "regular" | "extended" });
                marketService.refreshYahoo();
              }}
            >
              <option value="regular">Regular hours</option>
              <option value="extended">Extended hours</option>
            </select>
          </label>
          <label className="sync-option">
            Adjust for dividends
            <input
              type="checkbox"
              aria-label="Adjust for dividends"
              checked={adjust}
              onChange={(e) => {
                useChartStore.getState().set({ adjustDividends: e.target.checked });
                marketService.refreshYahoo();
              }}
            />
          </label>
          <hr />
          <label className="sync-option">
            Market data
            <select
              aria-label="Market data mode"
              value={mode}
              onChange={(e) =>
                useChartStore
                  .getState()
                  .set({ feedMode: e.target.value as "auto" | "simulation" })
              }
            >
              <option value="auto">Live / auto</option>
              <option value="simulation">Simulation</option>
            </select>
          </label>
          <button type="button" disabled={mode === "simulation"} onClick={() => {
            marketService.reconnect();
            setOpen(false);
          }}>Reconnect market data</button>
        </div>
      ) : null}
    </div>
  );
}
export function LayoutMenu() {
  const [open, setOpen] = useState(false);
  const layout = useWorkspaceStore((s) => s.layout),
    sync = useWorkspaceStore((s) => s.sync);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="toolbar-popover-host">
      <IconButton label="Layout setup" onClick={() => setOpen(!open)}>
        <LayoutGrid size={19} />
      </IconButton>
      {open ? (
        <div className="tv-popover layout-popover">
          <div className="popover-label">Chart layout</div>
          <div className="layout-choices">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                aria-label={l.name}
                className={layout === l.id ? "selected" : ""}
                onClick={() => {
                  useWorkspaceStore.getState().setLayout(l.id);
                  setOpen(false);
                }}
              >
                <span
                  className="layout-thumbnail"
                  style={{
                    gridTemplateColumns: `repeat(${l.columns},1fr)`,
                    gridTemplateRows: `repeat(${l.rows},1fr)`,
                  }}
                >
                  {Array.from({ length: l.count }, (_, i) => (
                    <i key={i} />
                  ))}
                </span>
              </button>
            ))}
          </div>
          <hr />
          <div className="popover-label">Sync in layout</div>
          {(
            [
              { key: "symbol", label: "Symbol" },
              { key: "interval", label: "Interval" },
              { key: "crosshair", label: "Crosshair" },
              { key: "timeRange", label: "Time range" },
            ] as const
          ).map((item) => (
            <label className="sync-option" key={item.key}>
              <span>{item.label}</span>
              <input
                type="checkbox"
                checked={sync[item.key]}
                onChange={(e) =>
                  useWorkspaceStore
                    .getState()
                    .setSync(item.key, e.target.checked)
                }
              />
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
export function SavedLayoutsMenu() {
  const [open, setOpen] = useState(false),
    [form, setForm] = useState(false),
    [name, setName] = useState("");
  const layouts = useWorkspaceStore((s) => s.layouts);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="toolbar-popover-host saved-layout-control">
      <button
        className="toolbar-button"
        onClick={() => {
          setName("");
          setForm(true);
        }}
      >
        <Save size={16} />
        <span>Save</span>
      </button>
      <IconButton label="Manage layouts" onClick={() => setOpen(!open)}>
        <ChevronDown size={13} />
      </IconButton>
      {open ? (
        <div className="tv-popover saved-layout-popover">
          <div className="popover-label">Saved chart layouts</div>
          {layouts.map((l) => (
            <div key={l.id} className="saved-entry">
              <button
                onClick={() => {
                  useWorkspaceStore.getState().loadLayout(l.id);
                  setOpen(false);
                }}
              >
                <LayoutGrid size={15} />
                <span>
                  {l.name}
                  <small>
                    {LAYOUTS.find((x) => x.id === l.layout)?.count} charts ·{" "}
                    {new Date(l.savedAt).toLocaleDateString()}
                  </small>
                </span>
              </button>
              <IconButton
                label={`Delete layout ${l.name}`}
                onClick={() => useWorkspaceStore.getState().deleteLayout(l.id)}
              >
                <Trash2 size={13} />
              </IconButton>
            </div>
          ))}
          {!layouts.length ? (
            <p className="popover-help">
              Save your charts, symbols, intervals and indicators as a named
              layout.
            </p>
          ) : null}
          <button
            onClick={() => {
              setOpen(false);
              setName("");
              setForm(true);
            }}
          >
            <Plus size={16} />
            Save new layout
          </button>
        </div>
      ) : null}
      {form ? (
        <NameForm
          title="Save chart layout"
          onClose={() => setForm(false)}
          name={name}
          setName={setName}
          onSave={() => {
            useWorkspaceStore.getState().saveLayout(name);
            setForm(false);
            useChartStore.getState().toast("Layout saved", name, "success");
          }}
        />
      ) : null}
    </div>
  );
}
export function IndicatorTemplateMenu() {
  const [open, setOpen] = useState(false),
    [form, setForm] = useState(false),
    [name, setName] = useState("");
  const templates = useWorkspaceStore((s) => s.studies);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="toolbar-popover-host">
      <IconButton label="Indicator templates" onClick={() => setOpen(!open)}>
        <Grid2X2 size={18} />
      </IconButton>
      {open ? (
        <div className="tv-popover saved-layout-popover">
          <div className="popover-label">Indicator templates</div>
          {templates.map((t) => (
            <div className="saved-entry" key={t.id}>
              <button
                onClick={() => {
                  useWorkspaceStore.getState().loadStudies(t.id);
                  setOpen(false);
                }}
              >
                <BookTemplate size={15} />
                <span>
                  {t.name}
                  <small>{t.indicators.length} indicators</small>
                </span>
              </button>
              <IconButton
                label={`Delete template ${t.name}`}
                onClick={() => useWorkspaceStore.getState().deleteStudies(t.id)}
              >
                <Trash2 size={13} />
              </IconButton>
            </div>
          ))}
          <button
            onClick={() => {
              setName("");
              setOpen(false);
              setForm(true);
            }}
          >
            <Plus size={16} />
            Save indicator template
          </button>
        </div>
      ) : null}
      {form ? (
        <NameForm
          title="Save indicator template"
          onClose={() => setForm(false)}
          name={name}
          setName={setName}
          onSave={() => {
            useWorkspaceStore.getState().saveStudies(name);
            setForm(false);
          }}
        />
      ) : null}
    </div>
  );
}
function NameForm({
  title,
  onClose,
  name,
  setName,
  onSave,
}: {
  title: string;
  onClose: () => void;
  name: string;
  setName: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} className="small-modal">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <div className="form-body">
          <label>
            Name
            <input
              required
              aria-label="Template name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}
export function DrawingToolsMenu() {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [tools, setTools] = useState<
      { type: DrawingTypeKey; label: string; group: string }[]
    >([]);
  const ref = useDismiss(open, () => setOpen(false));
  useEffect(() => {
    if (open)
      void import("@luxalgo/vela").then((v) =>
        setTools(
          v
            .drawingTypes()
            .map((t) => ({ type: t.type, label: t.label, group: t.group })),
        ),
      );
  }, [open]);
  return (
    <div className="drawing-catalog-host" ref={ref}>
      <IconButton label="All drawing tools" onClick={() => setOpen(!open)}>
        <PenLine size={20} />
      </IconButton>
      {open ? (
        <div className="tv-popover drawing-catalog">
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label="Search drawing tools"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search drawing tools"
            />
          </div>
          <div className="drawing-catalog-list">
            {tools
              .filter((t) =>
                t.label.toLowerCase().includes(query.toLowerCase()),
              )
              .map((t) => (
                <button
                  key={t.type}
                  onClick={() => {
                    useChartStore.getState().set({ drawing: t.type });
                    setOpen(false);
                  }}
                >
                  <PenLine size={14} />
                  <span>{t.label}</span>
                  <small>{t.group}</small>
                </button>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

