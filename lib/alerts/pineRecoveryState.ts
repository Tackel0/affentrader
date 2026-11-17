import type { AlertRule } from "@/types/alerts";
import type { PineJournalCursor } from "@/types/pineAlerts";
import { isSymbolId } from "@/lib/symbolId";
export const pineRunEpoch = (rule: AlertRule, symbol: string) => rule.pineMemberEpochs?.[symbol] ?? rule.pineEpoch;
export const pineMarketSource = (simulated?: boolean) => simulated ? "simulation" as const : "exchange" as const;
export const pineOwner = (ruleId: string, symbol: string) => `saved:${ruleId}:${symbol}`;
export const validPineEpoch = (value: unknown): value is string => typeof value === "string" && /^[\w-]{1,100}$/.test(value);
export function validPineCursor(value: unknown): value is PineJournalCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cursor = value as PineJournalCursor;
  return typeof cursor.id === "string" && /^[a-f\d-]{36}$/.test(cursor.id) && validPineEpoch(cursor.epoch) && Number.isSafeInteger(cursor.sequence) && cursor.sequence >= 1 && cursor.sequence <= 1_000_000 && Number.isSafeInteger(cursor.time) && cursor.time >= 0;
}
export function validatePineRecoveryFields(rule: AlertRule): string | null {
  if (rule.pineEpoch !== undefined && !validPineEpoch(rule.pineEpoch)) return "Invalid Pine run identity.";
  if (rule.pineMemberEpochs !== undefined && (!rule.pineMemberEpochs || typeof rule.pineMemberEpochs !== "object" || Array.isArray(rule.pineMemberEpochs) || Object.keys(rule.pineMemberEpochs).length > 1000 || Object.entries(rule.pineMemberEpochs).some(([symbol, epoch]) => !isSymbolId(symbol) || !validPineEpoch(epoch)))) return "Invalid Pine member run identities.";
  if (rule.pineCursors !== undefined && (!rule.pineCursors || typeof rule.pineCursors !== "object" || Array.isArray(rule.pineCursors) || Object.keys(rule.pineCursors).length > 1000 || Object.entries(rule.pineCursors).some(([symbol, sources]) => !isSymbolId(symbol) || !sources || typeof sources !== "object" || Array.isArray(sources) || Object.entries(sources).some(([source, cursor]) => !["exchange", "simulation"].includes(source) || !validPineCursor(cursor) || cursor.epoch !== pineRunEpoch(rule, symbol))))) return "Invalid Pine journal firing cursors.";
  return null;
}
