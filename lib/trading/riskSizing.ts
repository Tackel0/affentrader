export interface RiskSizeInput {
  side: "buy" | "sell";
  entryPrice: number | undefined;
  stopLoss: number | undefined;
  takeProfit?: number | undefined;
  accountEquity: number;
  riskAmount: number;
  maxQuantity?: number;
  feeRate?: number;
}

export interface RiskSizeSuccess {
  ok: true;
  quantity: number;
  cappedByPower: boolean;
  stopDistance: number;
  stopDistancePct: number;
  actualRiskAmount: number;
  actualRiskPercent: number;
  rewardAmount: number | null;
  riskRewardRatio: number | null;
}

export interface RiskSizeError {
  ok: false;
  reason: string;
}

export type RiskSizeResult = RiskSizeSuccess | RiskSizeError;

export interface TicketRiskSummary {
  valid: boolean;
  reason?: string;
  stopDistancePct: number | null;
  riskAmount: number | null;
  riskPercent: number | null;
  rewardAmount: number | null;
  riskRewardRatio: number | null;
}

function floorSignificant(value: number, sigFigs = 4): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const magnitude = Math.floor(Math.log10(value));
  const factor = 10 ** (sigFigs - 1 - magnitude);
  const floored = Math.floor(value * factor + 1e-12) / factor;
  return Number(floored.toPrecision(sigFigs));
}

function validStopForSide(
  side: "buy" | "sell",
  entryPrice: number,
  stopLoss: number,
): boolean {
  return side === "buy" ? stopLoss < entryPrice : stopLoss > entryPrice;
}

function validTargetForSide(
  side: "buy" | "sell",
  entryPrice: number,
  takeProfit: number,
): boolean {
  return side === "buy" ? takeProfit > entryPrice : takeProfit < entryPrice;
}

/**
 * Computes position quantity so that a stop-loss exit (including estimated
 * entry + exit fees) loses at most `riskAmount`, capped by available buying power.
 */
export function calculateRiskPositionSize(input: RiskSizeInput): RiskSizeResult {
  const {
    side,
    entryPrice,
    stopLoss,
    takeProfit,
    accountEquity,
    riskAmount,
    maxQuantity,
    feeRate = 0,
  } = input;

  if (!entryPrice || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    return { ok: false, reason: "Waiting for a valid entry price." };
  }
  if (!stopLoss || !Number.isFinite(stopLoss) || stopLoss <= 0) {
    return { ok: false, reason: "Enter a stop loss price to size by risk." };
  }
  if (!validStopForSide(side, entryPrice, stopLoss)) {
    return {
      ok: false,
      reason:
        side === "buy"
          ? "Stop loss must be below entry price for a buy order."
          : "Stop loss must be above entry price for a sell order.",
    };
  }
  if (!Number.isFinite(accountEquity) || accountEquity <= 0) {
    return { ok: false, reason: "Account equity must be positive." };
  }
  if (!Number.isFinite(riskAmount) || riskAmount <= 0) {
    return { ok: false, reason: "Risk amount must be positive." };
  }

  const cleanFee = Math.max(0, feeRate);
  const stopDistance = Math.abs(entryPrice - stopLoss);
  const stopDistancePct = (stopDistance / entryPrice) * 100;
  const riskPerUnit = stopDistance + (entryPrice + stopLoss) * cleanFee;
  if (!(riskPerUnit > 0)) {
    return { ok: false, reason: "Stop distance is too small." };
  }

  let rawQty = riskAmount / riskPerUnit;
  let cappedByPower = false;
  if (
    maxQuantity !== undefined &&
    Number.isFinite(maxQuantity) &&
    maxQuantity >= 0 &&
    rawQty > maxQuantity
  ) {
    rawQty = maxQuantity;
    cappedByPower = true;
  }

  const quantity = floorSignificant(rawQty, 4);
  if (!(quantity > 0)) {
    return { ok: false, reason: "Insufficient buying power for this stop distance." };
  }

  const actualRiskAmount = quantity * riskPerUnit;
  const actualRiskPercent = (actualRiskAmount / accountEquity) * 100;

  let rewardAmount: number | null = null;
  let riskRewardRatio: number | null = null;
  if (
    takeProfit !== undefined &&
    Number.isFinite(takeProfit) &&
    takeProfit > 0 &&
    validTargetForSide(side, entryPrice, takeProfit)
  ) {
    const rewardDistance = Math.abs(takeProfit - entryPrice);
    const netRewardPerUnit = Math.max(
      0,
      rewardDistance - (entryPrice + takeProfit) * cleanFee,
    );
    rewardAmount = quantity * netRewardPerUnit;
    riskRewardRatio = rewardDistance / stopDistance;
  }

  return {
    ok: true,
    quantity,
    cappedByPower,
    stopDistance,
    stopDistancePct,
    actualRiskAmount,
    actualRiskPercent,
    rewardAmount,
    riskRewardRatio,
  };
}

/** Evaluates live dollar risk, % of equity, and R:R for the current ticket quantity. */
export function evaluateTicketRisk(input: {
  side: "buy" | "sell";
  entryPrice: number | undefined;
  stopLoss: number | undefined;
  takeProfit: number | undefined;
  quantity: number;
  accountEquity: number;
  feeRate?: number;
}): TicketRiskSummary {
  const {
    side,
    entryPrice,
    stopLoss,
    takeProfit,
    quantity,
    accountEquity,
    feeRate = 0,
  } = input;

  if (!entryPrice || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    return { valid: false, stopDistancePct: null, riskAmount: null, riskPercent: null, rewardAmount: null, riskRewardRatio: null };
  }
  if (!stopLoss || !Number.isFinite(stopLoss) || stopLoss <= 0) {
    return { valid: false, stopDistancePct: null, riskAmount: null, riskPercent: null, rewardAmount: null, riskRewardRatio: null };
  }
  if (!validStopForSide(side, entryPrice, stopLoss)) {
    return {
      valid: false,
      reason:
        side === "buy"
          ? "SL must be below entry"
          : "SL must be above entry",
      stopDistancePct: null,
      riskAmount: null,
      riskPercent: null,
      rewardAmount: null,
      riskRewardRatio: null,
    };
  }

  const cleanFee = Math.max(0, feeRate);
  const stopDistance = Math.abs(entryPrice - stopLoss);
  const stopDistancePct = (stopDistance / entryPrice) * 100;
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
  const riskPerUnit = stopDistance + (entryPrice + stopLoss) * cleanFee;
  const riskAmount = qty * riskPerUnit;
  const riskPercent =
    accountEquity > 0 ? (riskAmount / accountEquity) * 100 : null;

  let rewardAmount: number | null = null;
  let riskRewardRatio: number | null = null;
  if (
    takeProfit !== undefined &&
    Number.isFinite(takeProfit) &&
    takeProfit > 0 &&
    validTargetForSide(side, entryPrice, takeProfit)
  ) {
    const rewardDistance = Math.abs(takeProfit - entryPrice);
    const netRewardPerUnit = Math.max(
      0,
      rewardDistance - (entryPrice + takeProfit) * cleanFee,
    );
    rewardAmount = qty * netRewardPerUnit;
    riskRewardRatio = rewardDistance / stopDistance;
  }

  return {
    valid: true,
    stopDistancePct,
    riskAmount,
    riskPercent,
    rewardAmount,
    riskRewardRatio,
  };
}
