"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FolderPlus,
  Lock,
  LockOpen,
  Trash2,
  ArrowUpToLine,
  ArrowDownToLine,
  Folder,
  Bell,
  Settings2,
} from "lucide-react";
import { supportsDrawingAlert } from "@/lib/alerts/drawing";
import { useChartStore } from "@/stores/useChartStore";
import { getPrimaryChart } from "@/hooks/useVelaChart";
import {
  EMPTY_TREE,
  buildTree,
  canMoveGroup,
  createGroup,
  deleteGroup,
  moveDrawings,
  moveGroup,
  prune,
  renameDrawing,
  renameGroup,
  toggleCollapsed,
  type DrawingInfo,
  type DrawingTreeState,
  type TreeNode,
} from "@/lib/drawings/tree";
import { IconButton } from "./ui";

const DRAG = "application/x-affentrader-object";

function useDrawings(): { items: DrawingInfo[]; labels: Record<string, string>; chart: ReturnType<typeof getPrimaryChart> } {
  const version = useChartStore((s) => s.drawingsVersion);
  const symbol = useChartStore((s) => s.symbol);
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    void import("@luxalgo/vela").then((v) =>
      setLabels(Object.fromEntries(v.drawingTypes().map((t) => [t.type, t.label]))),
    );
  }, []);
  const chart = getPrimaryChart();
  const items = useMemo(() => {
    if (!chart) return [];
    return [...chart.drawings.all()]
      .sort((a, b) => b.zIndex - a.zIndex)
      .map((d) => ({ id: d.id, type: d.type, visible: d.visible, locked: d.locked }));
    // `version` and `symbol` signal that the chart's drawings changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, version, symbol]);
  return { items, labels, chart };
}

export function ObjectTree() {
  const symbol = useChartStore((s) => s.symbol);
  const stored = useChartStore((s) => s.drawingTrees[s.symbol]) ?? EMPTY_TREE;
  const selected = useChartStore((s) => s.selectedDrawings);
  const indicators = useChartStore((s) => s.indicators);
  const compares = useChartStore((s) => s.compares);
  const { items, labels, chart } = useDrawings();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const tree = useMemo(() => {
    const live = new Set(items.map((d) => d.id));
    return prune(stored, live);
  }, [stored, items]);
  // Persist pruning so deleted drawings do not leave stale assignments behind.
  useEffect(() => {
    if (tree !== stored && items.length)
      useChartStore.getState().set({ drawingTrees: { ...useChartStore.getState().drawingTrees, [symbol]: tree } });
  }, [tree, stored, items.length, symbol]);
  const update = (next: DrawingTreeState) =>
    useChartStore.getState().set({ drawingTrees: { ...useChartStore.getState().drawingTrees, [symbol]: next } });
  const nodes = useMemo(() => buildTree(tree, items), [tree, items]);
  const label = (d: DrawingInfo, index?: number) =>
    tree.names[d.id] ?? `${labels[d.type] ?? d.type}${index !== undefined ? ` ${index}` : ""}`;
  const setFlag = (ids: string[], patch: { visible?: boolean; locked?: boolean }) =>
    chart?.drawings.updateMany(ids.map((id) => ({ id, patch })));
  const persistDrawings = () => {
    if (!chart) return;
    const current = useChartStore.getState();
    current.set({ drawings: { ...current.drawings, [symbol]: chart.drawings.toJSON() } });
  };
  const pick = (id: string, additive: boolean) =>
    chart?.drawings.select(
      additive ? [...new Set([...selected, id])] : [id],
    );
  const commitRename = () => {
    if (!editing) return;
    if (tree.groups.some((g) => g.id === editing)) update(renameGroup(tree, editing, draft));
    else update(renameDrawing(tree, editing, draft));
    setEditing(null);
  };
  const dropOn = (event: React.DragEvent, groupId: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const payload = event.dataTransfer.getData(DRAG);
    if (!payload) return;
    const { kind, ids } = JSON.parse(payload) as { kind: "drawing" | "group"; ids: string[] };
    if (kind === "group") update(moveGroup(tree, ids[0], groupId));
    else update(moveDrawings(tree, ids, groupId));
  };
  const allVisible = items.length > 0 && items.every((d) => d.visible);
  const allLocked = items.length > 0 && items.every((d) => d.locked);

  const renderNode = (node: TreeNode, depth: number, index: number): React.ReactNode => {
    if (node.kind === "drawing") {
      const d = node.drawing;
      const isSelected = selected.includes(d.id);
      return (
        <div
          key={d.id}
          className={`tree-row ${isSelected ? "selected" : ""} ${d.visible ? "" : "dimmed"}`}
          role="group"
          aria-label={`Drawing ${label(d, items.length - items.indexOf(d))}`}
          tabIndex={0}
          onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==="Enter"||event.key===" ")){event.preventDefault();pick(d.id,event.ctrlKey||event.metaKey||event.shiftKey);}}}
          style={{ paddingLeft: 10 + depth * 14 }}
          draggable
          onDragStart={(e) => {
            const ids = isSelected ? selected : [d.id];
            e.dataTransfer.setData(DRAG, JSON.stringify({ kind: "drawing", ids }));
          }}
          onClick={(e) => pick(d.id, e.ctrlKey || e.metaKey || e.shiftKey)}
          onDoubleClick={() => {
            setEditing(d.id);
            setDraft(tree.names[d.id] ?? "");
          }}
        >
          {editing === d.id ? (
            <input
              autoFocus
              aria-label="Rename drawing"
              value={draft}
              maxLength={60}
              placeholder={labels[d.type] ?? d.type}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => (e.key === "Enter" ? commitRename() : e.key === "Escape" && setEditing(null))}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="tree-label">{label(d, items.length - items.indexOf(d))}</span>
          )}
          <span className="tree-actions">
            <IconButton label="Drawing settings" onClick={(e) => { e.stopPropagation(); chart?.drawings.openSettings(d.id); }}>
              <Settings2 size={13} />
            </IconButton>
            <IconButton label={d.visible ? "Hide" : "Show"} onClick={(e) => (e.stopPropagation(), setFlag([d.id], { visible: !d.visible }))}>
              {d.visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </IconButton>
            <IconButton label={d.locked ? "Unlock" : "Lock"} onClick={(e) => (e.stopPropagation(), setFlag([d.id], { locked: !d.locked }))}>
              {d.locked ? <Lock size={13} /> : <LockOpen size={13} />}
            </IconButton>
            {supportsDrawingAlert(d.type) ? (
              <IconButton
                label="Create alert on drawing"
                onClick={(e) => {
                  e.stopPropagation();
                  const store = useChartStore.getState();
                  store.set({alertDraft:{drawingId:d.id,price:store.quotes[symbol]?.price??0}});
                }}
              >
                <Bell size={13} />
              </IconButton>
            ) : null}
            <IconButton label="Bring to front" onClick={(e) => (e.stopPropagation(), chart?.drawings.bringToFront(d.id), persistDrawings())}>
              <ArrowUpToLine size={13} />
            </IconButton>
            <IconButton label="Send to back" onClick={(e) => (e.stopPropagation(), chart?.drawings.sendToBack(d.id), persistDrawings())}>
              <ArrowDownToLine size={13} />
            </IconButton>
            <IconButton label="Duplicate" onClick={(e) => (e.stopPropagation(), chart?.drawings.duplicate([d.id]), persistDrawings())}>
              <Copy size={13} />
            </IconButton>
            <IconButton label="Delete" onClick={(e) => (e.stopPropagation(), chart?.drawings.removeMany([d.id]), persistDrawings())}>
              <Trash2 size={13} />
            </IconButton>
          </span>
        </div>
      );
    }
    const g = node.group;
    return (
      <div key={g.id}>
        <div
          className={`tree-row group ${dropTarget === g.id ? "drop" : ""}`}
          style={{ paddingLeft: 4 + depth * 14 }}
          draggable
          onDragStart={(e) => e.dataTransfer.setData(DRAG, JSON.stringify({ kind: "group", ids: [g.id] }))}
          onDragOver={(e) => {
            e.preventDefault();
            setDropTarget(g.id);
          }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(e) => {
            const payload = e.dataTransfer.getData(DRAG);
            if (payload && JSON.parse(payload).kind === "group" && !canMoveGroup(tree, JSON.parse(payload).ids[0], g.id)) {
              e.preventDefault();
              setDropTarget(null);
              return;
            }
            dropOn(e, g.id);
          }}
          onDoubleClick={() => {
            setEditing(g.id);
            setDraft(g.name);
          }}
        >
          <button className="caret" aria-label={g.collapsed ? "Expand" : "Collapse"} onClick={() => update(toggleCollapsed(tree, g.id))}>
            {g.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
          <Folder size={13} />
          {editing === g.id ? (
            <input
              autoFocus
              aria-label="Rename group"
              value={draft}
              maxLength={40}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => (e.key === "Enter" ? commitRename() : e.key === "Escape" && setEditing(null))}
            />
          ) : (
            <span className="tree-label">
              {g.name} <small>{node.drawingIds.length}</small>
            </span>
          )}
          <span className="tree-actions always">
            <IconButton label={node.visible === true ? "Hide group" : "Show group"} onClick={() => setFlag(node.drawingIds, { visible: node.visible !== true })}>
              {node.visible === true ? <Eye size={13} /> : <EyeOff size={13} />}
            </IconButton>
            <IconButton label={node.locked === true ? "Unlock group" : "Lock group"} onClick={() => setFlag(node.drawingIds, { locked: node.locked !== true })}>
              {node.locked === true ? <Lock size={13} /> : <LockOpen size={13} />}
            </IconButton>
            <IconButton
              label="Add selected drawings"
              disabled={!selected.length}
              onClick={() => update(moveDrawings(tree, selected, g.id))}
            >
              <FolderPlus size={13} />
            </IconButton>
            <IconButton
              label="Delete group"
              onClick={() => {
                const deleteContents = node.drawingIds.length > 0 && window.confirm(`Delete the ${node.drawingIds.length} drawings in "${g.name}" too?\nOK deletes them; Cancel keeps them and only removes the group.`);
                const result = deleteGroup(tree, g.id, deleteContents, node.drawingIds);
                if (result.removedDrawings.length) chart?.drawings.removeMany(result.removedDrawings);
                update(result.state);
                persistDrawings();
              }}
            >
              <Trash2 size={13} />
            </IconButton>
          </span>
        </div>
        {g.collapsed ? null : node.children.map((child, i) => renderNode(child, depth + 1, i))}
      </div>
    );
  };

  return (
    <>
      <div className="panel-heading">
        <strong>
          Object tree<span className="count-badge">{items.length + indicators.length}</span>
        </strong>
        <div className="flex items-center">
          <IconButton
            label="New group"
            onClick={() => {
              const result = createGroup(tree, `Group ${tree.groups.length + 1}`, null, selected);
              update(result.state);
              if (result.id) {
                setEditing(result.id);
                setDraft(`Group ${tree.groups.length + 1}`);
              }
            }}
          >
            <FolderPlus size={17} />
          </IconButton>
        </div>
      </div>
      <div className="tree-toolbar">
        <button className="link-button" disabled={!items.length} onClick={() => setFlag(items.map((d) => d.id), { visible: !allVisible })}>
          {allVisible ? "Hide all" : "Show all"}
        </button>
        <button className="link-button" disabled={!items.length} onClick={() => setFlag(items.map((d) => d.id), { locked: !allLocked })}>
          {allLocked ? "Unlock all" : "Lock all"}
        </button>
        <button
          className="link-button"
          disabled={!selected.length}
          onClick={() => {
            chart?.drawings.removeMany(selected);
            persistDrawings();
          }}
        >
          Delete selected
        </button>
        <button
          className="link-button"
          disabled={!items.length}
          onClick={() => {
            if (window.confirm(`Remove all ${items.length} drawings from ${symbol}?`)) {
              chart?.drawings.removeMany(items.map((d) => d.id));
              persistDrawings();
              update(EMPTY_TREE);
            }
          }}
        >
          Delete all
        </button>
      </div>
      <div
        className={`tree-body ${dropTarget === "root" ? "drop" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDropTarget("root");
        }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => dropOn(e, null)}
      >
        <div className="popover-label">Drawings · {symbol}</div>
        {nodes.map((n, i) => renderNode(n, 0, i))}
        {!items.length ? <div className="empty-table">No drawings yet. Pick a tool on the left toolbar.</div> : null}
        <div className="popover-label">Indicators</div>
        {indicators.map((i) => (
          <div key={i.id} className={`tree-row ${i.visible ? "" : "dimmed"}`}>
            <span className="study-dot" style={{ background: i.color }} />
            <span className="tree-label">{i.name}</span>
            <span className="tree-actions always">
              <IconButton label={i.visible ? "Hide" : "Show"} onClick={() => useChartStore.getState().updateIndicator(i.id, { visible: !i.visible })}>
                {i.visible ? <Eye size={13} /> : <EyeOff size={13} />}
              </IconButton>
              <IconButton label="Remove" onClick={() => useChartStore.getState().removeIndicator(i.id)}>
                <Trash2 size={13} />
              </IconButton>
            </span>
          </div>
        ))}
        {compares.length ? <div className="popover-label">Comparisons</div> : null}
        {compares.map((c) => (
          <div key={c.id} className={`tree-row ${c.visible ? "" : "dimmed"}`}>
            <span className="study-dot" style={{ background: c.color }} />
            <span className="tree-label">{c.label}</span>
            <span className="tree-actions always">
              <IconButton
                label={c.visible ? "Hide" : "Show"}
                onClick={() => useChartStore.getState().set({ compares: compares.map((x) => (x.id === c.id ? { ...x, visible: !x.visible } : x)) })}
              >
                {c.visible ? <Eye size={13} /> : <EyeOff size={13} />}
              </IconButton>
              <IconButton label="Remove" onClick={() => useChartStore.getState().set({ compares: compares.filter((x) => x.id !== c.id) })}>
                <Trash2 size={13} />
              </IconButton>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
