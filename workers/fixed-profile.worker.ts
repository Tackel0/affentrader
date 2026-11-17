import { FixedProfileCache } from "../lib/orderflow/fixedProfileModel";
import type { ProfileRequest, ProfileResponse } from "../lib/orderflow/profileJobs";
import { ExecutionRangeProfileCache } from "../lib/orderflow/executionRangeProfile";

const caches = new Map<number, { cache: FixedProfileCache; execution: ExecutionRangeProfileCache; bars: number; mode: boolean }>();
let retained = 0;
self.onmessage = (event: MessageEvent<ProfileRequest>) => {
  const { id, owner, bars, options, execution } = event.data;
  let response: ProfileResponse;
  try {
    const entry = caches.get(owner) ?? { cache: new FixedProfileCache(), execution: new ExecutionRangeProfileCache(), bars: 0, mode: !!execution };
    if (entry.mode !== !!execution) { entry.cache = new FixedProfileCache(); entry.execution = new ExecutionRangeProfileCache(); entry.mode = !!execution; }
    const count = bars.length + (execution?.trades.length ?? 0);
    retained += count - entry.bars; entry.bars = count;
    caches.delete(owner); caches.set(owner, entry);
    while (caches.size > 64 || retained > 250000) {
      const oldest = caches.keys().next().value!;
      retained -= caches.get(oldest)!.bars; caches.delete(oldest);
    }
    response = { id, result: execution ? entry.execution.read(bars, options, execution.trades, execution.timeframe) : entry.cache.read(bars, options) };
  } catch (error) { response = { id, error: error instanceof Error ? error.message : "Invalid profile data." }; }
  self.postMessage(response);
};
