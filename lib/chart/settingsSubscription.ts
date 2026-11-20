import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

/** Recheck renderer settings when their chart value or workspace owner may have changed. */
export function subscribeChartSettings(
  key: "chartView" | "chartAppearance" | "seriesPreferences" | "chartTypeSettings",
  listener: () => void,
): () => void {
  const offChart = useChartStore.subscribe((state, previous) => {
    if (state[key] !== previous[key]) listener();
  });
  const offWorkspace = useWorkspaceStore.subscribe((state, previous) => {
    if (state.cells !== previous.cells || state.activeId !== previous.activeId ||
      state.applyingCell !== previous.applyingCell || state.theme !== previous.theme) {
      listener();
    }
  });
  return () => {
    offChart();
    offWorkspace();
  };
}
