import type { PineSession } from "@/lib/alerts/pineSession";
import type { PineAlertSnapshot, PineFrame, PineSeries, PineRecoveryOptions } from "@/types/pineAlerts";
import type { PineJournalSession } from "@/lib/alerts/pineJournal";
import { pineJournalDb } from "@/lib/alerts/pineJournalDb";
import { pineMarketSource } from "@/lib/alerts/pineRecoveryState";
const scope = self as unknown as { postMessage: (value: unknown) => void; onmessage: ((event: MessageEvent) => void) | null };
type SessionEntry =
  | { signature: string; session: PineSession; owner?: undefined }
  | { signature: string; session: PineJournalSession; owner: string };
const sessions = new Map<string, SessionEntry>();
const requests = new Map<string, { owner: string; resolve: (series: PineSeries) => void; reject: (error: Error) => void }>();
const valid = new Map<string, string>();
let queue = Promise.resolve();
scope.onmessage = ({ data }) => {
  if (data.type === "series") { const request = requests.get(data.id); requests.delete(data.id); if (data.error) request?.reject(new Error(data.error)); else request?.resolve(data.series); return; }
  if (data.type === "retain") { queue = queue.then(() => pineJournalDb.prune(data.owners)).catch(error => scope.postMessage({ type: "storage_error", message: String(error) })); return; }
  if (data.type === "ack") {
    queue = queue.then(async () => {
      await pineJournalDb.acknowledge(data.owner, data.journalId, data.sequence);
      for (const entry of sessions.values()) {
        if (entry.owner && entry.owner === data.owner) entry.session.acknowledge(data.sequence);
      }
    }).catch(error => scope.postMessage({ type: "storage_error", message: String(error) }));
    return;
  }
  if (data.type === "drop") { valid.delete(data.key); queue = queue.then(() => { sessions.get(data.key)?.session.dispose(); sessions.delete(data.key); }); return; }
  const { id, key, signature, snapshot, frame, recovery } = data as { id: string; key: string; signature: string; snapshot: PineAlertSnapshot; frame: PineFrame; recovery?: PineRecoveryOptions };
  valid.set(key, signature);
  queue = queue.then(async () => {
    try {
      if (valid.get(key) !== signature) throw new Error("Pine task was superseded.");
      let entry = sessions.get(key);
      if (!entry || entry.signature !== signature) {
        entry?.session.dispose();
        // Startup journal housekeeping only needs IndexedDB. Load the interpreter when a script runs.
        if (recovery) {
          const owner = `${recovery.owner}:${pineMarketSource(frame.series.simulated)}`;
          const [{ PineJournalSession }, journal] = await Promise.all([
            import("@/lib/alerts/pineJournal"), pineJournalDb.load(owner),
          ]);
          if (valid.get(key) !== signature) throw new Error("Pine task was superseded.");
          entry = { signature, owner, session: new PineJournalSession(snapshot, {
            epoch: recovery.epoch, expected: recovery.expected, journal,
            cancelled: () => valid.get(key) !== signature,
            progress: (completed, total) => scope.postMessage({ type: "progress", owner: recovery.owner, completed, total }),
          }) };
        } else {
          const { PineSession } = await import("@/lib/alerts/pineSession");
          if (valid.get(key) !== signature) throw new Error("Pine task was superseded.");
          entry = { signature, session: new PineSession(snapshot) };
        }
        sessions.set(key, entry);
      }
      const result = await entry.session.observe(frame, (symbol, timeframe, count) => new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID(); requests.set(requestId, { owner: id, resolve, reject });
        scope.postMessage({ type: "fetch", id: requestId, owner: id, symbol, timeframe, count });
      }));
      if (entry.owner) await pineJournalDb.append(entry.owner, entry.session.journal!);
      scope.postMessage({ type: "result", id, result });
    } catch (error) {
      sessions.get(key)?.session.dispose(); sessions.delete(key);
      scope.postMessage({ type: "error", id, message: error instanceof Error ? error.message : String(error) });
    } finally {
      for (const [requestId, request] of requests) if (request.owner === id) { requests.delete(requestId); request.reject(new Error("Pine observation finished before secondary data arrived.")); }
    }
  });
};
