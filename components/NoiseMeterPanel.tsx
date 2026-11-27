"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Check,
  Gauge,
  History,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import { isYahooTicker } from "@/lib/symbolId";
import {
  buildNoiseDataset,
  buildPatternMatchesCsv,
  evaluateNextDayForecast,
  evaluateNoiseScenario,
  evaluatePatternStudy,
  formatPatternSummaryText,
  getLivePatternSnapshot,
  matchesLivePatternSnapshot,
  suggestLiveLeadupPattern,
  suggestLivePattern,
  type NoiseApiPayload,
  type NoiseDataset,
  type NoiseStreakBasis,
  type PatternMatch,
  type PriorWindowRule,
  type ReturnRule,
  type ReturnRuleOp,
  type StreakStats,
} from "@/lib/terminal/noiseMeter";
import { AssetBadge } from "./ui";
import {
  ANY_NEG_RULE,
  ANY_PRIOR_WIN,
  DEFAULT_PRIOR_WIN,
  fmtPct,
  fmtPct2,
  fmtSigned2,
  HISTORY_RANGES,
  invertRule,
  PRESET_TICKERS,
  relaxRule,
  sourceLabel,
  type DetailTab,
  type MatchSortKey,
  type PatternDayKey,
  type PatternMode,
  type PatternPreset,
  type PrimaryView,
} from "./noise-meter/constants";
import { ForecastView } from "./noise-meter/ForecastView";
import { GapsStreaksView } from "./noise-meter/GapsStreaksView";
import { NoiseGauge } from "./noise-meter/NoiseGauge";
import { PatternScannerView } from "./noise-meter/PatternScannerView";
import { StreakCard } from "./noise-meter/StreakCard";

export type { PatternMode } from "./noise-meter/constants";
export { NumericPctInput, type NumericPctInputProps } from "./noise-meter/NumericPctInput";

