"use client";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import type {
  PatternMatch,
  PatternStudyResult,
  PriorWindowDays,
} from "@/lib/terminal/noiseMeter";
import { fmtPct, fmtSigned2, type MatchSortKey, type PatternMode } from "./constants";

export interface PatternMatchesTableProps {
  patternStudy: PatternStudyResult;
  sortedMatches: PatternMatch[];
  patternMode: PatternMode;
  priorWindowDays: PriorWindowDays;
  patternLookbackDays: 2 | 3 | 4 | 5;
  matchSort: { key: MatchSortKey; dir: "asc" | "desc" };
  showAllPatternMatches: boolean;
  onToggleMatchSort: (key: MatchSortKey) => void;
  onExportCsv: () => void;
  onToggleShowAll: () => void;
}

export function PatternMatchesTable({
  patternStudy,
  sortedMatches,
  patternMode,
  priorWindowDays,
  patternLookbackDays,
  matchSort,
  showAllPatternMatches,
  onToggleMatchSort,
  onExportCsv,
  onToggleShowAll,
}: PatternMatchesTableProps) {
  const visibleMatches = showAllPatternMatches ? sortedMatches : sortedMatches.slice(0, 15);

  return (
    <div className="noise-table-wrap noise-t1-twins">
      <div className="noise-pattern-table-head">
        <h4>
          Alle historischen Treffer ({patternStudy.matches.length})
          {patternStudy.minGapDays > 0 && patternStudy.rawSampleSize > patternStudy.sampleSize
            ? ` · entclustert aus ${patternStudy.rawSampleSize}`
            : ""}
        </h4>
        <div className="noise-pattern-table-actions">
          <button
            type="button"
            className="noise-mini-btn"
            title="Alle Treffer als CSV herunterladen"
            onClick={onExportCsv}
          >
            <Download size={12} />
            <span>CSV</span>
          </button>
          {patternStudy.matches.length > 15 ? (
            <button
              type="button"
              className="noise-mini-btn"
              onClick={onToggleShowAll}
            >
              {showAllPatternMatches
                ? "Kompakt (15)"
                : `Alle ${patternStudy.matches.length} anzeigen`}
            </button>
          ) : null}
        </div>
      </div>
      <table className="noise-table">
        <thead>
          <tr>
            {(
              [
                ["session", "Datum (Tag 0)"],
              ] as const
            ).map(([key, label]) => (
              <th key={key}>
                <button
                  type="button"
                  className={`noise-sort-btn${matchSort.key === key ? " active" : ""}`}
                  onClick={() => onToggleMatchSort(key)}
                >
                  <span>{label}</span>
                  {matchSort.key === key ? (
                    matchSort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                  ) : null}
                </button>
              </th>
            ))}
            {patternMode === "leadup" ? (
              <th>
                <button
                  type="button"
                  className={`noise-sort-btn${matchSort.key === "priorWindowPct" ? " active" : ""}`}
                  onClick={() => onToggleMatchSort("priorWindowPct")}
                >
                  <span>Vor-{priorWindowDays}T</span>
                  {matchSort.key === "priorWindowPct" ? (
                    matchSort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                  ) : null}
                </button>
              </th>
            ) : (
              <>
                {patternLookbackDays >= 5 ? <th>Tag −4</th> : null}
                {patternLookbackDays >= 4 ? <th>Tag −3</th> : null}
                {patternLookbackDays >= 3 ? <th>Tag −2</th> : null}
                <th>
                  <button
                    type="button"
                    className={`noise-sort-btn${matchSort.key === "prevDayPct" ? " active" : ""}`}
                    onClick={() => onToggleMatchSort("prevDayPct")}
                  >
                    <span>Tag −1</span>
                    {matchSort.key === "prevDayPct" ? (
                      matchSort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                    ) : null}
                  </button>
                </th>
              </>
            )}
            {(
              [
                ["day0Pct", "Tag 0"],
              ] as const
            ).map(([key, label]) => (
              <th key={key}>
                <button
                  type="button"
                  className={`noise-sort-btn${matchSort.key === key ? " active" : ""}`}
                  onClick={() => onToggleMatchSort(key)}
                >
                  <span>{label}</span>
                  {matchSort.key === key ? (
                    matchSort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                  ) : null}
                </button>
              </th>
            ))}
            <th>Regime</th>
            {(
              [
                ["nextDayPct", "Morgen T+1"],
                ["fwd21dPct", "1M"],
                ["fwd63dPct", "3M"],
                ["dropToBottomPct", "Drop bis Tief"],
                ["daysToBottom", "Tage"],
              ] as const
            ).map(([key, label]) => (
              <th key={key}>
                <button
                  type="button"
                  className={`noise-sort-btn${matchSort.key === key ? " active" : ""}`}
                  onClick={() => onToggleMatchSort(key)}
                >
                  <span>{label}</span>
                  {matchSort.key === key ? (
                    matchSort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                  ) : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleMatches.map((m) => (
            <tr key={m.session}>
              <td className="mono">{m.session}</td>
              {patternMode === "leadup" ? (
                <td className={`mono ${(m.priorWindowPct ?? 0) >= 0 ? "positive" : "negative"}`}>
                  {fmtSigned2(m.priorWindowPct)}
                </td>
              ) : (
                <>
                  {patternLookbackDays >= 5 ? (
                    <td className={`mono ${(m.dayMinus4Pct ?? 0) >= 0 ? "positive" : "negative"}`}>
                      {fmtSigned2(m.dayMinus4Pct)}
                    </td>
                  ) : null}
                  {patternLookbackDays >= 4 ? (
                    <td className={`mono ${(m.dayMinus3Pct ?? 0) >= 0 ? "positive" : "negative"}`}>
                      {fmtSigned2(m.dayMinus3Pct)}
                    </td>
                  ) : null}
                  {patternLookbackDays >= 3 ? (
                    <td className={`mono ${(m.dayMinus2Pct ?? 0) >= 0 ? "positive" : "negative"}`}>
                      {fmtSigned2(m.dayMinus2Pct)}
                    </td>
                  ) : null}
                  <td className={`mono ${(m.prevDayPct ?? 0) >= 0 ? "positive" : "negative"}`}>
                    {fmtSigned2(m.prevDayPct)}
                  </td>
                </>
              )}
              <td className={`mono ${m.day0Pct >= 0 ? "positive" : "negative"}`}>
                {fmtSigned2(m.day0Pct)}
              </td>
              <td>
                <span className={`noise-tag ${m.inBearCycle ? "filled" : "open"}`}>
                  {m.inBearCycle ? "Bärenmarkt" : "Bullenmarkt"}
                </span>
              </td>
              <td className={`mono ${(m.nextDayPct ?? 0) >= 0 ? "positive" : "negative"}`}>
                {fmtSigned2(m.nextDayPct)}
              </td>
              <td className={`mono ${(m.fwd21dPct ?? 0) >= 0 ? "positive" : "negative"}`}>
                {fmtSigned2(m.fwd21dPct)}
              </td>
              <td className={`mono ${(m.fwd63dPct ?? 0) >= 0 ? "positive" : "negative"}`}>
                {fmtSigned2(m.fwd63dPct)}
              </td>
              <td className={`mono ${m.dropToBottomPct !== null && m.dropToBottomPct < 0 ? "negative" : "muted"}`}>
                {m.dropToBottomPct !== null ? fmtPct(m.dropToBottomPct, true) : "laufend"}
              </td>
              <td className="mono">{m.daysToBottom !== null ? `${m.daysToBottom}T` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
