"use client";
import { useMemo, useState } from "react";
import { Check, Copy, Download, FileSpreadsheet, FileJson, Share2 } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { getPrimaryChart } from "@/hooks/useVelaChart";
import {
  chartDataCsv,
  chartDataFilename,
  chartDataJson,
  chartDataSourceLabel,
  filterBarsByVisibleRange,
  type ChartDataExportFormat,
  type ChartDataExportScope,
} from "@/lib/chart/chartDataCsv";
import { canShareFiles, downloadFile, shareFile } from "@/lib/files";
import { describeSymbol } from "@/lib/symbols";
import { Modal } from "./ui";

function formatShortTimestamp(ms: number): string {
  try {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  }
}

/** Modal / iOS bottom sheet for exporting chart OHLCV candles as CSV or JSON (download, copy, or native share). */
export function ChartDataExportDialog() {
  const open = useChartStore((s) => s.chartExportOpen);
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const candles = useChartStore((s) => s.candles);
  const lineage = useChartStore((s) => s.dataSources[`${s.symbol}:${s.timeframe}`]);

  const [format, setFormat] = useState<ChartDataExportFormat>("csv");
  const [scope, setScope] = useState<ChartDataExportScope>("all");
  const [copied, setCopied] = useState(false);

  const primary = open ? getPrimaryChart() : null;
  const replay = primary?.replay.state;
  const visibleRange = primary?.getVisibleRange?.() ?? null;

  const allBars = useMemo(() => {
    if (!open) return [];
    if (replay?.active && replay.cursorTime != null) {
      return candles.filter((b) => b.time <= replay.cursorTime!);
    }
    return candles;
  }, [open, candles, replay?.active, replay?.cursorTime]);

  const visibleBars = useMemo(
    () => (open ? filterBarsByVisibleRange(allBars, visibleRange) : []),
    [open, allBars, visibleRange],
  );

  const selectedBars = scope === "visible" && visibleBars.length > 0 ? visibleBars : allBars;

  const content = useMemo(() => {
    if (!open || !selectedBars.length) return "";
    return format === "csv"
      ? chartDataCsv(selectedBars, symbol, timeframe, lineage)
      : chartDataJson(selectedBars, symbol, timeframe, lineage, scope);
  }, [open, selectedBars, format, symbol, timeframe, lineage, scope]);

  const preview = useMemo(() => {
    if (!content) return "";
    const lines = content.split(/\r?\n/);
    const head = lines.slice(0, format === "csv" ? 4 : 12).join("\n");
    return lines.length > (format === "csv" ? 4 : 12) ? `${head}\n…` : head;
  }, [content, format]);

  if (!open) return null;

  const close = () => {
    setCopied(false);
    useChartStore.getState().set({ chartExportOpen: false });
  };

  const about = describeSymbol(symbol);
  const sourceLabel = chartDataSourceLabel(symbol, lineage);
  const filename = chartDataFilename(symbol, timeframe, format, scope);
  const mime = format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
  const shareSupported = canShareFiles();
  const rangeText = selectedBars.length
    ? `${formatShortTimestamp(selectedBars[0].time)} – ${formatShortTimestamp(selectedBars[selectedBars.length - 1].time)}`
    : "Keine Kerzen geladen";

  const handleDownload = () => {
    if (!selectedBars.length) return;
    downloadFile(filename, content, mime);
    useChartStore
      .getState()
      .toast("Chartdaten exportiert", `${selectedBars.length.toLocaleString("de-DE")} Kerzen als ${filename} gespeichert.`);
    close();
  };

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      useChartStore
        .getState()
        .toast("In Zwischenablage kopiert", `${selectedBars.length.toLocaleString("de-DE")} Kerzen (${format.toUpperCase()}) kopiert.`);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      useChartStore
        .getState()
        .toast("Kopieren fehlgeschlagen", "Bitte nutze Herunterladen oder Teilen.", "error");
    }
  };

  const handleShare = async () => {
    if (!selectedBars.length) return;
    const outcome = await shareFile(filename, content, mime);
    if (outcome === "shared") {
      useChartStore
        .getState()
        .toast("Chartdaten geteilt", `${selectedBars.length.toLocaleString("de-DE")} Kerzen als ${filename}.`);
      close();
    } else if (outcome === "unsupported") {
      handleDownload();
    }
  };

  return (
    <Modal title="Chartdaten exportieren" className="phone-action-sheet chart-export-modal" onClose={close}>
      <div className="chart-export-body">
        <div className="chart-export-meta">
          <strong>{about.title} · {timeframe}</strong>
          <span>{selectedBars.length.toLocaleString("de-DE")} Kerzen · {sourceLabel}</span>
          <small className="mono">{rangeText}</small>
        </div>

        <div className="chart-export-group">
          <span className="chart-export-label">Format</span>
          <div className="chart-export-seg" role="group" aria-label="Exportformat">
            <button
              type="button"
              className={format === "csv" ? "active" : ""}
              aria-pressed={format === "csv"}
              onClick={() => setFormat("csv")}
            >
              <FileSpreadsheet size={15} />
              <span>CSV (Excel / Python)</span>
            </button>
            <button
              type="button"
              className={format === "json" ? "active" : ""}
              aria-pressed={format === "json"}
              onClick={() => setFormat("json")}
            >
              <FileJson size={15} />
              <span>JSON (API / Skripte)</span>
            </button>
          </div>
        </div>

        <div className="chart-export-group">
          <span className="chart-export-label">Zeitraum</span>
          <div className="chart-export-seg" role="group" aria-label="Exportzeitraum">
            <button
              type="button"
              className={scope === "all" ? "active" : ""}
              aria-pressed={scope === "all"}
              onClick={() => setScope("all")}
            >
              <span>Alle geladen ({allBars.length.toLocaleString("de-DE")})</span>
            </button>
            <button
              type="button"
              className={scope === "visible" ? "active" : ""}
              aria-pressed={scope === "visible"}
              disabled={!visibleBars.length}
              onClick={() => setScope("visible")}
            >
              <span>Sichtbarer Ausschnitt ({visibleBars.length.toLocaleString("de-DE")})</span>
            </button>
          </div>
        </div>

        {preview ? (
          <div className="chart-export-group">
            <span className="chart-export-label">Vorschau ({filename})</span>
            <pre className="chart-export-preview mono">{preview}</pre>
          </div>
        ) : (
          <p className="form-help">Für das aktuelle Symbol sind noch keine Kerzen geladen.</p>
        )}

        <div className="chart-export-actions">
          <button
            type="button"
            className="button primary"
            disabled={!selectedBars.length}
            onClick={handleDownload}
          >
            <Download size={15} />
            <span>Herunterladen</span>
          </button>
          <button
            type="button"
            className="button"
            disabled={!selectedBars.length}
            onClick={() => void handleCopy()}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
            <span>{copied ? "Kopiert" : "Kopieren"}</span>
          </button>
          {shareSupported ? (
            <button
              type="button"
              className="button"
              disabled={!selectedBars.length}
              onClick={() => void handleShare()}
            >
              <Share2 size={15} />
              <span>Teilen</span>
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
