"use client";
import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useChartStore } from "@/stores/useChartStore";
import { attachStudyNoticeHost, currentStudyNotices, studyNoticeStore } from "@/lib/chart/studyNotices";
import { contextForCanvas } from "@/lib/chart/cellContext";
import { Modal } from "./ui";
export function ChartCoverage({ cellId, host }: { cellId: string; host: RefObject<HTMLDivElement | null> }) {
  const all = useSyncExternalStore(studyNoticeStore.subscribe, studyNoticeStore.getSnapshot, studyNoticeStore.getServerSnapshot);
  const [open, setOpen] = useState(false);
  useChartStore(state => state.marketEpochs); useChartStore(state => state.drawingsVersion); useChartStore(state => state.feedMode);
  useEffect(() => attachStudyNoticeHost(cellId), [cellId]);
  const cell = host.current ? contextForCanvas(host.current) : undefined, notices = cell ? currentStudyNotices(cell, all) : [];
  return <>
    {!!notices.length && <button className="chart-coverage" type="button" aria-label={`Data coverage (${notices.length})`} onClick={() => setOpen(true)}>Data coverage · {notices.length}</button>}
    {open && createPortal(<Modal title="Chart data coverage" onClose={() => setOpen(false)} className="small-modal chart-coverage-modal"><div className="form-body chart-coverage-details">
      <p className="form-help">{cell ? `${cell.symbol} · ${cell.timeframe}${cell.replay ? " · REPLAY" : ""}` : "Waiting for chart context"}</p>
      <p className="form-help">Current chart sources and calculation notices. Observed or estimated quantities do not establish complete exchange coverage.</p>
      {notices.length ? notices.map(notice => <section key={notice.id}><h3>{notice.title}</h3><p>{notice.message}</p></section>) : <p>No current notices for this chart.</p>}
    </div></Modal>, document.body)}
  </>;
}
