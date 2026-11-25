"use client";
import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { attachStudyNoticeHost, currentStudyNotices, studyNoticeStore } from "@/lib/chart/studyNotices";
import { contextForCanvas, type CellContext } from "@/lib/chart/cellContext";
import { Modal } from "./ui";

const cellReaders = new Map<string, () => CellContext | undefined>();
const cellListeners = new Set<() => void>();
const modalOpeners = new Map<string, () => void>();

function notifyCellReaders() {
  cellListeners.forEach((fn) => fn());
}

export function openChartCoverageModal(cellId = "primary") {
  modalOpeners.get(cellId)?.();
}

function useActiveNotices(cellId = "primary") {
  const all = useSyncExternalStore(
    studyNoticeStore.subscribe,
    studyNoticeStore.getSnapshot,
    studyNoticeStore.getServerSnapshot,
  );
  const [cellEpoch, setCellEpoch] = useState(0);
  useChartStore((state) => state.marketEpochs);
  useChartStore((state) => state.drawingsVersion);
  useChartStore((state) => state.feedMode);
  useChartStore((state) => state.symbol);
  useChartStore((state) => state.timeframe);
  useChartStore((state) => state.chartType);
  useEffect(() => {
    const bump = () => setCellEpoch((n) => n + 1);
    cellListeners.add(bump);
    return () => {
      cellListeners.delete(bump);
    };
  }, []);
  void cellEpoch;
  const cell = cellReaders.get(cellId)?.();
  const notices = cell ? currentStudyNotices(cell, all) : [];
  return { cell, notices };
}

/**
 * Registers a chart cell as a study-notice host and renders the coverage modal
 * strictly on demand (triggered from the `···` menu) — never floating over candles.
 */
export function ChartCoverage({ cellId, host }: { cellId: string; host: RefObject<HTMLDivElement | null> }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const reader = () => (host.current ? contextForCanvas(host.current) : undefined);
    const opener = () => setOpen(true);
    cellReaders.set(cellId, reader);
    modalOpeners.set(cellId, opener);
    notifyCellReaders();
    const detach = attachStudyNoticeHost(cellId);
    return () => {
      detach();
      if (cellReaders.get(cellId) === reader) {
        cellReaders.delete(cellId);
        notifyCellReaders();
      }
      if (modalOpeners.get(cellId) === opener) modalOpeners.delete(cellId);
    };
  }, [cellId, host]);

  if (!open) return null;
  return <ChartCoverageModal cellId={cellId} onClose={() => setOpen(false)} />;
}

function ChartCoverageModal({ cellId, onClose }: { cellId: string; onClose: () => void }) {
  const { cell, notices } = useActiveNotices(cellId);
  return createPortal(
    <Modal title="Chart data coverage" onClose={onClose} className="small-modal chart-coverage-modal">
      <div className="form-body chart-coverage-details">
        <p className="form-help">
          {cell ? `${cell.symbol} · ${cell.timeframe}${cell.replay ? " · REPLAY" : ""}` : "Waiting for chart context"}
        </p>
        <p className="form-help">
          Current chart sources and calculation notices. Observed or estimated quantities do not establish complete
          exchange coverage.
        </p>
        {notices.length ? (
          notices.map((notice) => (
            <section key={notice.id}>
              <h3>{notice.title}</h3>
              <p>{notice.message}</p>
            </section>
          ))
        ) : (
          <p>No current notices for this chart.</p>
        )}
      </div>
    </Modal>,
    document.body,
  );
}

/**
 * On-demand menu entry inside the chart overflow hub (`···`) that opens the
 * Data coverage modal only when active orderflow/profile studies report notices.
 */
export function ChartCoverageMenuItem({
  cellId = "primary",
  onSelect,
}: {
  cellId?: string;
  onSelect?: () => void;
}) {
  const { notices } = useActiveNotices(cellId);
  if (!notices.length) return null;
  return (
    <button
      className="chart-coverage chart-coverage-menu-item"
      type="button"
      aria-label={`Data coverage (${notices.length})`}
      onClick={() => {
        onSelect?.();
        openChartCoverageModal(cellId);
      }}
    >
      <Info size={18} />
      <span>Data coverage · {notices.length}</span>
    </button>
  );
}
