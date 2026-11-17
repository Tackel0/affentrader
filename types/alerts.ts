import type { PriceSource } from "@/lib/ta";

/** What a condition looks at. */
export type Operand =
  | { type: "number"; value: number }
  | { type: "price"; field: PriceSource }
  /** A technical study evaluated on the context's bars. */
  | {
      type: "indicator";
      indicator: string;
      params?: Record<string, number>;
      /** Which output line to read (defaults to the study's first). */
      plot?: string;
    }
  /** A drawn straight line; its price is read at the time of the bar being evaluated. */
  | {
      type: "line";
      from: { time: number; price: number };
      to: { time: number; price: number };
      extend: "none" | "left" | "right" | "both";
    }
  /** Provider quote fields. Range/volume provenance follows QuoteMetrics; missing values are unavailable. */
  | { type: "quote"; field: "price" | "changePercent" | "volume" | "high" | "low" };

export type Comparator =
  | ">"
  | "<"
  | ">="
  | "<="
  | "crossing"
  | "crossing_up"
  | "crossing_down";

/** The market a leaf condition is evaluated on; omitted = the rule's own scope. */
export interface ConditionContext {
  symbol?: string;
  timeframe?: string;
}

/** Sources with an actual candle-aligned history, rather than provider quote snapshots. */
export type MovementOperand = Extract<Operand, { type: "price" | "indicator" }>;

export type Leaf = ConditionContext &
  (
    | { type: "compare"; left: Operand; comparator: Comparator; right: Operand }
    | {
        type: "band";
        operand: Operand;
        low: number;
        high: number;
        mode: "entering" | "exiting" | "inside" | "outside";
      }
    | {
        type: "change";
        /** Percent move over `bars` bars (or 24h when operand is a quote). */
        percent: number;
        bars: number;
        direction: "up" | "down" | "either";
      }
    | {
        type: "movement";
        operand: MovementOperand;
        direction: "up" | "down";
        unit: "absolute" | "percent";
        amount: number;
        /** Current source value versus the same source this many bars ago. */
        bars: number;
      }
    | { type: "volume_spike"; multiple: number; length: number }
    | { type: "extreme"; kind: "high" | "low"; length: number }
    | { type: "pattern"; patternId: string }
    | { type: "pine"; snapshot: import("./pineAlerts").PineAlertSnapshot }
    | import("./tpoAlerts").TpoAlertCondition
    | import("./drawingAlerts").DrawingAlertCondition
  );

export type Condition =
  | { op: "all"; conditions: Condition[] }
  | { op: "any"; conditions: Condition[] }
  | { op: "leaf"; leaf: Leaf };

export type RuleKind = "technical" | "watchlist" | "composite" | "pine" | "drawing";
export type RuleStatus = "active" | "paused" | "triggered" | "expired" | "stopped";
export type AlertTrigger = "once" | "every_time" | "once_per_bar" | "once_per_close" | "once_per_minute";

export interface AlertRateState {
  recent: { symbol: string; time: number }[];
  /** A rate-limited watchlist member stays stopped until explicitly restarted. */
  stoppedSymbols: Record<string, number>;
  /** Changes on explicit rearming, so observation baselines can reset without replay. */
  resetAt?: number;
  /** Present only when an explicit rearm targets stopped members rather than the whole rule. */
  resetSymbols?: string[];
}
export interface AlertStop {
  reason: "trigger_rate" | "watchlist_rate" | "script_error" | "drawing_unavailable";
  time: number;
  detail?: string;
}
export interface AlertRateFields {
  rate?: AlertRateState;
  stop?: AlertStop;
}

export interface Webhook {
  url: string;
  /** Optional shared secret used to sign the body (HMAC-SHA256, `x-affentrader-signature`). */
  secret?: string;
}

export interface AlertLifecycleFields {
  /** First trustworthy observation of this alert's edit/trigger activity. */
  activity?: { trackedAt:number; editedAt?:number; triggeredAt?:number };
  expiration?: { reason:"date"|"inactivity"; time:number };
}

export interface AlertRule extends AlertRateFields,AlertLifecycleFields {
  id: string;
  name: string;
  kind: RuleKind;
  status: RuleStatus;
  /** `symbol` rules evaluate one market; `watchlist` rules every symbol of a list. */
  scope:
    | { type: "symbol"; symbol: string; timeframe: string }
    | { type: "watchlist"; listId: string; symbols: string[]; timeframe: string };
  condition: Condition;
  /** Evaluate on each price update or only when a bar closes. */
  frequency: "tick" | "close";
  repeat: boolean;
  /** Absent on legacy alerts, whose frequency/repeat transition behavior is retained. */
  trigger?: AlertTrigger;
  /** Epoch milliseconds; absent means open ended. */
  expiresAt?: number;
  /** Completed members of a one-shot watchlist alert. */
  triggeredSymbols?: string[];
  lastFired?: Record<string, { time: number; bar?: number }>;
  scriptState?: Record<string, Record<string, { bar: number; time: number; token?: string }>>;
  pineEpoch?: string;
  /** A deleted drawing or disabled selected level stops evaluation until repaired. */
  drawingIssue?: string;
  /** Last observed drawing source, including unavailable/removed states. */
  drawingRevision?: string;
  pineMemberEpochs?: Record<string, string>;
  pineCursors?: Record<string, Partial<Record<"exchange" | "simulation", import("./pineAlerts").PineJournalCursor>>>;
  /** Minimum time between two firings of the same (rule, symbol). */
  cooldownMs: number;
  message?: string;
  sound: boolean;
  browserNotification: boolean;
  /** Evaluate on the server so it keeps running when no browser is open. */
  serverSide: boolean;
  webhook?: Webhook;
  createdAt: number;
  lastTriggeredAt?: number;
}

export interface RuleEvent {
  id: string;
  ruleId: string;
  name: string;
  symbol: string;
  timeframe: string;
  price: number;
  time: number;
  message: string;
  source: "browser" | "server";
  simulated?: boolean;
  barTime?: number;
  scriptGate?: { key: string; bar: number; token?: string };
  /** Native strategy broker emulation; this is not a real broker execution. */
  strategyFill?: import("./pineAlerts").PineOrderFill;
  /** Webhook delivery state for server events. */
  delivery?: {
    status: "none" | "pending" | "delivered" | "failed";
    attempts: number;
    lastError?: string;
    nextAttemptAt?: number;
  };
}
