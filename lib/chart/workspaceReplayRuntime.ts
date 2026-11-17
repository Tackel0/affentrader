import type { Vela } from "@luxalgo/vela";
import type { WorkspaceReplay, WorkspaceReplayHost } from "@luxalgo/vela/workspace";
type Cell = { id: string; chart: Vela; ready: Promise<void>; settled: boolean; pending?: Promise<void> };
export interface ReplayCellIdentity { id: string; symbol: string; timeframe: string }
/** Adapt our React grid to the SDK's shared-clock controller. No replay cut or
 * calendar arithmetic is reimplemented here; each chart retains its own clock. */
export function createWorkspaceReplayRuntime(Controller: new (host: WorkspaceReplayHost) => WorkspaceReplay, host: {
  activeId(): string;
  expected(): readonly ReplayCellIdentity[];
}) {
  const cells = new Map<string, Cell>(), events = new Set<Parameters<WorkspaceReplayHost["onCells"]>[0]>(), listeners = new Set<() => void>();
  const publish = () => { for (const changed of listeners) changed(); };
  const emit = (kind: "created" | "destroyed" | "active", id: string) => { for (const listener of events) listener({ kind, id }); publish(); };
  const controller = new Controller({ cells: () => [...cells.values()], activeId: host.activeId, onCells(listener) { events.add(listener); return () => events.delete(listener); } });
  let resume = false, starting = 0, disposed = false;
  const readyCells = () => {
    const expected = host.expected();
    return expected.length > 0 && expected.length === cells.size && expected.every(identity => {
      const cell = cells.get(identity.id); return cell?.settled && cell.chart.market.symbol === identity.symbol && cell.chart.market.timeframe === identity.timeframe;
    });
  };
  const pauseForJoin = () => { if (controller.state.playing) { resume = true; controller.pause(); } };
  const resumeIfReady = () => { if (resume && readyCells() && controller.state.active) { resume = false; controller.play(); } };
  const offEvents = (["replay:start", "replay:step", "replay:tick", "replay:play", "replay:pause", "replay:end"] as const).map(event => controller.on(event, publish));
  const ready = async () => {
    const entries = [...cells.values()];
    if (!entries.length || host.expected().some(identity => !cells.has(identity.id))) throw new Error("Wait for every visible chart to finish loading before Replay.");
    await Promise.all(entries.map(cell => cell.ready));
    if (!readyCells() || entries.some(cell => cells.get(cell.id) !== cell)) throw new Error("The chart grid changed while loading. Retry Replay on the current layout.");
  };
  const replay = {
    get state() { return controller.state; }, get bounds() { return controller.bounds; },
    async start(options: { from: number }) { resume = false; starting++; try { await ready(); for (const cell of cells.values()) cell.pending = undefined; await controller.start(options); await Promise.all([...cells.values()].map(cell => cell.pending)); } catch (error) { replay.stop(); throw error; } finally { starting--; publish(); } },
    step() { if (!readyCells()) return false; return controller.step(); },
    play(intervalMs?: number) { resume = false; if (readyCells()) controller.play(intervalMs); },
    pause() { resume = false; controller.pause(); },
    stop() { resume = false; controller.stop(); },
  };
  return { replay, controller, get starting() { return starting > 0; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activeChanged() { if (!disposed) emit("active", host.activeId()); },
    async historyComplete() { await ready(); await Promise.all([...cells.values()].map(cell => cell.chart.historyComplete())); await ready(); },
    register(id: string, chart: Vela) {
      if (disposed) throw new Error("Replay workspace has been disposed.");
      if (cells.has(id)) throw new Error("A Replay chart is already mounted in this cell.");
      pauseForJoin();
      const loaded = chart.ready(); let pending: Promise<void> | undefined;
      // Track the SDK's public start promise so React keeps a joining canvas
      // covered until its archived studies have entered the shared Replay cut.
      const control = new Proxy(chart.replay, { get(target, key) {
        if (key === "start") return (options: { from: number }) => {
          pending = cell.pending = Promise.resolve().then(() => target.start(options));
          // The SDK's fire-and-forget late-join path must not leave a failed
          // cell showing live future data inside an otherwise replaying grid.
          // Keep the real rejection for our awaited ready/command boundary.
          return pending.catch(error => { replay.stop(); if (starting > 0) throw error; });
        };
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
      } });
      const wrapped = new Proxy(chart, { get(target, key) {
        if (key === "replay") return control; if (key === "ready") return () => loaded;
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
      } });
      const cell: Cell = { id, chart: wrapped, ready: Promise.resolve(), settled: false };
      cells.set(id, cell); emit("created", id);
      // The controller attached its loaded.then callback during 'created', before
      // this continuation; its start promise is therefore captured before await.
      cell.ready = loaded.then(async () => { await pending; if (cells.get(id) === cell) { cell.settled = true; resumeIfReady(); publish(); } });
      const detach = () => { if (cells.get(id) !== cell) return; pauseForJoin(); cells.delete(id); emit("destroyed", id); resumeIfReady(); };
      return { ready: cell.ready, dispose: detach };
    },
    destroy() { disposed = true; resume = false; offEvents.forEach(off => off()); controller.destroy(); cells.clear(); events.clear(); listeners.clear(); },
  };
}
export type WorkspaceReplayRuntime = ReturnType<typeof createWorkspaceReplayRuntime>;
