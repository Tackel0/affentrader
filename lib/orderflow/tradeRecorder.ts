import type { Tick } from "@/types/trading";
import type { TradeArchiveWrite } from "@/types/tradeArchive";
import { ARCHIVE_BATCH, isArchivableTrade } from "./tradeArchive";
export interface RecorderStatus { recording: boolean; writing: boolean; pending: number; committed: number; retained: number | null; evicted: number; error: string; lastCommit: number | null }
interface Sink { append(trades: readonly Tick[]): Promise<TradeArchiveWrite> }
/** Bounded serialized journal. Only a completed storage transaction counts as committed. */
export class TradeRecorder {
  private queue: Tick[] = []; private timer: ReturnType<typeof setTimeout> | undefined; private task?: Promise<void>;
  private recording = false; private committed = 0; private retained: number | null = null; private evicted = 0; private error = ""; private lastCommit: number | null = null;
  constructor(private sink: Sink, private notify: (status: RecorderStatus) => void, private capacity = 5000) {}
  private report() { this.notify({ recording: this.recording, writing: !!this.task, pending: this.queue.length, committed: this.committed, retained: this.retained, evicted: this.evicted, error: this.error, lastCommit: this.lastCommit }); }
  start() { this.recording = true; this.error = ""; this.report(); if (this.queue.length) void this.flush(); }
  pause() { this.recording = false; this.report(); return this.flush(); }
  accept(tick: Tick): boolean {
    if (!this.recording || !isArchivableTrade(tick)) return false;
    if (this.queue.length >= this.capacity) { this.recording = false; this.error = "Recording paused: storage could not keep up. Additional executions were not recorded. Pending executions are retained in memory."; this.report(); return false; }
    this.queue.push({ ...tick }); this.schedule(); return true;
  }
  private schedule() {
    if (this.task || this.error) return;
    if (this.queue.length >= ARCHIVE_BATCH) {
      void this.flush();
      return;
    }
    this.timer ??= setTimeout(() => { this.timer = undefined; void this.flush(); }, 500);
  }
  flush(): Promise<void> {
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined; }
    if (this.task) return this.task;
    if (!this.queue.length) { this.report(); return Promise.resolve(); }
    // Defer processing until `task` exists; synchronous sink exceptions follow the same failure path.
    this.task = Promise.resolve().then(async () => {
      while (this.queue.length) {
        const batch = this.queue.slice(0, ARCHIVE_BATCH);
        try {
          const result = await this.sink.append(batch);
          this.queue.splice(0, batch.length); this.committed += result.added; this.retained = result.count; this.evicted += result.evicted + result.expired; this.lastCommit = Date.now(); this.report();
        } catch (error) {
          this.recording = false; this.error = error instanceof Error ? error.message : "Trade recording failed. Pending executions were not committed."; break;
        }
      }
    }).finally(() => { this.task = undefined; this.report(); if (this.queue.length && !this.error) this.schedule(); });
    this.report(); return this.task;
  }
}
