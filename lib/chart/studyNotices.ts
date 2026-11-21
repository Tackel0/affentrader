"use client";
import type { CellContext } from "./cellContext";
import { useChartStore } from "@/stores/useChartStore";
import { rangeProfileSourceStamp } from "@/lib/orderflow/executionRangeSource";
import { invalidateCanvasLayers } from "./canvasLayer";
export interface StudyNotice { id: number; cell: string; context: string; title: string; message: string; alive?: () => boolean }
export const STUDY_NOTICE_LAYER_ID = "af-study-notices";
const hosts = new Map<string, number>(), entries = new Map<object, StudyNotice>(), listeners = new Set<() => void>();
const drawingOwners = new Map<string, { cell: string; owner: object }>();
export function drawingNoticeOwner(cell: string, symbol: string, id: string): object {
  const key = JSON.stringify([cell, symbol, id]), existing = drawingOwners.get(key) ?? { cell, owner: {} };
  drawingOwners.delete(key); drawingOwners.set(key, existing);
  while (drawingOwners.size > 256) drawingOwners.delete(drawingOwners.keys().next().value!);
  return existing.owner;
}
const EMPTY: readonly StudyNotice[] = Object.freeze([]);
let snapshot: readonly StudyNotice[] = EMPTY, queued = false, sequence = 0;
function alive(entry: StudyNotice) { try { return entry.alive?.() ?? true; } catch { return false; } }
export function studyNoticeContext(cell: CellContext) { return JSON.stringify([cell, rangeProfileSourceStamp(cell.symbol, cell.timeframe)]); }
function changed(cell: string) {
  snapshot = [...entries.values()]; invalidateCanvasLayers(cell, STUDY_NOTICE_LAYER_ID);
  if (queued) return; queued = true;
  queueMicrotask(() => { queued = false; listeners.forEach(listener => listener()); });
}
export function attachStudyNoticeHost(cell: string) {
  hosts.set(cell, (hosts.get(cell) ?? 0) + 1); invalidateCanvasLayers(cell);
  return () => {
    const count = (hosts.get(cell) ?? 1) - 1;
    if (count) { hosts.set(cell, count); return; }
    hosts.delete(cell);
    for (const [owner, entry] of entries) if (entry.cell === cell) entries.delete(owner);
    for (const [key, entry] of drawingOwners) if (entry.cell === cell) drawingOwners.delete(key);
    // Switch study layers back to their standalone notice painters.
    invalidateCanvasLayers(cell);
    changed(cell);
  };
}
export function clearStudyNotice(owner: object) { const previous = entries.get(owner); if (previous) { entries.delete(owner); changed(previous.cell); } }
/** Return false for standalone/native consumers without the host's accessible detail control. */
export function routeStudyNotice(owner: object, cell: CellContext, title: string, message: string, visible?: () => boolean): boolean {
  if (!hosts.has(cell.id)) { clearStudyNotice(owner); return false; }
  if (!message) { clearStudyNotice(owner); return true; }
  const context = studyNoticeContext(cell), previous = entries.get(owner);
  if (previous?.context === context && previous.title === title && previous.message === message) { const before = alive(previous); previous.alive = visible; if (before !== alive(previous)) changed(cell.id); return true; }
  if (previous && previous.cell !== cell.id) clearStudyNotice(owner);
  entries.set(owner, { id: previous?.id ?? ++sequence, cell: cell.id, context, title, message, alive: visible });
  while (entries.size > 256) { const first = entries.keys().next().value!; const old = entries.get(first)!; entries.delete(first); if (old.cell !== cell.id) changed(old.cell); }
  changed(cell.id); return true;
}
export function currentStudyNotices(cell: CellContext, all: readonly StudyNotice[] = snapshot) {
  if (!all.length) return [];
  const context = studyNoticeContext(cell);
  return all.filter(entry => entry.cell === cell.id && entry.context === context && alive(entry));
}
export const studyNoticeStore = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => snapshot, getServerSnapshot: () => EMPTY,
};
export function drawingNoticeAlive(symbol: string, id: string, visible: () => boolean) {
  return () => { const doc = useChartStore.getState().drawings[symbol] as { drawings?: Array<{ id?: string; visible?: boolean }> } | undefined;
    return visible() && Array.isArray(doc?.drawings) && doc.drawings.some(item => item?.id === id && item.visible !== false); };
}
