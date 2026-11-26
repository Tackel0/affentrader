// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangelogDialog } from "@/components/ChangelogDialog";
import { MainMenu } from "@/components/WorkspaceMenus";
import {
  CHANGELOG_RELEASES,
  CHANGELOG_SEEN_KEY,
  filterChangelogReleases,
  hasUnreadChangelog,
  LATEST_CHANGELOG_ID,
  markChangelogSeen,
} from "@/lib/changelog";
import { useChartStore } from "@/stores/useChartStore";

beforeEach(() => {
  window.localStorage.clear();
  useChartStore.getState().set({ changelogOpen: false });
});

afterEach(() => {
  cleanup();
});

describe("Updates & Changelog menu entry and dialog", () => {
  it("tracks unread state and filters changelog entries by category", () => {
    expect(CHANGELOG_RELEASES.length).toBeGreaterThanOrEqual(3);
    expect(hasUnreadChangelog()).toBe(true);
    markChangelogSeen();
    expect(window.localStorage.getItem(CHANGELOG_SEEN_KEY)).toBe(LATEST_CHANGELOG_ID);
    expect(hasUnreadChangelog()).toBe(false);

    const securityOnly = filterChangelogReleases("security");
    expect(securityOnly.length).toBeGreaterThan(0);
    for (const rel of securityOnly) {
      expect(rel.items.every((item) => item.category === "security")).toBe(true);
    }
  });

  it("opens Updates & Changelog from MainMenu, marks as seen, and filters categories", () => {
    const { container } = render(
      <>
        <MainMenu onExport={vi.fn()} onImport={vi.fn()} />
        <ChangelogDialog />
      </>,
    );

    const trigger = within(container).getByRole("button", { name: "Main menu" });
    fireEvent.click(trigger);

    const updatesBtn = screen.getByRole("button", { name: /Updates & Changelog/i });
    expect(updatesBtn.textContent).toContain("Neu");

    fireEvent.click(updatesBtn);
    expect(useChartStore.getState().changelogOpen).toBe(true);
    expect(hasUnreadChangelog()).toBe(false);

    const dialog = screen.getByRole("dialog", { name: "Updates & Changelog" });
    expect(dialog.textContent).toContain("Walk-Forward Split");

    fireEvent.click(within(dialog).getByRole("button", { name: /Sicherheit/i }));
    expect(dialog.textContent).toContain("SSRF-Schutz");
    expect(dialog.textContent).not.toContain("Walk-Forward Split");

    fireEvent.click(within(dialog).getByRole("button", { name: "Schließen" }));
    expect(useChartStore.getState().changelogOpen).toBe(false);
    expect(screen.queryByRole("dialog", { name: "Updates & Changelog" })).toBeNull();
  });
});