export function NoiseMeterPanel({
  initialTicker = "SPY",
  onOpenChart,
  onTickerSelect,
}: {
  initialTicker?: string;
  onOpenChart?: (ticker: string) => void;
  onTickerSelect?: (ticker: string) => void;
}) {
  const defaultTicker = isYahooTicker(initialTicker) ? initialTicker.toUpperCase() : "SPY";
  const [ticker, setTicker] = useState(defaultTicker);
  const [input, setInput] = useState(defaultTicker);
  const [years, setYears] = useState<5 | 10 | 15 | "max">("max");
  const [loaded, setLoaded] = useState<{ payload: NoiseApiPayload; dataset: NoiseDataset } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);

  // Clean 3-tab primary navigation for uncluttered overview
  const [activeView, setActiveView] = useState<PrimaryView>("forecast");

  // Interactive scenario controls (default: Close-to-Close streak strictly on Nasdaq/Exchange close)
  const [gapPct, setGapPct] = useState<number>(1.0);
  const [gapTouched, setGapTouched] = useState(false);
  const [todayMovePct, setTodayMovePct] = useState<number>(0);
  const [todayMoveTouched, setTodayMoveTouched] = useState(false);
  const [useExtraFactors, setUseExtraFactors] = useState<boolean>(true);
  const [streakBasis, setStreakBasis] = useState<NoiseStreakBasis>("close");
  const [streakDirection, setStreakDirection] = useState<"red" | "green">("red");
  const [streakDays, setStreakDays] = useState<number>(3);
  const [streakTouched, setStreakTouched] = useState(false);

  // Simplified 2-mode pattern scanner: "leadup" (Vorlauf → Heute) | "days" (Einzeltage)
  const [patternMode, setPatternMode] = useState<PatternMode>("days");
  const [patternLookbackDays, setPatternLookbackDays] = useState<2 | 3 | 4 | 5>(2);
  const [dayMinus4Rule, setDayMinus4Rule] = useState<ReturnRule>(ANY_NEG_RULE);
  const [dayMinus3Rule, setDayMinus3Rule] = useState<ReturnRule>(ANY_NEG_RULE);
  const [dayMinus2Rule, setDayMinus2Rule] = useState<ReturnRule>(ANY_NEG_RULE);
  const [prevDayRule, setPrevDayRule] = useState<ReturnRule>({ op: "lte", thresholdPct: -5 });
  const [day0Rule, setDay0Rule] = useState<ReturnRule>({ op: "gte", thresholdPct: 5 });
  const [priorWindowRule, setPriorWindowRule] = useState<PriorWindowRule>(DEFAULT_PRIOR_WIN);
  const [patternRegime, setPatternRegime] = useState<"all" | "bear" | "bull">("all");
  const [patternMinGapDays, setPatternMinGapDays] = useState<0 | 10>(0);
  const [patternTouched, setPatternTouched] = useState(false);
  const [showAllPatternMatches, setShowAllPatternMatches] = useState(false);
  const [matchSort, setMatchSort] = useState<{ key: MatchSortKey; dir: "asc" | "desc" }>({
    key: "session",
    dir: "desc",
  });
  const [copiedSummary, setCopiedSummary] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("gaps");

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const clean = initialTicker.replace(/^YF:/i, "").trim().toUpperCase();
    if (clean && isYahooTicker(clean) && clean !== ticker) {
      setTicker(clean);
      setInput(clean);
      setGapTouched(false);
      setTodayMoveTouched(false);
      setStreakTouched(false);
      setPatternTouched(false);
      setShowAllPatternMatches(false);
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: sync only when external initialTicker prop changes
  }, [initialTicker]);

  const gapTouchedRef = useRef(gapTouched);
  const todayMoveTouchedRef = useRef(todayMoveTouched);
  const streakTouchedRef = useRef(streakTouched);
  const patternTouchedRef = useRef(patternTouched);
  const streakBasisRef = useRef(streakBasis);
  gapTouchedRef.current = gapTouched;
  todayMoveTouchedRef.current = todayMoveTouched;
  streakTouchedRef.current = streakTouched;
  patternTouchedRef.current = patternTouched;
  streakBasisRef.current = streakBasis;
  const [useLastCompletedAsToday, setUseLastCompletedAsToday] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const res = await fetch(
          `/api/terminal-noise?ticker=${encodeURIComponent(ticker)}&years=${years}`,
          { signal: controller.signal },
        );
        const body = (await res.json().catch(() => null)) as (NoiseApiPayload & { error?: string }) | null;
        if (!res.ok || !body) throw new Error(body?.error || `HTTP ${res.status}`);
        if (controller.signal.aborted) return;
        const computed = buildNoiseDataset(body.bars);
        setLoaded({ payload: body, dataset: computed });
        if (!gapTouchedRef.current) {
          setGapPct(body.live.liveGapPct);
        }
        if (!todayMoveTouchedRef.current) {
          setUseLastCompletedAsToday(false);
          setTodayMovePct(body.live.liveTodayReturnPct ?? body.live.liveGapPct);
        }
        if (!streakTouchedRef.current) {
          const liveStreak =
            streakBasisRef.current === "candle"
              ? (body.live.currentCandleStreak ?? computed.currentCandleStreak)
              : (body.live.currentStreak ?? computed.currentStreak);
          setStreakDirection(liveStreak.direction);
          setStreakDays(Math.max(1, liveStreak.count || 1));
        }
        if (!patternTouchedRef.current) {
          const liveRet = body.live.priceSource === "regular" ? body.live.liveTodayReturnPct : null;
          const suggested = suggestLivePattern(computed, liveRet);
          const suggestedLeadup = suggestLiveLeadupPattern(computed, liveRet);
          setPatternMode("days");
          setPatternLookbackDays(2);
          setDayMinus4Rule(ANY_NEG_RULE);
          setDayMinus3Rule(ANY_NEG_RULE);
          setDayMinus2Rule(ANY_NEG_RULE);
          setPrevDayRule(suggested.prevDayRule);
          setDay0Rule(suggested.day0Rule);
          setPriorWindowRule(suggestedLeadup.priorWindowRule);
          setPatternRegime("all");
          setPatternMinGapDays(0);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "NoiseMeter-Daten konnten nicht geladen werden.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [ticker, years, reloadNonce]);

  const data = loaded?.payload ?? null;
  const dataset = loaded?.dataset ?? null;

  const liveCloseStreak =
    dataset?.currentStreak ?? data?.live.currentStreak ?? { direction: "red" as const, count: 1 };
  const liveCandleStreak =
    dataset?.currentCandleStreak ?? data?.live.currentCandleStreak ?? liveCloseStreak;
  const activeLiveStreak = streakBasis === "candle" ? liveCandleStreak : liveCloseStreak;

  const evaluation = useMemo(() => {
    if (!dataset) return null;
    return evaluateNoiseScenario(dataset, {
      gapPct,
      streakDays,
      streakDirection,
      streakBasis,
      weekday: data?.live.nextWeekday,
    });
  }, [dataset, gapPct, streakDays, streakDirection, streakBasis, data?.live.nextWeekday]);

  const priorCompletedDataset = useMemo(() => {
    if (!useLastCompletedAsToday || !data || data.bars.length < 30) return null;
    return buildNoiseDataset(data.bars.slice(0, -1));
  }, [useLastCompletedAsToday, data]);

  const nextDayForecast = useMemo(() => {
    if (!dataset) return null;
    if (useLastCompletedAsToday && priorCompletedDataset) {
      const priorStreak =
        streakBasis === "candle"
          ? priorCompletedDataset.currentCandleStreak
          : priorCompletedDataset.currentStreak;
      return evaluateNextDayForecast(priorCompletedDataset, {
        priorStreakDays: Math.max(1, priorStreak.count || 1),
        priorStreakDirection: priorStreak.direction,
        streakBasis,
        todayMovePct,
        useExtraFactors,
      });
    }
    return evaluateNextDayForecast(dataset, {
      priorStreakDays: streakDays,
      priorStreakDirection: streakDirection,
      streakBasis,
      todayMovePct,
      useExtraFactors,
    });
  }, [
    dataset,
    priorCompletedDataset,
    useLastCompletedAsToday,
    streakDays,
    streakDirection,
    streakBasis,
    todayMovePct,
    useExtraFactors,
  ]);

  const liveTodayReturn = data ? (data.live.liveTodayReturnPct ?? data.live.liveGapPct) : 0;

  const activePatternInput = useMemo(() => {
    if (!data) return null;
    if (patternMode === "leadup") {
      return {
        ticker: data.ticker,
        prevDayRule: ANY_NEG_RULE,
        day0Rule,
        priorWindowRule,
        regimeFilter: patternRegime,
        minGapDays: patternMinGapDays,
      };
    }
    return {
      ticker: data.ticker,
      dayMinus4Rule: patternLookbackDays >= 5 ? dayMinus4Rule : ANY_NEG_RULE,
      dayMinus3Rule: patternLookbackDays >= 4 ? dayMinus3Rule : ANY_NEG_RULE,
      dayMinus2Rule: patternLookbackDays >= 3 ? dayMinus2Rule : ANY_NEG_RULE,
      prevDayRule,
      day0Rule,
      priorWindowRule: ANY_PRIOR_WIN,
      regimeFilter: patternRegime,
      minGapDays: patternMinGapDays,
    };
  }, [
    data,
    patternMode,
    patternLookbackDays,
    dayMinus4Rule,
    dayMinus3Rule,
    dayMinus2Rule,
    prevDayRule,
    day0Rule,
    priorWindowRule,
    patternRegime,
    patternMinGapDays,
  ]);

  const patternStudy = useMemo(() => {
    if (!dataset || !activePatternInput) return null;
    return evaluatePatternStudy(dataset, activePatternInput);
  }, [dataset, activePatternInput]);

  const livePatternSnapshot = useMemo(() => {
    if (!dataset || !data) return null;
    return getLivePatternSnapshot(
      dataset,
      data.live.priceSource === "regular" ? liveTodayReturn : null,
    );
  }, [dataset, data, liveTodayReturn]);

  const isLiveSetupActive = useMemo(() => {
    if (!livePatternSnapshot || !activePatternInput) return false;
    return matchesLivePatternSnapshot(livePatternSnapshot, activePatternInput);
  }, [livePatternSnapshot, activePatternInput]);

  const sortedPatternMatches = useMemo(() => {
    if (!patternStudy) return [];
    const list = [...patternStudy.matches];
    const { key, dir } = matchSort;
    const mult = dir === "asc" ? 1 : -1;
    list.sort((a: PatternMatch, b: PatternMatch) => {
      if (key === "session") {
        return a.session.localeCompare(b.session) * mult;
      }
      const av = a[key];
      const bv = b[key];
      if (av === null && bv === null) return b.session.localeCompare(a.session);
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av !== bv) return (av - bv) * mult;
      return b.session.localeCompare(a.session);
    });
    return list;
  }, [patternStudy, matchSort]);

  const switchStreakBasis = (nextBasis: NoiseStreakBasis) => {
    setStreakBasis(nextBasis);
    const nextLive = nextBasis === "candle" ? liveCandleStreak : liveCloseStreak;
    setStreakDirection(nextLive.direction);
    setStreakDays(Math.max(1, nextLive.count || 1));
    setStreakTouched(false);
  };

  const selectTicker = (next: string) => {
    const clean = next.replace(/^YF:/i, "").trim().toUpperCase();
    if (!isYahooTicker(clean)) {
      setError("Bitte gib einen gültigen Yahoo-Ticker ein (z. B. SPY, QQQ, ^GSPC, ^GDAXI, NVDA).");
      return;
    }
    setError("");
    setInput(clean);
    setTicker(clean);
    setGapTouched(false);
    setTodayMoveTouched(false);
    setStreakTouched(false);
    setPatternTouched(false);
    setShowAllPatternMatches(false);
    onTickerSelect?.(clean);
  };

  const applyStreakRow = (row: StreakStats) => {
    setStreakDirection(row.direction);
    setStreakDays(row.days);
    setStreakTouched(true);
  };

  const applyLivePattern = (targetMode: PatternMode = patternMode) => {
    if (!dataset || !data) return;
    const liveRet = data.live.priceSource === "regular" ? liveTodayReturn : null;
    if (targetMode === "leadup") {
      const suggested = suggestLiveLeadupPattern(dataset, liveRet);
      setPatternMode("leadup");
      setPriorWindowRule(suggested.priorWindowRule);
      setDay0Rule(suggested.day0Rule);
    } else {
      const suggested = suggestLivePattern(dataset, liveRet);
      setPatternMode("days");
      setPatternLookbackDays(2);
      setDayMinus4Rule(ANY_NEG_RULE);
      setDayMinus3Rule(ANY_NEG_RULE);
      setDayMinus2Rule(ANY_NEG_RULE);
      setPrevDayRule(suggested.prevDayRule);
      setDay0Rule(suggested.day0Rule);
    }
    setPatternRegime("all");
    setPatternTouched(false);
    setShowAllPatternMatches(false);
  };

  const applyPreset = (preset: PatternPreset) => {
    const p4 = preset.dayMinus4 ?? ANY_NEG_RULE;
    const p3 = preset.dayMinus3 ?? ANY_NEG_RULE;
    const p2 = preset.dayMinus2 ?? ANY_NEG_RULE;
    const pPrev = preset.prev ?? ANY_NEG_RULE;
    const pWin = preset.priorWindow ?? ANY_PRIOR_WIN;
    if (preset.mode === "leadup") {
      setPriorWindowRule(pWin);
    } else {
      setPatternLookbackDays(preset.lookbackDays ?? 2);
      setDayMinus4Rule(p4);
      setDayMinus3Rule(p3);
      setDayMinus2Rule(p2);
      setPrevDayRule(pPrev);
    }
    setDay0Rule(preset.day0);
    setPatternTouched(true);
    setShowAllPatternMatches(false);
  };

  const switchPatternMode = (nextMode: PatternMode) => {
    setPatternMode(nextMode);
    if (nextMode === "leadup" && priorWindowRule.op === "any") {
      setPriorWindowRule(DEFAULT_PRIOR_WIN);
    }
    if (matchSort.key === "priorWindowPct" && nextMode === "days") {
      setMatchSort({ key: "session", dir: "desc" });
    } else if (matchSort.key === "prevDayPct" && nextMode === "leadup") {
      setMatchSort({ key: "session", dir: "desc" });
    }
    setPatternTouched(true);
    setShowAllPatternMatches(false);
  };

  const invertPatternRules = () => {
    if (patternMode === "leadup") {
      setPriorWindowRule((cur) => ({ ...cur, ...invertRule(cur) }));
    } else {
      setDayMinus4Rule((cur) => invertRule(cur));
      setDayMinus3Rule((cur) => invertRule(cur));
      setDayMinus2Rule((cur) => invertRule(cur));
      setPrevDayRule((cur) => invertRule(cur));
    }
    setDay0Rule((cur) => invertRule(cur));
    setPatternTouched(true);
    setShowAllPatternMatches(false);
  };

  const relaxPatternRules = () => {
    if (patternMode === "leadup") {
      setPriorWindowRule((cur) => ({ ...cur, ...relaxRule(cur, 1) }));
    } else {
      setDayMinus4Rule((cur) => relaxRule(cur, 0.5));
      setDayMinus3Rule((cur) => relaxRule(cur, 0.5));
      setDayMinus2Rule((cur) => relaxRule(cur, 0.5));
      setPrevDayRule((cur) => relaxRule(cur, 0.5));
    }
    setDay0Rule((cur) => relaxRule(cur, 0.5));
    setPatternTouched(true);
    setShowAllPatternMatches(false);
  };

  const toggleMatchSort = (key: MatchSortKey) => {
    setMatchSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "dropToBottomPct" ? "asc" : "desc" },
    );
  };

  const copyPatternSummary = async () => {
    if (!patternStudy || !data) return;
    const text = formatPatternSummaryText(data.ticker, patternStudy);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
      setCopiedSummary(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedSummary(false), 2000);
    } catch {
      /* ignore clipboard denial */
    }
  };

  const exportPatternCsv = () => {
    if (!patternStudy || !data || patternStudy.matches.length === 0) return;
    const csv = buildPatternMatchesCsv(
      patternStudy,
      patternMode,
      priorWindowRule.days,
      patternLookbackDays,
    );
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.ticker.replace(/[^A-Z0-9_-]/gi, "")}-muster-${data.asOf}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const changePatternLookback = (depth: 2 | 3 | 4 | 5) => {
    setPatternLookbackDays(depth);
    if (depth < 5) setDayMinus4Rule(ANY_NEG_RULE);
    if (depth < 4) setDayMinus3Rule(ANY_NEG_RULE);
    if (depth < 3) setDayMinus2Rule(ANY_NEG_RULE);
    setShowAllPatternMatches(false);
  };

  const ruleSetterFor = (which: PatternDayKey) => {
    switch (which) {
      case "dayMinus4":
        return setDayMinus4Rule;
      case "dayMinus3":
        return setDayMinus3Rule;
      case "dayMinus2":
        return setDayMinus2Rule;
      case "prev":
        return setPrevDayRule;
      case "day0":
        return setDay0Rule;
    }
  };

  const updateRuleOp = (which: PatternDayKey, op: ReturnRuleOp) => {
    const updater = ruleSetterFor(which);
    updater((cur) => {
      let nextVal = cur.thresholdPct;
      const defaultMag = which === "prev" || which === "day0" ? 3 : 2;
      if (op === "lte" && nextVal > 0) nextVal = -Math.abs(nextVal || defaultMag);
      if (op === "gte" && nextVal < 0) nextVal = Math.abs(nextVal || defaultMag);
      if (op === "lte" && nextVal === 0) nextVal = -defaultMag;
      if (op === "gte" && nextVal === 0) nextVal = defaultMag;
      return { op, thresholdPct: nextVal };
    });
    setPatternTouched(true);
    setShowAllPatternMatches(false);
  };

  const updateRuleThreshold = (which: PatternDayKey, val: number) => {
    ruleSetterFor(which)((cur) => ({ ...cur, thresholdPct: val }));
    setPatternTouched(true);
  };

  const updatePriorWindowOp = (op: ReturnRuleOp) => {
    setPriorWindowRule((cur) => {
      let nextVal = cur.thresholdPct;
      if (op === "lte" && nextVal > 0) nextVal = -Math.abs(nextVal || 8);
      if (op === "gte" && nextVal < 0) nextVal = Math.abs(nextVal || 8);
      if (op === "lte" && nextVal === 0) nextVal = -8;
      if (op === "gte" && nextVal === 0) nextVal = 8;
      return { ...cur, op, thresholdPct: nextVal };
    });
    setPatternTouched(true);
    setShowAllPatternMatches(false);
  };

  const renderStreakCard = (titleLabel: string) => {
    if (!data || !evaluation) return null;
    return (
      <StreakCard
        titleLabel={titleLabel}
        dataset={dataset}
        evaluation={evaluation}
        streakBasis={streakBasis}
        streakDirection={streakDirection}
        streakDays={streakDays}
        streakTouched={streakTouched}
        activeLiveStreak={activeLiveStreak}
        liveCloseStreak={liveCloseStreak}
        liveCandleStreak={liveCandleStreak}
        onResetLive={() => {
          setStreakDirection(activeLiveStreak.direction);
          setStreakDays(Math.max(1, activeLiveStreak.count || 1));
          setStreakTouched(false);
        }}
        onSelectDirection={(dir) => {
          setStreakDirection(dir);
          setStreakTouched(true);
        }}
        onSwitchBasis={switchStreakBasis}
        onSelectDays={(d) => {
          setStreakDays(d);
          setStreakTouched(true);
        }}
      />
    );
  };

  const vol = nextDayForecast?.expectedVolatility ?? null;

  return (
    <section className="noise-meter-panel" aria-label="NoiseMeter Statistik">
      {/* Compact Top Toolbar */}
      <div className="noise-toolbar">
        <form
          className="noise-search-form"
          onSubmit={(e) => {
            e.preventDefault();
            selectTicker(input);
          }}
        >
          <AssetBadge symbol={`YF:${ticker}`} size="xs" />
          <input
            aria-label="NoiseMeter Ticker"
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            placeholder="SPY, ^GSPC, NVDA…"
          />
          <button type="submit" className="button small primary">
            Analysieren
          </button>
        </form>

        <div className="noise-years-group" role="group" aria-label="Historischer Zeitraum">
          {HISTORY_RANGES.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              className={`button small${years === opt.value ? " primary" : ""}`}
              aria-pressed={years === opt.value}
              onClick={() => setYears(opt.value)}
            >
              {opt.label}
            </button>
          ))}
          <button
            type="button"
            className="button small"
            aria-label="Daten aktualisieren"
            title="Live-Quote & Historie neu laden"
            onClick={() => setReloadNonce((n) => n + 1)}
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} />
          </button>
          <NoiseMeterQuickActions ticker={ticker} livePrice={data?.live.lastPrice ?? data?.live.prevClose} />
          {onOpenChart ? (
            <button type="button" className="button small" onClick={() => onOpenChart(ticker)}>
              Chart
            </button>
          ) : null}
        </div>
      </div>

      {/* Quick Ticker Presets */}
      <div className="noise-preset-strip" role="group" aria-label="Schnellwahl Indizes und Aktien">
        {PRESET_TICKERS.map((p) => (
          <button
            key={p.ticker}
            type="button"
            className={`noise-chip${ticker === p.ticker ? " active" : ""}`}
            onClick={() => selectTicker(p.ticker)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="noise-error" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="noise-loading" role="status">
          <Gauge size={18} className="spin" />
          <span>
            {years === "max"
              ? `Lade komplette Historie für ${ticker}…`
              : `Lade ${years}-Jahres-Statistik für ${ticker}…`}
          </span>
        </div>
      ) : null}

      {data && evaluation ? (
        <>
          {/* Compact Executive Hero: Gauge + Verdict + 3 Clickable Overview Tiles */}
          <div className="noise-hero">
            <NoiseGauge score={evaluation.score} tone={evaluation.tone} />

            <div className="noise-verdict">
              <div className="noise-verdict-head">
                <div>
                  <h3>
                    {data.ticker}
                    <span className="noise-asset-name">{data.name}</span>
                  </h3>
                  <div className="noise-meta-row">
                    <span className={`noise-pill tone-${evaluation.tone}`}>{evaluation.verdictLabel}</span>
                    <span className="noise-meta-chip">
                      {sourceLabel(data.live.priceSource)}:{" "}
                      <strong className="mono">{fmtSigned2(data.live.liveGapPct)}</strong>
                    </span>
                    <span className="noise-meta-chip">
                      {data.totalDays.toLocaleString("de-DE")} Tage ({data.bars[0]?.session.slice(0, 4)}–
                      {data.asOf.slice(0, 4)})
                    </span>
                  </div>
                </div>
              </div>

              <p className="noise-verdict-sub">{evaluation.verdictSubtitle}</p>

              {/* 3 Executive At-A-Glance Tiles */}
              <div className="noise-exec-grid" role="group" aria-label="Schnellübersicht">
                {nextDayForecast ? (
                  <button
                    type="button"
                    className={`noise-exec-tile${activeView === "forecast" ? " is-active" : ""}`}
                    onClick={() => setActiveView("forecast")}
                  >
                    <span className="noise-exec-label">
                      <Target size={12} /> Morgen (T+1)
                    </span>
                    <div className="noise-exec-split mono">
                      <strong className="positive">{fmtPct(nextDayForecast.greenProb)}</strong>
                      <span className="muted">/</span>
                      <strong className="negative">{fmtPct(nextDayForecast.redProb)}</strong>
                    </div>
                    <div className="noise-split-bar noise-exec-bar" aria-hidden="true">
                      <div className="noise-split-green" style={{ width: `${nextDayForecast.greenProb}%` }} />
                      <div className="noise-split-red" style={{ width: `${nextDayForecast.redProb}%` }} />
                    </div>
                    <small className="noise-exec-sub">
                      Edge{" "}
                      <b className="mono">
                        {nextDayForecast.edgeVsBasePct > 0
                          ? "+"
                          : nextDayForecast.edgeVsBasePct < 0
                            ? "−"
                            : ""}
                        {Math.abs(nextDayForecast.edgeVsBasePct).toFixed(1).replace(".", ",")} Pp.
                      </b>{" "}
                      · Ø <b className="mono">{fmtSigned2(nextDayForecast.avgNextDayPct)}</b>
                    </small>
                  </button>
                ) : null}

                {vol ? (
                  <button
                    type="button"
                    className={`noise-exec-tile${activeView === "forecast" ? " is-active" : ""}`}
                    onClick={() => setActiveView("forecast")}
                  >
                    <div className="noise-exec-head-row">
                      <span className="noise-exec-label">
                        <Zap size={12} /> Erwartete Vola (T+1)
                      </span>
                      <span className={`noise-vol-regime tone-${vol.regimeTone}`}>{vol.regime}</span>
                    </div>
                    <div className="noise-exec-big mono">±{fmtPct2(vol.expectedAbsMovePct)}</div>
                    <small className="noise-exec-sub">
                      Range <b className="mono">{fmtPct2(vol.expectedRangePct)}</b> ·{" "}
                      <b className="mono">{vol.volRatioVsAtr.toFixed(2).replace(".", ",")}× ATR14</b>
                    </small>
                  </button>
                ) : null}

                {patternStudy ? (
                  <button
                    type="button"
                    className={`noise-exec-tile${activeView === "pattern" ? " is-active" : ""}`}
                    onClick={() => setActiveView("pattern")}
                  >
                    <div className="noise-exec-head-row">
                      <span className="noise-exec-label">
                        <History size={12} /> Muster-Scanner
                      </span>
                      <span className="noise-exec-tag mono">{patternStudy.sampleSize}×</span>
                    </div>
                    <div className="noise-exec-big mono">
                      {patternStudy.sampleSize > 0
                        ? `${fmtPct(patternStudy.bearCycleRate)} Bär`
                        : "0 Treffer"}
                    </div>
                    <small className="noise-exec-sub">
                      {patternStudy.sampleSize > 0 ? (
                        patternStudy.bottomEvaluatedCount > 0 && patternStudy.medianFurtherDropPct !== null ? (
                          <>
                            Drop bis Tief:{" "}
                            <b className="mono negative">
                              {patternStudy.minFurtherDropPct !== null && patternStudy.droppedFurtherRate === 100
                                ? `min. ${fmtPct(patternStudy.minFurtherDropPct, true)}`
                                : fmtPct(patternStudy.medianFurtherDropPct, true)}
                            </b>
                          </>
                        ) : (
                          <>
                            Drop bis Tief: <b className="mono muted">laufend</b>
                          </>
                        )
                      ) : (
                        patternStudy.ruleDescription
                      )}
                    </small>
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {/* Primary 3-Tab Segmented Navigation */}
          <div className="noise-view-tabs" role="tablist" aria-label="NoiseMeter Ansichten">
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "forecast"}
              className={activeView === "forecast" ? "active" : ""}
              onClick={() => setActiveView("forecast")}
            >
              <Target size={14} />
              <span>Morgen &amp; Vola</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "pattern"}
              className={activeView === "pattern" ? "active" : ""}
              onClick={() => setActiveView("pattern")}
            >
              <History size={14} />
              <span>Muster-Scanner</span>
              {patternStudy ? <em className="mono">{patternStudy.sampleSize}×</em> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "gaps"}
              className={activeView === "gaps" ? "active" : ""}
              onClick={() => setActiveView("gaps")}
            >
              <Sparkles size={14} />
              <span>Premarket &amp; Gaps</span>
            </button>
          </div>

          {activeView === "forecast" && nextDayForecast ? (
            <ForecastView
              data={data}
              dataset={dataset}
              nextDayForecast={nextDayForecast}
              useExtraFactors={useExtraFactors}
              onToggleExtraFactors={() => setUseExtraFactors((prev) => !prev)}
              streakCard={renderStreakCard(`Vor-Serie im ${data.ticker}`)}
              streakDays={streakDays}
              streakDirection={streakDirection}
              streakBasis={streakBasis}
              todayMovePct={todayMovePct}
              todayMoveTouched={todayMoveTouched}
              useLastCompletedAsToday={useLastCompletedAsToday}
              liveTodayReturn={liveTodayReturn}
              onResetLiveTodayMove={() => {
                setTodayMovePct(liveTodayReturn);
                setTodayMoveTouched(false);
                setUseLastCompletedAsToday(false);
              }}
              onSelectLastCompletedClose={(val) => {
                setTodayMovePct(val);
                setTodayMoveTouched(true);
                setUseLastCompletedAsToday(true);
              }}
              onChangeTodayMove={(val, resetLastCompleted) => {
                setTodayMovePct(val);
                setTodayMoveTouched(true);
                if (resetLastCompleted) setUseLastCompletedAsToday(false);
              }}
            />
          ) : null}

          {activeView === "pattern" && patternStudy ? (
            <PatternScannerView
              patternStudy={patternStudy}
              sortedPatternMatches={sortedPatternMatches}
              livePatternSnapshot={livePatternSnapshot}
              isLiveSetupActive={isLiveSetupActive}
              copiedSummary={copiedSummary}
              patternMode={patternMode}
              patternLookbackDays={patternLookbackDays}
              patternTouched={patternTouched}
              dayMinus4Rule={dayMinus4Rule}
              dayMinus3Rule={dayMinus3Rule}
              dayMinus2Rule={dayMinus2Rule}
              prevDayRule={prevDayRule}
              day0Rule={day0Rule}
              priorWindowRule={priorWindowRule}
              patternRegime={patternRegime}
              patternMinGapDays={patternMinGapDays}
              years={years}
              matchSort={matchSort}
              showAllPatternMatches={showAllPatternMatches}
              onCopySummary={() => void copyPatternSummary()}
              onSwitchMode={switchPatternMode}
              onChangeLookback={changePatternLookback}
              onInvertRules={invertPatternRules}
              onApplyLivePattern={applyLivePattern}
              onApplyPreset={applyPreset}
              onChangePriorWindowDays={(w) => {
                setPriorWindowRule((cur) => ({ ...cur, days: w }));
                setPatternTouched(true);
                setShowAllPatternMatches(false);
              }}
              onChangePriorWindowOp={updatePriorWindowOp}
              onChangePriorWindowThreshold={(val) => {
                setPriorWindowRule((cur) => ({ ...cur, thresholdPct: val }));
                setPatternTouched(true);
              }}
              onChangeRuleOp={updateRuleOp}
              onChangeRuleThreshold={updateRuleThreshold}
              onChangeRegime={(val) => {
                setPatternRegime(val);
                setShowAllPatternMatches(false);
              }}
              onChangeMinGapDays={(gap) => {
                setPatternMinGapDays(gap);
                setShowAllPatternMatches(false);
              }}
              onExpandMaxYears={() => setYears("max")}
              onRelaxRules={relaxPatternRules}
              onToggleMatchSort={toggleMatchSort}
              onExportCsv={exportPatternCsv}
              onToggleShowAll={() => setShowAllPatternMatches((v) => !v)}
            />
          ) : null}

          {activeView === "gaps" ? (
            <GapsStreaksView
              data={data}
              evaluation={evaluation}
              streakCard={renderStreakCard(`Serie / Streak im ${data.ticker}`)}
              gapPct={gapPct}
              gapTouched={gapTouched}
              streakBasis={streakBasis}
              streakDirection={streakDirection}
              streakDays={streakDays}
              detailTab={detailTab}
              onResetLiveGap={() => {
                setGapPct(data.live.liveGapPct);
                setGapTouched(false);
              }}
              onChangeGapPct={(val) => {
                setGapPct(val);
                setGapTouched(true);
              }}
              onChangeDetailTab={setDetailTab}
              onApplyStreakRow={applyStreakRow}
            />
          ) : null}

          <p className="noise-disclaimer">
            Empirische Auswertung historischer Tagesdaten ({data.ticker}, {data.totalDays} Handelstage). Keine
            Anlageberatung — historische Wahrscheinlichkeiten garantieren keine zukünftigen Ergebnisse.
          </p>
        </>
      ) : null}
    </section>
  );
}

