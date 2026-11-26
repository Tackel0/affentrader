"use client";
import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import {
  CHANGELOG_CATEGORY_LABELS,
  CHANGELOG_RELEASES,
  filterChangelogReleases,
  markChangelogSeen,
  type ChangelogCategory,
} from "@/lib/changelog";
import { Modal } from "./ui";

const FILTER_OPTIONS: readonly (ChangelogCategory | "all")[] = [
  "all",
  "feature",
  "improvement",
  "fix",
  "security",
];

function formatReleaseDate(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

export function ChangelogDialog() {
  const open = useChartStore((s) => s.changelogOpen);
  const [filter, setFilter] = useState<ChangelogCategory | "all">("all");

  useEffect(() => {
    if (open) markChangelogSeen();
  }, [open]);

  const counts = useMemo(() => {
    const tally: Record<ChangelogCategory | "all", number> = {
      all: 0,
      feature: 0,
      improvement: 0,
      fix: 0,
      security: 0,
    };
    for (const release of CHANGELOG_RELEASES) {
      for (const item of release.items) {
        tally.all++;
        tally[item.category]++;
      }
    }
    return tally;
  }, []);

  const releases = useMemo(() => filterChangelogReleases(filter), [filter]);

  if (!open) return null;

  const close = () => useChartStore.getState().set({ changelogOpen: false });

  return (
    <Modal title="Updates & Changelog" className="changelog-modal" onClose={close}>
      <div className="changelog-intro">
        <Sparkles size={16} aria-hidden="true" />
        <span>Aktuelle Funktionen, Performance-Verbesserungen und Fehlerbehebungen in AffenTerminal.</span>
      </div>

      <div className="changelog-filters" role="group" aria-label="Updates nach Kategorie filtern">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={`button small${filter === option ? " primary" : ""}`}
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
          >
            {option === "all" ? "Alle" : CHANGELOG_CATEGORY_LABELS[option]}{" "}
            <span className="mono">({counts[option]})</span>
          </button>
        ))}
      </div>

      <div className="changelog-list">
        {releases.map((release) => (
          <section key={release.id} className="changelog-release" aria-label={`${release.version} vom ${formatReleaseDate(release.date)}`}>
            <header className="changelog-release-head">
              <div className="changelog-release-meta">
                <span className="changelog-version mono">{release.version}</span>
                <time dateTime={release.date} className="mono">
                  {formatReleaseDate(release.date)}
                </time>
              </div>
              <h3>{release.headline}</h3>
            </header>
            <ul className="changelog-items">
              {release.items.map((item) => (
                <li key={`${release.id}-${item.title}`} className="changelog-item">
                  <span className={`changelog-tag tag-${item.category}`}>
                    {CHANGELOG_CATEGORY_LABELS[item.category]}
                  </span>
                  <div className="changelog-item-copy">
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="modal-actions">
        <button type="button" className="button primary" onClick={close}>
          Schließen
        </button>
      </div>
    </Modal>
  );
}
