"use client";
import { ArrowLeftRight, Check, Copy, History } from "lucide-react";
import type {
  LivePatternSnapshot,
  PatternMatch,
  PatternStudyResult,
  PriorWindowDays,
  PriorWindowRule,
  ReturnRule,
  ReturnRuleOp,
} from "@/lib/terminal/noiseMeter";
import {
  ANY_NEG_RULE,
  ANY_PRIOR_WIN,
  fmtPct,
  fmtPct2,
  fmtSigned2,
  LOOKBACK_DEPTHS,
  PATTERN_PRESETS,
  PRIOR_WINDOW_OPTIONS,
  rulesEqual,
  type MatchSortKey,
  type PatternDayKey,
  type PatternMode,
  type PatternPreset,
} from "./constants";
import { NumericPctInput } from "./NumericPctInput";
import { PatternMatchesTable } from "./PatternMatchesTable";

export interface PatternScannerViewProps {
  patternStudy: PatternStudyResult;
  sortedPatternMatches: PatternMatch[];
  livePatternSnapshot: LivePatternSnapshot | null;
  isLiveSetupActive: boolean;
  copiedSummary: boolean;
  patternMode: PatternMode;
  patternLookbackDays: 2 | 3 | 4 | 5;
  patternTouched: boolean;
  dayMinus4Rule: ReturnRule;
  dayMinus3Rule: ReturnRule;
  dayMinus2Rule: ReturnRule;
  prevDayRule: ReturnRule;
  day0Rule: ReturnRule;
  priorWindowRule: PriorWindowRule;
  patternRegime: "all" | "bear" | "bull";
  patternMinGapDays: 0 | 10;
  years: 5 | 10 | 15 | "max";
  matchSort: { key: MatchSortKey; dir: "asc" | "desc" };
  showAllPatternMatches: boolean;
  onCopySummary: () => void;
  onSwitchMode: (mode: PatternMode) => void;
  onChangeLookback: (depth: 2 | 3 | 4 | 5) => void;
  onInvertRules: () => void;
  onApplyLivePattern: (mode: PatternMode) => void;
  onApplyPreset: (preset: PatternPreset) => void;
  onChangePriorWindowDays: (days: PriorWindowDays) => void;
  onChangePriorWindowOp: (op: ReturnRuleOp) => void;
  onChangePriorWindowThreshold: (val: number) => void;
  onChangeRuleOp: (key: PatternDayKey, op: ReturnRuleOp) => void;
  onChangeRuleThreshold: (key: PatternDayKey, val: number) => void;
  onChangeRegime: (regime: "all" | "bear" | "bull") => void;
  onChangeMinGapDays: (gap: 0 | 10) => void;
  onExpandMaxYears: () => void;
  onRelaxRules: () => void;
  onToggleMatchSort: (key: MatchSortKey) => void;
  onExportCsv: () => void;
  onToggleShowAll: () => void;
}