function NoiseMeterQuickActions({
  ticker,
  livePrice,
}: {
  ticker: string;
  livePrice?: number;
}) {
  const symbolId = `YF:${ticker}`;
  const inWatchlist = useWatchlistStore((s) => {
    const active = s.lists.find((l) => l.id === s.activeId) ?? s.lists[0];
    return Boolean(active?.symbols.includes(symbolId));
  });

  return (
    <>
      <button
        type="button"
        className="button small"
        title={inWatchlist ? `${ticker} ist in der aktiven Watchlist` : `${ticker} zur aktiven Watchlist hinzufügen`}
        onClick={() => {
          if (inWatchlist) return;
          useWatchlistStore.getState().addSymbol(symbolId);
          useChartStore.getState().toast("Watchlist", `${ticker} zur aktiven Watchlist hinzugefügt.`, "success");
        }}
      >
        {inWatchlist ? <Check size={13} /> : <Plus size={13} />}
        <span>{inWatchlist ? "In Liste" : "Watchlist"}</span>
      </button>
      <button
        type="button"
        className="button small"
        title={`Preis-Alert für ${ticker} erstellen`}
        onClick={() => {
          useChartStore.getState().set({
            alertDraft: {
              symbol: symbolId,
              timeframe: "1D",
              price: livePrice && Number.isFinite(livePrice) ? livePrice : undefined,
            },
          });
        }}
      >
        <Bell size={13} />
        <span>Alert</span>
      </button>
    </>
  );
}
