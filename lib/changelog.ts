export type ChangelogCategory = "feature" | "improvement" | "fix" | "security";

export interface ChangelogItem {
  category: ChangelogCategory;
  title: string;
  detail: string;
}

export interface ChangelogRelease {
  id: string;
  date: string;
  version: string;
  headline: string;
  items: readonly ChangelogItem[];
}

export const CHANGELOG_CATEGORY_LABELS: Record<ChangelogCategory, string> = {
  feature: "Neu",
  improvement: "Verbessert",
  fix: "Behoben",
  security: "Sicherheit",
};

export const CHANGELOG_RELEASES: readonly ChangelogRelease[] = [
  {
    id: "2026-11-28-ai-chart-analysis-tokenized-walls",
    date: "2026-11-28",
    version: "v1.8",
    headline: "AI Chartanalyse-Knopf (automatische Zeichnungen & Setup) + US-Options-Walls auf tokenisierten Märkten",
    items: [
      {
        category: "feature",
        title: "AI Chartanalyse-Knopf direkt in der Chart-Leiste & per ⌘K",
        detail: "Analysiert den aktiven Chart in Echtzeit und zeichnet Marktstruktur (BOS/CHoCH, HH/HL/LH/LL), Trendlinien, aktive Order Blocks (Supply/Demand), offene Fair Value Gaps (FVG), Key Support/Resistance, Liquiditätspools (BSL/SSL), Volume POC, Fibonacci Golden Pocket sowie ein konkretes Trade-Setup (Entry, SL, TP1/TP2) ein — komplett ohne API-Key.",
      },
      {
        category: "feature",
        title: "US-Options-Levels auf Hyperliquid, Bybit, Binance & Kraken",
        detail: "Put/Call Walls, Gamma Flip, Max Pain und Expected Move (±1σ) von US-Aktien, Indizes (z. B. XYZ100 → NDX, US500 → SPX) und Rohstoff-ETFs (GOLD/PAXG → GLD skaliert) werden automatisch auf tokenisierte Perps & xStocks übernommen.",
      },
    ],
  },
  {
    id: "2026-11-28-options-walls-gex",
    date: "2026-11-28",
    version: "v1.7",
    headline: "Put & Call Walls, Dealer GEX, Gamma Flip, Max Pain & Options-Suite komplett ohne API-Key",
    items: [
      {
        category: "feature",
        title: "Put Wall, Call Wall, Gamma Flip, Max Pain & Expected Move (±1σ) direkt im Chart",
        detail: "Über den neuen „Walls“-Button in der Chart-Leiste oder per ⌘K lassen sich die wichtigsten Options-Levels direkt als beschriftete Linien über die Kerzen legen — komplett ohne API-Key für US-Aktien/ETFs/Indizes (Yahoo Finance + Nasdaq-Fallback) sowie BTC, ETH & SOL (Deribit Public).",
      },
      {
        category: "feature",
        title: "Vollständiges Options- & GEX-Dashboard im AffenTerminal",
        detail: "Interaktives Strike-Profil (Open Interest, Dealer GEX & Volumen), Positive/Negative Gamma-Regime-Erkennung, 25Δ Volatilitäts-Skew, P/C-Ratios, Unusual Activity (Vol/OI & Tagesprämie) sowie Black-Scholes-Optionskette mit Δ/Γ/Θ und 1-Klick-Preis-Alerts auf jede Wall.",
      },
      {
        category: "improvement",
        title: "Maximierte mobile Chart-Fläche (36px Flush-Leiste & bündige Top-Ausrichtung)",
        detail: "Untere Phone-Leiste von 52px auf eine bündige 36px-OLED-Leiste verschlankt und überflüssigen Top-Abstand in mobilen Browsern entfernt.",
      },
    ],
  },
  {
    id: "2026-11-27-affen-branding",
    date: "2026-11-27",
    version: "v1.6",
    headline: "Neues AffenTerminal-Branding: Minimalistischer Titanium-Ape & OLED-Dark-Mode iPhone-Icons",
    items: [
      {
        category: "feature",
        title: "Neues geometrisches Affen-Signet (Titanium Crest & Amber Apex)",
        detail: "Einheitliches, minimalistisches Affen-Emblem in gebürstetem Titan-Silber mit warmem Amber-Gold-Apex auf tiefem OLED-Obsidian — sauber skalierend vom 20px-Toolbar-Icon bis zum 512px-App-Icon.",
      },
      {
        category: "improvement",
        title: "Optimierte iPhone-Homescreen- & PWA-App-Icons",
        detail: "Full-bleed 180×180 Apple-Touch-Icon ohne transparente Ecken für saubere iOS-Squircle-Maskierung im Dark Mode sowie neue 192px/512px/Maskable-Icons und OLED-Manifest-Farbe (#07090E).",
      },
      {
        category: "improvement",
        title: "Durchgängige Brand-Touchpoints in Boot, Menü, Terminal & Login",
        detail: "Start-Screens, Hauptmenü, AffenTerminal-Header, Toolbar-Launcher und die Login-/Konto-Ansicht tragen jetzt das gemeinsame OLED-Obsidian- & Amber-Gold-Branding.",
      },
    ],
  },
  {
    id: "2026-11-27-command-risk-boot",
    date: "2026-11-27",
    version: "v1.5",
    headline: "Globale Command Palette (⌘K), Risiko-Positionsgrößenrechner & sauberer Dark-Mode-Start",
    items: [
      {
        category: "feature",
        title: "Globale Command Palette (⌘K / Ctrl+K)",
        detail: "Symbole, Timeframes (z. B. 15m, 4h, 1D), Indikatoren, Alerts, Workspace-Module und Theme-Wechsel blitzschnell per Tastatur steuern.",
      },
      {
        category: "feature",
        title: "1-Klick Risiko-Positionsgrößenrechner im Paper-Trading-Ticket",
        detail: "Berechnet aus Depot-Risiko (0,5 % / 1 % / 2 % / 5 % oder Wunsch-$) und Stop-Loss inkl. Gebühren automatisch die exakte Stückzahl samt live R:R-Vorschau.",
      },
      {
        category: "feature",
        title: "NoiseMeter → Watchlist & Alert in 1 Klick",
        detail: "Analysierte Ticker lassen sich direkt aus dem NoiseMeter zur aktiven Watchlist hinzufügen oder als vorbereiteter Preis-Alert anlegen.",
      },
      {
        category: "improvement",
        title: "Kein weißer Lade-Flash im Dark Mode & Mobile-Feinschliff",
        detail: "Pre-Paint-Theme-Erkennung beim Laden verhindert weißes Aufblitzen im Dark Mode; zusätzlicher Safe-Area-Abstand am iPhone-Chart.",
      },
      {
        category: "fix",
        title: "Orangener Balken am linken Chart-Rand beim Start entfernt",
        detail: "Automatischer Initial-Fokus und abgeclippte Canvas-Outline beim Laden wurden entfernt.",
      },
    ],
  },
  {
    id: "2026-11-26-quant-perf",
    date: "2026-11-26",
    version: "v1.4",
    headline: "Walk-Forward & Monte-Carlo im Strategy Tester, schnellerer Kaltstart & Changelog",
    items: [
      {
        category: "feature",
        title: "Updates & Changelog direkt im Menü",
        detail: "Alle Produkt-Updates, neuen Features und Bugfixes der Plattform nach Kategorien filterbar im Hauptmenü einsehen.",
      },
      {
        category: "feature",
        title: "Walk-Forward Split (In-Sample / Out-of-Sample)",
        detail: "Chronologischer 60/40-, 70/30- und 80/20-Split im Strategy Tester inkl. OOS-Retention-Ratio und Overfitting-Ampel.",
      },
      {
        category: "feature",
        title: "Monte-Carlo-Drawdown-Konfidenzband",
        detail: "Deterministisches Bootstrap-Resampling (250×–1000×) mit SVG-Fan-Chart (P5–P95), Tail-Drawdowns (P95/P99), P(Profit) und Verlustserien-Risiko.",
      },
      {
        category: "improvement",
        title: "Lazy-Loading für Workspace-Dialoge & Terminal-Module",
        detail: "Schwere Dialoge (Alerts, Indikatoren, Suche, Export, Sync, Archiv) sowie Terminal-Subpanels werden erst beim Öffnen geladen.",
      },
      {
        category: "improvement",
        title: "Modularer NoiseMeter & automatisches Biome-Linting",
        detail: "NoiseMeterPanel sauber in eigenständige Module zerlegt und statische Code-Prüfung fest in die CI-Pipeline integriert.",
      },
    ],
  },
  {
    id: "2026-11-25-reliability-security",
    date: "2026-11-25",
    version: "v1.3",
    headline: "Tiefen-Bugfix-Pass über Trading, Alerts, Strategy, Sync & Sicherheit",
    items: [
      {
        category: "fix",
        title: "Paper-Trading-Statistiken, Order-Validierung & Brackets",
        detail: "Win-Rate zählt nur noch echte Closing-Fills; sofortige Market-/Limit-Fills prüfen Margin-Limits und räumen veraltete Reduce-Only-Orders bei Positionsumkehr ab.",
      },
      {
        category: "fix",
        title: "Strategy Tester Equity-Kurve, Range-Bars & Chart-Muster",
        detail: "Post-Close-Equity ohne 1-Bar-Verzögerung, chronologische Range-Bar-Pfade, robuste Rechteck-/Dreiecks-Erkennung sowie korrigierte MFI/ADX-Randfälle.",
      },
      {
        category: "security",
        title: "SSRF-Schutz für Web-Push & strengere API-Absicherung",
        detail: "Push-Endpunkte erzwingen HTTPS und blockieren lokale/private Netze inklusive DNS-Prüfung vor Versand; Rate-Limiting und 409-Konfliktbehandlung gehärtet.",
      },
      {
        category: "improvement",
        title: "Plattformweite Performance, API-Caching & Barrierefreiheit",
        detail: "Debounced Watchlist-Subscriptions, verbesserte Cache-Stabilität ohne Disconnect-Poisoning, Multi-Tab-Sync-Rehydration und Tastaturnavigation.",
      },
    ],
  },
  {
    id: "2026-11-25-noisemeter-v2",
    date: "2026-11-25",
    version: "v1.2",
    headline: "NoiseMeter Muster-Scanner 2.0 (Vorlauf → Heute | Einzeltage)",
    items: [
      {
        category: "feature",
        title: "2 klare Scanner-Modi mit Live-Kontext & Export",
        detail: "Vereinfacht auf „Vorlauf → Heute“ und „Einzeltage“ (bis 5 Tage Rückblick) mit Entcluster-Filter (≥ 10T), Spiegeln, Sortierung, Kopieren und CSV-Export.",
      },
      {
        category: "feature",
        title: "Erwartete T+1-Volatilität & empirische Morgen-Wahrscheinlichkeit",
        detail: "ATR-skalierte Tages-Range, Schwankungs-Wahrscheinlichkeiten (≥ 1/2/3 %) und T+1-Faktoren (RSI, ATR, 200-SMA) auf echter Close-to-Close-Basis.",
      },
      {
        category: "fix",
        title: "Bärenmarkt-Regime, Intraday-Tiefs & deutsche Zahlen-Eingabe",
        detail: "Bärenmarkt-Zyklen berücksichtigen Intraday-Highs/-Lows und laufende Zyklen korrekt; Prozent-Eingaben akzeptieren Komma und Minus ohne vorzeitiges Zurückspringen.",
      },
    ],
  },
  {
    id: "2026-11-24-export-mobile",
    date: "2026-11-24",
    version: "v1.1",
    headline: "Chartdaten-Export & iPhone-/Mobile-Stabilität",
    items: [
      {
        category: "feature",
        title: "Chartdaten-Export (CSV & JSON)",
        detail: "Export des sichtbaren Chart-Ausschnitts oder der gesamten Historie inkl. Zwischenablage-Kopie und iOS-Share-Unterstützung.",
      },
      {
        category: "improvement",
        title: "Flüssiges Zeichnen & Speicherschutz auf iOS",
        detail: "Zeichenwerkzeuge schalten nach dem Platzieren automatisch zurück, transluzente Mobile-Leisten ohne Überlappung und begrenzte Buffer gegen Safari-Reloads.",
      },
    ],
  },
];

export const LATEST_CHANGELOG_ID = CHANGELOG_RELEASES[0]?.id ?? "";
export const CHANGELOG_SEEN_KEY = "affentrader-changelog-seen-v1";

export function hasUnreadChangelog(): boolean {
  if (!LATEST_CHANGELOG_ID || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CHANGELOG_SEEN_KEY) !== LATEST_CHANGELOG_ID;
  } catch {
    return false;
  }
}

export function markChangelogSeen(): void {
  if (!LATEST_CHANGELOG_ID || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHANGELOG_SEEN_KEY, LATEST_CHANGELOG_ID);
  } catch {
    /* ignore storage unavailability */
  }
}

export function filterChangelogReleases(
  category: ChangelogCategory | "all",
): ChangelogRelease[] {
  if (category === "all") return [...CHANGELOG_RELEASES];
  return CHANGELOG_RELEASES.map((release) => ({
    ...release,
    items: release.items.filter((item) => item.category === category),
  })).filter((release) => release.items.length > 0);
}
