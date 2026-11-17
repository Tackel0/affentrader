import { PineSession } from "@/lib/alerts/pineSession";
import type { PineAlertSnapshot, PineFrame, PineSeries, PineRecoveryOptions } from "@/types/pineAlerts";
import { PineJournalSession } from "@/lib/alerts/pineJournal";
import { pineJournalDb } from "@/lib/alerts/pineJournalDb";
import { pineMarketSource } from "@/lib/alerts/pineRecoveryState";
const scope = self as unknown as { postMessage: (value: unknown) => void; onmessage: ((event: MessageEvent) => void) | null };
const sessions = new Map<string, { signature: string; session: PineSession | PineJournalSession; owner?: string }>();
const requests = new Map<string, { owner: string; resolve: (series: PineSeries) => void; reject: (error: Error) => void }>();
const valid = new Map<string, string>();
let queue = Promise.resolve();
scope.onmessage = ({ data }) => {
  if (data.type === "series") { const request = requests.get(data.id); requests.delete(data.id); if (data.error) request?.reject(new Error(data.error)); else request?.resolve(data.series); return; }
  if (data.type === "retain") { queue = queue.then(() => pineJournalDb.prune(data.owners)).catch(error => scope.postMessage({ type: "storage_error", message: String(error) })); return; }
  if (data.type === "ack") { queue = queue.then(async () => { await pineJournalDb.acknowledge(data.owner, data.journalId, data.sequence); for (const entry of sessions.values()) if (entry.owner === data.owner && entry.session instanceof PineJournalSession) entry.session.acknowledge(data.sequence); }).catch(error => scope.postMessage({ type: "storage_error", message: String(error) })); return; }
  if (data.type === "drop") { valid.delete(data.key); queue = queue.then(() => { sessions.get(data.key)?.session.dispose(); sessions.delete(data.key); }); return; }
  const { id, key, signature, snapshot, frame, recovery } = data as { id: string; key: string; signature: string; snapshot: PineAlertSnapshot; frame: PineFrame; recovery?: PineRecoveryOptions };
  valid.set(key, signature);
  queue = queue.then(async () => {
    try {
      if (valid.get(key) !== signature) throw new Error("Pine task was superseded.");
      let entry = sessions.get(key);
      if (!entry || entry.signature !== signature) {
        entry?.session.dispose();
        const owner = recovery ? `${recovery.owner}:${pineMarketSource(frame.series.simulated)}` : undefined;
        entry = { signature, owner, session: recovery && owner ? new PineJournalSession(snapshot, { epoch: recovery.epoch, expected: recovery.expected,
          journal: await pineJournalDb.load(owner), cancelled: () => valid.get(key) !== signature,
          progress: (completed, total) => scope.postMessage({ type: "progress", owner: recovery.owner, completed, total }) }) : new PineSession(snapshot) };
        sessions.set(key, entry);
      }
      const result = await entry.session.observe(frame, (symbol, timeframe, count) => new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID(); requests.set(requestId, { owner: id, resolve, reject });
        scope.postMessage({ type: "fetch", id: requestId, owner: id, symbol, timeframe, count });
      }));
      if (entry.session instanceof PineJournalSession && entry.owner) await pineJournalDb.append(entry.owner, entry.session.journal!);
      scope.postMessage({ type: "result", id, result });
    } catch (error) {
      sessions.get(key)?.session.dispose(); sessions.delete(key);
      scope.postMessage({ type: "error", id, message: error instanceof Error ? error.message : String(error) });
    } finally {
      for (const [requestId, request] of requests) if (request.owner === id) { requests.delete(requestId); request.reject(new Error("Pine observation finished before secondary data arrived.")); }
    }
  });
};
