import { useWorkspaceStore, LAYOUTS } from "@/stores/useWorkspaceStore";
import { useChartStore } from "@/stores/useChartStore";
import { createWorkspaceReplayRuntime, type WorkspaceReplayRuntime } from "./workspaceReplayRuntime";
let runtime: WorkspaceReplayRuntime | undefined, loading: Promise<WorkspaceReplayRuntime> | undefined;
export const currentWorkspaceReplay = () => runtime;
/** Loaded only from mounted chart effects, so the SDK workspace stays client-side. */
export function workspaceReplay(): Promise<WorkspaceReplayRuntime> {
  return loading ??= import("@luxalgo/vela/workspace").then(({ WorkspaceReplay }) => {
    runtime = createWorkspaceReplayRuntime(WorkspaceReplay, {
      activeId: () => useWorkspaceStore.getState().activeId,
      expected() {
        const state = useWorkspaceStore.getState(), current = useChartStore.getState(), count = LAYOUTS.find(layout => layout.id === state.layout)!.count;
        return state.cells.slice(0, count).filter(cell => !state.maximizedId || cell.id === state.maximizedId).map(cell => cell.id === state.activeId
          ? { id: cell.id, symbol: current.symbol, timeframe: current.timeframe } : { id: cell.id, symbol: cell.symbol, timeframe: cell.timeframe });
      },
    });
    useWorkspaceStore.subscribe((state, previous) => { if (state.activeId !== previous.activeId) runtime?.activeChanged(); });
    useChartStore.subscribe((state, previous) => { if (state.feedEpoch !== previous.feedEpoch) runtime?.replay.stop(); });
    return runtime;
  });
}
