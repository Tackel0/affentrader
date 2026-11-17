export interface ExitLevel {quantity:number;takeProfit:number|null;stopLoss:number|null}
/** Shared draft/order validation; omit quantity only for stored ticket structure. */
export function validateExitLevels(value:unknown,quantity?:number):string|null{
  if(!Array.isArray(value)||value.length>4||Array.from(value).some(l=>!l||typeof l!=="object"||Object.keys(l).some(k=>!["quantity","takeProfit","stopLoss"].includes(k))))return "Use up to four valid exit levels.";
  const levels=value as ExitLevel[];
  if(levels.some(l=>!Number.isFinite(l.quantity)||l.quantity<1e-12||[l.takeProfit,l.stopLoss].some(v=>v!==null&&(!Number.isFinite(v)||!(v!>0)))||l.takeProfit===null&&l.stopLoss===null))return "Each exit needs a positive quantity and at least one positive price.";
  if(levels.length>1&&levels.some(l=>l.takeProfit===null||l.stopLoss===null))return "Multiple exit levels require both take profit and stop loss in every pair.";
  const total=levels.reduce((sum,l)=>sum+l.quantity,0);
  if(!Number.isFinite(total)||quantity!==undefined&&(!Number.isFinite(quantity)||total>quantity&&total-quantity>Math.max(total,quantity)*Number.EPSILON*8))return "Exit quantities cannot exceed the order quantity.";
  return null;
}

export function scaleExitLevels(
  levels: readonly ExitLevel[] | undefined,
  previousOrderQty: number,
  nextOrderQty: number,
): ExitLevel[] | undefined {
  if (!levels?.length || !Number.isFinite(nextOrderQty) || nextOrderQty <= 0) {
    return levels ? levels.map((l) => ({ ...l })) : undefined;
  }
  const totalLevels = levels.reduce((sum, l) => sum + l.quantity, 0);
  const base = Number.isFinite(previousOrderQty) && previousOrderQty > 0 ? previousOrderQty : totalLevels;
  if (!(base > 0)) return levels.map((l) => ({ ...l }));
  const targetTotal =
    Math.abs(totalLevels - base) <= Math.max(totalLevels, base) * 1e-9
      ? nextOrderQty
      : Math.min(nextOrderQty, (totalLevels / base) * nextOrderQty);
  if (levels.length === 1 || targetTotal < levels.length * 1e-12) {
    if (nextOrderQty < 1e-12) return undefined;
    const clampedTarget = Math.min(nextOrderQty, Math.max(1e-12, targetTotal));
    const singleRounded = Number(clampedTarget.toPrecision(12));
    const singleQty =
      singleRounded >= 1e-12 &&
      singleRounded <= clampedTarget + Math.max(clampedTarget, 1) * Number.EPSILON * 4
        ? Math.min(nextOrderQty, singleRounded)
        : clampedTarget;
    return [{ quantity: singleQty, takeProfit: levels[0].takeProfit, stopLoss: levels[0].stopLoss }];
  }
  const factor = targetTotal / totalLevels;
  let allocated = 0;
  const scaled: ExitLevel[] = [];
  for (let i = 0; i < levels.length - 1; i++) {
    const legQty = Math.max(1e-12, Number((levels[i].quantity * factor).toPrecision(8)));
    allocated += legQty;
    scaled.push({ ...levels[i], quantity: legQty });
  }
  const tailRaw = targetTotal - allocated;
  const tailRounded = Number(tailRaw.toPrecision(12));
  const tailQty =
    tailRounded >= 1e-12 &&
    tailRounded <= tailRaw + Math.max(tailRaw, 1) * Number.EPSILON * 4 &&
    allocated + tailRounded <= targetTotal + Math.max(targetTotal, 1) * Number.EPSILON * 4
      ? tailRounded
      : tailRaw;
  scaled.push({ ...levels[levels.length - 1], quantity: tailQty });
  if (scaled.some((l) => l.quantity < 1e-12) || validateExitLevels(scaled, nextOrderQty) !== null) {
    let exactAllocated = 0;
    const exactScaled: ExitLevel[] = [];
    for (let i = 0; i < levels.length - 1; i++) {
      const legQty = (levels[i].quantity / totalLevels) * targetTotal;
      exactAllocated += legQty;
      exactScaled.push({ ...levels[i], quantity: legQty });
    }
    exactScaled.push({ ...levels[levels.length - 1], quantity: Math.max(0, targetTotal - exactAllocated) });
    if (validateExitLevels(exactScaled, nextOrderQty) === null) return exactScaled;
    return nextOrderQty >= 1e-12
      ? [{ quantity: Math.min(nextOrderQty, Math.max(1e-12, targetTotal)), takeProfit: levels[0].takeProfit, stopLoss: levels[0].stopLoss }]
      : undefined;
  }
  return scaled;
}
