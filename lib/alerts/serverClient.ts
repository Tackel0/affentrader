import type { AlertRule, RuleEvent } from "@/types/alerts";
import type { RunnerHealth } from "@/stores/useServerStore";

export class ServerError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(key: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      "x-affentrader-key": key,
    },
    signal: AbortSignal.timeout(12_000),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok)
    throw new ServerError(body.error ?? `Server responded with HTTP ${response.status}`, response.status);
  return body;
}

export interface ServerSnapshot {
  rules: AlertRule[];
  events: (RuleEvent & { seq: number })[];
  cursor: number;
  runner: RunnerHealth;
  serverTime: number;
}

export const serverAlerts = {
  snapshot: (key: string) => call<ServerSnapshot>(key, "/api/alerts"),
  save: (key: string, rule: AlertRule) =>
    call<{ rule: AlertRule }>(key, "/api/alerts", {
      method: "PUT",
      body: JSON.stringify({ rule }),
    }),
  remove: (key: string, id: string) =>
    call<{ removed: boolean }>(key, `/api/alerts?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  members: (key: string, id: string, symbols: string[]) => call<{ rule: AlertRule }>(key, "/api/alerts", {
    method: "PATCH", body: JSON.stringify({ id, symbols }),
  }),
  drawing:(key:string,id:string,expected:string,drawing:import("@/types/drawingAlerts").DrawingAlertGeometry|null)=>call<{rule:AlertRule}>(key,"/api/alerts",{method:"PATCH",body:JSON.stringify({id,expected,drawing})}),
  control: (key: string, id: string, action: "pause" | "resume" | "restart" | "restart_symbols") => call<{ rule: AlertRule }>(key, "/api/alerts", {
    method: "PATCH", body: JSON.stringify({ id, action }),
  }),
  testWebhook: (key: string, webhook: { url: string; secret?: string }) =>
    call<{ delivered: boolean }>(key, "/api/alerts", {
      method: "POST",
      body: JSON.stringify({ action: "test", webhook }),
    }),
  events: (key: string, after: number) =>
    call<{ events: (RuleEvent & { seq: number })[]; cursor: number }>(key, `/api/alerts/events?after=${after}`),
  forward: (key: string, event: RuleEvent, webhook: NonNullable<AlertRule["webhook"]>) =>
    call<{ queued: number }>(key, "/api/alerts/events", {
      method: "POST",
      body: JSON.stringify({ event, webhook }),
    }),
};
