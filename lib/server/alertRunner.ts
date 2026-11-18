import { evaluateRules, exchangeSource, processDeliveries, store } from "./alertService";
import { logError } from "./logger";
import { usesNetlifyStorage } from "./netlifyStorage";

export interface RunnerStatus {
  running: boolean;
  startedAt: number | null;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastEvaluated: number;
  lastFired: number;
  lastErrors: string[];
  intervalMs: number;
  runs: number;
}

interface Runner {
  timer: ReturnType<typeof setInterval>;
  status: RunnerStatus;
}

const KEY = Symbol.for("affentrader.alertRunner");
type Holder = { [KEY]?: Runner };

/**
 * Start the background evaluator once per server process. It evaluates every
 * active server-side rule and delivers queued webhooks, so alerts keep
 * working with no browser open. Evaluation granularity is the poll interval.
 */
export function startAlertRunner(intervalMs = 15_000): RunnerStatus {
  // A serverless invocation cannot own a persistent timer. Netlify uses cron.
  if (usesNetlifyStorage()) return {
    running: false, startedAt: null, lastRunAt: null, lastDurationMs: null,
    lastEvaluated: 0, lastFired: 0, lastErrors: ["Netlify: scheduled evaluation once per minute; inspect Functions logs for health."],
    intervalMs: 60_000, runs: 0,
  };
  const holder = globalThis as unknown as Holder;
  if (holder[KEY]) return holder[KEY]!.status;
  const status: RunnerStatus = {
    running: true,
    startedAt: Date.now(),
    lastRunAt: null,
    lastDurationMs: null,
    lastEvaluated: 0,
    lastFired: 0,
    lastErrors: [],
    intervalMs,
    runs: 0,
  };
  const source = exchangeSource();
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    const started = Date.now();
    try {
      const result = await evaluateRules(source);
      await processDeliveries();
      status.lastEvaluated = result.evaluated;
      status.lastFired = result.fired;
      status.lastErrors = result.errors.slice(0, 5);
    } catch (error) {
      logError("alertRunner.tick.failed", error);
      status.lastErrors = [error instanceof Error ? error.message : String(error)];
    } finally {
      status.runs++;
      status.lastRunAt = Date.now();
      status.lastDurationMs = status.lastRunAt - started;
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  // Never keep the process alive just for alerts.
  timer.unref?.();
  holder[KEY] = { timer, status };
  void tick();
  return status;
}

export function runnerStatus(): RunnerStatus | null {
  return (globalThis as unknown as Holder)[KEY]?.status ?? null;
}

export function stopAlertRunner() {
  const holder = globalThis as unknown as Holder;
  const runner = holder[KEY];
  if (!runner) return;
  clearInterval(runner.timer);
  runner.status.running = false;
  delete holder[KEY];
}

export async function pendingDeliveries(): Promise<number> {
  const db = await store.read();
  return db.events.filter((e) => e.delivery?.status === "pending").length;
}