export function PatternScannerView({
  patternStudy,
  sortedPatternMatches,
  livePatternSnapshot,
  isLiveSetupActive,
  copiedSummary,
  patternMode,
  patternLookbackDays,
  patternTouched,
  dayMinus4Rule,
  dayMinus3Rule,
  dayMinus2Rule,
  prevDayRule,
  day0Rule,
  priorWindowRule,
  patternRegime,
  patternMinGapDays,
  years,
  matchSort,
  showAllPatternMatches,
  onCopySummary,
  onSwitchMode,
  onChangeLookback,
  onInvertRules,
  onApplyLivePattern,
  onApplyPreset,
  onChangePriorWindowDays,
  onChangePriorWindowOp,
  onChangePriorWindowThreshold,
  onChangeRuleOp,
  onChangeRuleThreshold,
  onChangeRegime,
  onChangeMinGapDays,
  onExpandMaxYears,
  onRelaxRules,
  onToggleMatchSort,
  onExportCsv,
  onToggleShowAll,
}: PatternScannerViewProps) {
  return (
    <section className="noise-pattern-card" aria-label="Historischer Muster-Scanner">
      <div className="noise-pattern-head">
        <div className="noise-t1-title-group">
          <h4>
            <History size={15} /> Historischer Muster-Scanner
          </h4>
          <span className="noise-t1-scenario-badge">{patternStudy.ruleDescription}</span>
          {isLiveSetupActive ? (
            <span className="noise-pattern-active-badge" title="Das aktuelle Markt-Setup erfüllt dieses Muster">
              Muster aktiv ✓
            </span>
          ) : null}
        </div>
        <div className="noise-pattern-head-actions">
          <span className="noise-meta-chip">
            <strong className="mono">{patternStudy.sampleSize}×</strong>
            {patternStudy.minGapDays > 0 && patternStudy.rawSampleSize > patternStudy.sampleSize
              ? ` (aus ${patternStudy.rawSampleSize})`
              : ""}{" "}
            seit {patternStudy.firstYear} ({patternStudy.totalDays.toLocaleString("de-DE")} Tage)
          </span>
          <button
            type="button"
            className={`noise-mini-btn${copiedSummary ? " active" : ""}`}
            title="Zusammenfassung in die Zwischenablage kopieren"
            onClick={onCopySummary}
          >
            {copiedSummary ? <Check size={12} /> : <Copy size={12} />}
            <span>{copiedSummary ? "Kopiert" : "Kopieren"}</span>
          </button>
        </div>
      </div>

      {/* OddStats-Style Headline & Empirical Bullet Facts */}
      <div className="noise-pattern-summary">
        <p className="noise-pattern-headline">{patternStudy.headline}</p>
        <ul className="noise-pattern-bullets">
          {patternStudy.bullets.map((b, idx) => (
            <li key={idx}>{b}</li>
          ))}
        </ul>
      </div>

      {/* Simplified 2-Mode Switcher (Vorlauf → Heute | Einzeltage) + Lookback Depth + Mirror Action */}
      <div className="noise-pattern-controls-bar">
        <div className="noise-pattern-mode-switch" role="group" aria-label="Muster-Modus">
          <button
            type="button"
            className={`noise-mini-btn${patternMode === "leadup" ? " active" : ""}`}
            aria-pressed={patternMode === "leadup"}
            onClick={() => onSwitchMode("leadup")}
          >
            Vorlauf → Heute
          </button>
          <button
            type="button"
            className={`noise-mini-btn${patternMode === "days" ? " active" : ""}`}
            aria-pressed={patternMode === "days"}
            onClick={() => onSwitchMode("days")}
          >
            Einzeltage
          </button>
        </div>

        <div className="noise-pattern-toolbar-right">
          {patternMode === "days" ? (
            <div className="noise-pattern-depth" role="group" aria-label="Muster Rückblick-Tiefe">
              <span className="noise-pattern-rule-label">Rückblick:</span>
              {LOOKBACK_DEPTHS.map((depth) => (
                <button
                  key={depth}
                  type="button"
                  className={`noise-mini-btn${patternLookbackDays === depth ? " active" : ""}`}
                  aria-pressed={patternLookbackDays === depth}
                  onClick={() => onChangeLookback(depth)}
                >
                  {depth} Tage
                </button>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            className="noise-mini-btn"
            title="Richtung umkehren (≤ ↔ ≥ und Vorzeichen spiegeln)"
            onClick={onInvertRules}
          >
            <ArrowLeftRight size={12} />
            <span>Spiegeln</span>
          </button>
        </div>
      </div>

      {/* Mode-Focused Presets */}
      <div className="noise-quick-row noise-pattern-presets" role="group" aria-label="Muster-Vorlagen">
        <button
          type="button"
          className={`noise-mini-btn${!patternTouched ? " active" : ""}`}
          onClick={() => onApplyLivePattern(patternMode)}
        >
          {patternMode === "leadup" ? "Live-Vorlauf" : "Live-Muster"}
        </button>
        {PATTERN_PRESETS.filter((preset) => preset.mode === patternMode).map((preset) => {
          const p4 = preset.dayMinus4 ?? ANY_NEG_RULE;
          const p3 = preset.dayMinus3 ?? ANY_NEG_RULE;
          const p2 = preset.dayMinus2 ?? ANY_NEG_RULE;
          const pPrev = preset.prev ?? ANY_NEG_RULE;
          const pWin = preset.priorWindow ?? ANY_PRIOR_WIN;
          const activeD4 = patternLookbackDays >= 5 ? dayMinus4Rule : ANY_NEG_RULE;
          const activeD3 = patternLookbackDays >= 4 ? dayMinus3Rule : ANY_NEG_RULE;
          const activeD2 = patternLookbackDays >= 3 ? dayMinus2Rule : ANY_NEG_RULE;
          const isActive =
            preset.mode === "leadup"
              ? rulesEqual(priorWindowRule, pWin) &&
                (priorWindowRule.op === "any" || priorWindowRule.days === pWin.days) &&
                rulesEqual(day0Rule, preset.day0)
              : rulesEqual(activeD4, p4) &&
                rulesEqual(activeD3, p3) &&
                rulesEqual(activeD2, p2) &&
                rulesEqual(prevDayRule, pPrev) &&
                rulesEqual(day0Rule, preset.day0);
          return (
            <button
              key={preset.id}
              type="button"
              className={`noise-mini-btn${isActive ? " active" : ""}`}
              onClick={() => onApplyPreset(preset)}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Compact Live Context Bar: shows current tape values for the active mode */}
      {livePatternSnapshot ? (
        <div className="noise-pattern-live-bar" aria-label="Aktuelle Ticker-Werte">
          <div className="noise-pattern-live-metrics">
            <span className="noise-pattern-live-label">
              Aktuell ({livePatternSnapshot.sessionLabel}):
            </span>
            {patternMode === "leadup" ? (
              <>
                <span className="noise-live-chip">
                  Vor-{priorWindowRule.days}T{" "}
                  <b
                    className={`mono ${(livePatternSnapshot.priorWindow[priorWindowRule.days] ?? 0) >= 0 ? "positive" : "negative"}`}
                  >
                    {fmtSigned2(livePatternSnapshot.priorWindow[priorWindowRule.days])}
                  </b>
                </span>
                <span className="noise-live-arrow">→</span>
                <span className="noise-live-chip">
                  Tag 0{" "}
                  <b
                    className={`mono ${(livePatternSnapshot.day0Pct ?? 0) >= 0 ? "positive" : "negative"}`}
                  >
                    {fmtSigned2(livePatternSnapshot.day0Pct)}
                  </b>
                </span>
              </>
            ) : (
              <>
                {patternLookbackDays >= 3 ? (
                  <>
                    <span className="noise-live-chip">
                      Tag −2{" "}
                      <b
                        className={`mono ${(livePatternSnapshot.dayMinus2Pct ?? 0) >= 0 ? "positive" : "negative"}`}
                      >
                        {fmtSigned2(livePatternSnapshot.dayMinus2Pct)}
                      </b>
                    </span>
                    <span className="noise-live-arrow">→</span>
                  </>
                ) : null}
                <span className="noise-live-chip">
                  Tag −1{" "}
                  <b
                    className={`mono ${(livePatternSnapshot.prevDayPct ?? 0) >= 0 ? "positive" : "negative"}`}
                  >
                    {fmtSigned2(livePatternSnapshot.prevDayPct)}
                  </b>
                </span>
                <span className="noise-live-arrow">→</span>
                <span className="noise-live-chip">
                  Tag 0{" "}
                  <b
                    className={`mono ${(livePatternSnapshot.day0Pct ?? 0) >= 0 ? "positive" : "negative"}`}
                  >
                    {fmtSigned2(livePatternSnapshot.day0Pct)}
                  </b>
                </span>
              </>
            )}
            <span className={`noise-tag ${livePatternSnapshot.inBearCycle ? "filled" : "open"}`}>
              {livePatternSnapshot.inBearCycle ? "Bärenmarkt" : "Bullenmarkt"} (52W{" "}
              {fmtPct(livePatternSnapshot.drawdown52wPct, true)})
            </span>
          </div>
          <button
            type="button"
            className="noise-mini-btn"
            title="Aktuelle Ticker-Bewegung gerundet als Muster übernehmen"
            onClick={() => onApplyLivePattern(patternMode)}
          >
            Übernehmen
          </button>
        </div>
      ) : null}

      {/* Clean Mode-Specific Rule Builder */}
      <div className="noise-pattern-builder">
        {patternMode === "leadup" ? (
          <>
            <div className="noise-pattern-rule">
              <span className="noise-pattern-rule-label">Vorlauf (kumulativ vor Heute)</span>
              <div className="noise-pattern-rule-controls">
                <div className="noise-pattern-ops" role="group" aria-label="Vorlauf Fenster">
                  {PRIOR_WINDOW_OPTIONS.map((w) => (
                    <button
                      key={w}
                      type="button"
                      className={`noise-mini-btn${priorWindowRule.days === w ? " active" : ""}`}
                      aria-pressed={priorWindowRule.days === w}
                      onClick={() => onChangePriorWindowDays(w)}
                    >
                      {w}T
                    </button>
                  ))}
                </div>
                <div className="noise-pattern-ops" role="group" aria-label="Vorlauf Bedingung">
                  {(["lte", "gte", "any"] as const).map((op) => (
                    <button
                      key={op}
                      type="button"
                      className={`noise-mini-btn${priorWindowRule.op === op ? " active" : ""}`}
                      aria-pressed={priorWindowRule.op === op}
                      onClick={() => onChangePriorWindowOp(op)}
                    >
                      {op === "lte" ? "≤" : op === "gte" ? "≥" : "Egal"}
                    </button>
                  ))}
                </div>
                {priorWindowRule.op !== "any" ? (
                  <div className="noise-pattern-num">
                    <NumericPctInput
                      step={1}
                      min={-80}
                      max={100}
                      showSteppers
                      ariaLabel="Vorlauf Schwelle Prozent"
                      value={priorWindowRule.thresholdPct}
                      onChange={onChangePriorWindowThreshold}
                    />
                    <span>%</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="noise-pattern-rule">
              <span className="noise-pattern-rule-label">Heute (Tag 0)</span>
              <div className="noise-pattern-rule-controls">
                <div className="noise-pattern-ops" role="group" aria-label="Tag 0 Bedingung">
                  {(["gte", "lte", "any"] as const).map((op) => (
                    <button
                      key={op}
                      type="button"
                      className={`noise-mini-btn${day0Rule.op === op ? " active" : ""}`}
                      aria-pressed={day0Rule.op === op}
                      onClick={() => onChangeRuleOp("day0", op)}
                    >
                      {op === "lte" ? "≤" : op === "gte" ? "≥" : "Egal"}
                    </button>
                  ))}
                </div>
                {day0Rule.op !== "any" ? (
                  <div className="noise-pattern-num">
                    <NumericPctInput
                      step={0.5}
                      min={-40}
                      max={40}
                      showSteppers
                      ariaLabel="Tag 0 Schwelle Prozent"
                      value={day0Rule.thresholdPct}
                      onChange={(val) => onChangeRuleThreshold("day0", val)}
                    />
                    <span>%</span>
                  </div>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          (
            [
              ...(patternLookbackDays >= 5
                ? [
                    {
                      key: "dayMinus4" as const,
                      label: "Tag −4",
                      ariaPrefix: "Tag minus 4",
                      rule: dayMinus4Rule,
                      ops: ["lte", "gte", "any"] as const,
                    },
                  ]
                : []),
              ...(patternLookbackDays >= 4
                ? [
                    {
                      key: "dayMinus3" as const,
                      label: "Tag −3",
                      ariaPrefix: "Tag minus 3",
                      rule: dayMinus3Rule,
                      ops: ["lte", "gte", "any"] as const,
                    },
                  ]
                : []),
              ...(patternLookbackDays >= 3
                ? [
                    {
                      key: "dayMinus2" as const,
                      label: "Tag −2",
                      ariaPrefix: "Tag minus 2",
                      rule: dayMinus2Rule,
                      ops: ["lte", "gte", "any"] as const,
                    },
                  ]
                : []),
              {
                key: "prev" as const,
                label: "Tag −1 (Vortag)",
                ariaPrefix: "Tag minus 1",
                rule: prevDayRule,
                ops: ["lte", "gte", "any"] as const,
              },
              {
                key: "day0" as const,
                label: "Tag 0 (Heute)",
                ariaPrefix: "Tag 0",
                rule: day0Rule,
                ops: ["gte", "lte", "any"] as const,
              },
            ] as const
          ).map((item) => (
            <div key={item.key} className="noise-pattern-rule">
              <span className="noise-pattern-rule-label">{item.label}</span>
              <div className="noise-pattern-rule-controls">
                <div className="noise-pattern-ops" role="group" aria-label={`${item.ariaPrefix} Bedingung`}>
                  {item.ops.map((op) => (
                    <button
                      key={op}
                      type="button"
                      className={`noise-mini-btn${item.rule.op === op ? " active" : ""}`}
                      aria-pressed={item.rule.op === op}
                      onClick={() => onChangeRuleOp(item.key, op)}
                    >
                      {op === "lte" ? "≤" : op === "gte" ? "≥" : "Egal"}
                    </button>
                  ))}
                </div>
                {item.rule.op !== "any" ? (
                  <div className="noise-pattern-num">
                    <NumericPctInput
                      step={0.5}
                      min={-40}
                      max={40}
                      showSteppers
                      ariaLabel={`${item.ariaPrefix} Schwelle Prozent`}
                      value={item.rule.thresholdPct}
                      onChange={(val) => onChangeRuleThreshold(item.key, val)}
                    />
                    <span>%</span>
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}

        <div className="noise-pattern-rule">
          <span className="noise-pattern-rule-label">Marktregime &amp; Cluster</span>
          <div className="noise-pattern-rule-controls">
            <div className="noise-pattern-ops" role="group" aria-label="Marktregime Filter">
              {(
                [
                  ["all", "Alle", patternStudy.regimeCounts.all],
                  ["bear", "Bärenmarkt", patternStudy.regimeCounts.bear],
                  ["bull", "Bullenmarkt", patternStudy.regimeCounts.bull],
                ] as const
              ).map(([val, label, count]) => (
                <button
                  key={val}
                  type="button"
                  className={`noise-mini-btn${patternRegime === val ? " active" : ""}`}
                  aria-pressed={patternRegime === val}
                  onClick={() => onChangeRegime(val)}
                >
                  {label} <em className="mono">({count})</em>
                </button>
              ))}
            </div>
            <div className="noise-pattern-ops" role="group" aria-label="Signal-Abstand Filter">
              <button
                type="button"
                className={`noise-mini-btn${patternMinGapDays === 0 ? " active" : ""}`}
                aria-pressed={patternMinGapDays === 0}
                title="Alle passenden Handelstage inkl. Mehrfachtreffer in derselben Crash-Woche"
                onClick={() => onChangeMinGapDays(0)}
              >
                Alle Tage
              </button>
              <button
                type="button"
                className={`noise-mini-btn${patternMinGapDays === 10 ? " active" : ""}`}
                aria-pressed={patternMinGapDays === 10}
                title="Nur unabhängige Episoden (mind. 10 Handelstage Abstand zwischen Treffern)"
                onClick={() => onChangeMinGapDays(10)}
              >
                Entclustert (≥ 10T)
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Actionable Empty-State Helper when 0 matches */}
      {patternStudy.sampleSize === 0 ? (
        <div className="noise-pattern-empty" role="status">
          <span>0 Treffer für diese Kombination — schnelle Anpassung:</span>
          <div className="noise-pattern-empty-actions">
            {years !== "max" ? (
              <button
                type="button"
                className="noise-mini-btn active"
                onClick={onExpandMaxYears}
              >
                Auf Max-Historie erweitern
              </button>
            ) : null}
            {patternRegime !== "all" && patternStudy.regimeCounts.all > 0 ? (
              <button
                type="button"
                className="noise-mini-btn active"
                onClick={() => onChangeRegime("all")}
              >
                Regime auf „Alle“ ({patternStudy.regimeCounts.all}×)
              </button>
            ) : null}
            {patternMinGapDays > 0 && patternStudy.rawSampleSize > 0 ? (
              <button
                type="button"
                className="noise-mini-btn"
                onClick={() => onChangeMinGapDays(0)}
              >
                Cluster-Filter aus
              </button>
            ) : null}
            <button
              type="button"
              className="noise-mini-btn"
              onClick={onRelaxRules}
            >
              Schwellen lockern (−25 %)
            </button>
          </div>
        </div>
      ) : null}

      {patternStudy.sampleSize > 0 ? (
        <>
          <div className="noise-t1-metrics">
            <div className="noise-t1-metric">
              <span>Treffer &amp; T+1 Vola</span>
              <strong className="mono">{patternStudy.sampleSize}×</strong>
              <small>
                {patternStudy.nextDayVol.sampleSize > 0 ? (
                  <>
                    Ø T+1: <b className="mono">±{fmtPct2(patternStudy.nextDayVol.avgAbsMovePct)}</b> ·
                    Range <b className="mono">{fmtPct2(patternStudy.nextDayVol.avgRangePct)}</b>
                  </>
                ) : (
                  <>Aus {patternStudy.totalDays.toLocaleString("de-DE")} Handelstagen</>
                )}
              </small>
            </div>
            <div className="noise-t1-metric">
              <span>Im Bärenmarkt (≥ 20 %-Zyklus)</span>
              <strong className={`mono ${patternStudy.bearCycleRate >= 65 ? "negative" : ""}`}>
                {fmtPct(patternStudy.bearCycleRate)}
              </strong>
              <small>
                {patternStudy.bearCycleCount}/{patternStudy.sampleSize} · Unter 200-SMA:{" "}
                <b className="mono">
                  {patternStudy.belowSma200Rate !== null ? fmtPct(patternStudy.belowSma200Rate) : "—"}
                </b>
              </small>
            </div>
            <div className="noise-t1-metric">
              <span>Weiterer Drop bis Tief</span>
              {patternStudy.bottomEvaluatedCount > 0 ? (
                <>
                  <strong className="mono negative">
                    {patternStudy.minFurtherDropPct !== null && patternStudy.droppedFurtherRate === 100
                      ? `min. ${fmtPct(patternStudy.minFurtherDropPct, true)}`
                      : fmtPct(patternStudy.medianFurtherDropPct, true)}
                  </strong>
                  <small>
                    Median: <b className="mono">{fmtPct(patternStudy.medianFurtherDropPct, true)}</b> · Worst:{" "}
                    <b className="mono">{fmtPct(patternStudy.worstFurtherDropPct, true)}</b>
                  </small>
                </>
              ) : (
                <>
                  <strong className="mono muted">laufend</strong>
                  <small>Noch kein bestätigtes Zyklustief</small>
                </>
              )}
            </div>
            <div className="noise-t1-metric">
              <span>Tiefer gefallen danach</span>
              {patternStudy.bottomEvaluatedCount > 0 ? (
                <>
                  <strong
                    className={`mono ${patternStudy.droppedFurtherRate >= 70 ? "negative" : "positive"}`}
                  >
                    {fmtPct(patternStudy.droppedFurtherRate)}
                  </strong>
                  <small>
                    ≥ 5 % tiefer: <b className="mono">{fmtPct(patternStudy.droppedAtLeast5PctRate)}</b> · Median{" "}
                    <b className="mono">{patternStudy.medianDaysToBottom ?? "—"}T</b> bis Tief
                  </small>
                </>
              ) : (
                <>
                  <strong className="mono muted">laufend</strong>
                  <small>0/{patternStudy.sampleSize} Zyklen abgeschlossen</small>
                </>
              )}
            </div>
          </div>

          {/* Forward Returns Matrix (T+1 through 1Y) with inline Win-Rate Micro-Bar */}
          <div className="noise-table-wrap noise-t1-twins">
            <h4>Folge-Performance nach dem Muster (T+1 bis 1 Jahr)</h4>
            <table className="noise-table">
              <thead>
                <tr>
                  <th>Horizont</th>
                  <th>n</th>
                  <th>Positiv %</th>
                  <th>Ø Rendite</th>
                  <th>Median</th>
                  <th>Best / Worst</th>
                </tr>
              </thead>
              <tbody>
                {patternStudy.horizons.map((h) => (
                  <tr key={h.id}>
                    <td>{h.label}</td>
                    <td className="mono">{h.sampleSize}</td>
                    <td className={`mono ${h.sampleSize && h.winRate >= 50 ? "positive" : "negative"}`}>
                      {h.sampleSize ? (
                        <span className="noise-win-cell">
                          <span>{fmtPct(h.winRate)}</span>
                          <span className="noise-win-bar" aria-hidden="true">
                            <span
                              className="noise-win-bar-fill"
                              style={{ width: `${Math.max(0, Math.min(100, h.winRate))}%` }}
                            />
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`mono ${h.avgPct >= 0 ? "positive" : "negative"}`}>
                      {h.sampleSize ? fmtSigned2(h.avgPct) : "—"}
                    </td>
                    <td className={`mono ${h.medianPct >= 0 ? "positive" : "negative"}`}>
                      {h.sampleSize ? fmtSigned2(h.medianPct) : "—"}
                    </td>
                    <td className="mono">
                      {h.sampleSize ? `${fmtPct(h.bestPct, true)} / ${fmtPct(h.worstPct, true)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <PatternMatchesTable
            patternStudy={patternStudy}
            sortedMatches={sortedPatternMatches}
            patternMode={patternMode}
            priorWindowDays={priorWindowRule.days}
            patternLookbackDays={patternLookbackDays}
            matchSort={matchSort}
            showAllPatternMatches={showAllPatternMatches}
            onToggleMatchSort={onToggleMatchSort}
            onExportCsv={onExportCsv}
            onToggleShowAll={onToggleShowAll}
          />
        </>
      ) : null}
    </section>
  );
}
