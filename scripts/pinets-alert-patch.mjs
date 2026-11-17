// SPDX-License-Identifier: AGPL-3.0-only
// Optional observed-price strategy adapter and native broker fill events for PineTS 0.13.0.
export function patchStrategyAlerts(sources) {
  const replace = (text, before, after, expected = 1) => {
    const count = text.split(before).length - 1;
    if (count !== expected) throw new Error(`PineTS alert patch drift: expected ${expected}, found ${count}: ${before.slice(0, 100)}`);
    return text.replaceAll(before, after);
  };
  let core = sources.get("PineTS.class.ts"), utils = sources.get("namespaces/strategy/utils.ts");
  if (!core || !utils) throw new Error("PineTS alert sources unavailable.");
  core = replace(core, "            if (context.strategy) {\n                // Book a second margin call", "            if (context.strategy && !(await (context as any)._liveStrategyPhase?.(context, 'before'))) {\n                // Book a second margin call");
  core = replace(core, "            if (context.strategy) {\n                const rawBar = this._snapBarForBroker(context);\n                riskAtBarClose(context);", "            if (context.strategy && !(await (context as any)._liveStrategyPhase?.(context, 'after'))) {\n                const rawBar = this._snapBarForBroker(context);\n                riskAtBarClose(context);");
  utils = replace(utils, "    const strategy: StrategyState = context.strategy;\n    if (riskBlocksOrder(context, order))", "    const strategy: StrategyState = context.strategy;\n    const alertPreviousPosition = strategy.position_size;\n    if (riskBlocksOrder(context, order))");
  utils = replace(utils, "                riskAfterFill(context, fillPrice);\n                return;", "                emitStrategyOrderFill(context, order, fillPrice, alertPreviousPosition);\n                riskAfterFill(context, fillPrice);\n                return;");
  utils = replace(utils, "                    riskAfterFill(context, fillPrice);\n                } else {", "                    emitStrategyOrderFill(context, order, fillPrice, alertPreviousPosition);\n                    riskAfterFill(context, fillPrice);\n                } else {");
  utils = replace(utils, "    order.fill_time = currentTime;\n    riskAfterFill(context, fillPrice);", "    order.fill_time = currentTime;\n    emitStrategyOrderFill(context, order, fillPrice, alertPreviousPosition);\n    riskAfterFill(context, fillPrice);");
  const closeCall = "            closeMatching(context, order.from_entry, qtyToClose, fillPrice, currentTime, { exitId: order.id, exitComment: order.comment });";
  utils = replace(utils, closeCall, "            const alertPreviousPosition = strategy.position_size;\n" + closeCall + "\n            emitStrategyOrderFill(context, order, fillPrice, alertPreviousPosition);");
  const bracketCall = "        closeMatching(context, order.from_entry, qty, fillPrice, currentTime, { triggerKind: kind, exitId: order.id, exitComment: comment }, t.id);";
  utils = replace(utils, bracketCall, "        const alertPreviousPosition = strategy.position_size;\n" + bracketCall + "\n        emitStrategyOrderFill(context, order, fillPrice, alertPreviousPosition, kind);");
  const marketCall = "            closeMatching(context, order.from_entry, qtyToClose, fillPrice, currentTime, {\n                exitId: order.id,\n                exitComment: order.comment,\n            });";
  utils = replace(utils, marketCall, "            const alertPreviousPosition = strategy.position_size;\n" + marketCall + "\n            emitStrategyOrderFill(context, order, fillPrice, alertPreviousPosition);");
  utils = replace(utils, "                closeMatching(\n                    context,", "                const alertPreviousPosition = strategy.position_size;\n                closeMatching(\n                    context,");
  utils = replace(utils, "                // An exit in an OCA group acts", "                emitStrategyOrderFill(context, order, fillPrice, alertPreviousPosition, ev.kind);\n                // An exit in an OCA group acts");
  const riskCall = "        closePartialPosition(context, Math.abs(strategy.position_size), price, time, { exitId: reason, exitComment: reason, forced: true });";
  utils = replace(utils, riskCall, "        const alertPreviousPosition = strategy.position_size;\n" + riskCall + "\n        const alertRule = reason === RISK_REASON.orders ? 'max_intraday_filled_orders' : reason === RISK_REASON.drawdown ? 'max_drawdown' : reason === RISK_REASON.intraday ? 'max_intraday_loss' : 'max_cons_loss_days';\n        const alertMessage = (strategy.risk_rules as any)?.[alertRule]?.alert_message;\n        emitStrategyOrderFill(context, { id: reason, comment: reason, alert_message: alertMessage } as any, price, alertPreviousPosition);");
  const marginCall = "        closePartialPosition(context, qtyToLiquidate, applySlippage(context, -positionDir, adversePrice), currentTime, {\n            exitId: MARGIN_CALL_EXIT_ID,\n            exitComment: 'Margin call',\n            forced: true,\n        });";
  utils = replace(utils, marginCall, "        const alertPreviousPosition = strategy.position_size;\n" + marginCall + "\n        emitStrategyOrderFill(context, { id: MARGIN_CALL_EXIT_ID, comment: 'Margin call' } as any, applySlippage(context, -positionDir, adversePrice), alertPreviousPosition);");
  const deferred = "    closePartialPosition(context, Math.min(pending.qty, Math.abs(strategy.position_size)), applySlippage(context, -pending.dir, pending.price), pending.time, {";
  utils = replace(utils, deferred, "    const alertPreviousPosition = strategy.position_size;\n" + deferred);
  utils = replace(utils, "    if (Math.abs(strategy.position_size) > 1e-9) {\n", "    emitStrategyOrderFill(context, { id: MARGIN_CALL_EXIT_ID, comment: 'Margin call' } as any, applySlippage(context, -pending.dir, pending.price), alertPreviousPosition);\n    if (Math.abs(strategy.position_size) > 1e-9) {\n");
  utils += String.raw`

/** Emits only at native successful ledger mutations, before subsequent risk actions. */
function emitStrategyOrderFill(context: any, order: Order, price: number, previous: number, leg?: string): void {
    if (typeof context._onStrategyOrderFill !== 'function' || order.disable_alert === true) return;
    const current = context.strategy.position_size, delta = current - previous;
    if (!Number.isFinite(delta) || Math.abs(delta) <= 1e-9 || !Number.isFinite(price)) return;
    const legMessage = leg === 'profit' ? order.alert_profit : leg === 'loss' ? order.alert_loss : leg === 'trailing' ? order.alert_trailing : undefined;
    const legComment = leg === 'profit' ? order.comment_profit : leg === 'loss' ? order.comment_loss : leg === 'trailing' ? order.comment_trailing : undefined;
    context._onStrategyOrderFill({ orderId: order.id, action: delta > 0 ? 'buy' : 'sell', contracts: Math.abs(delta), price,
        comment: legComment ?? order.comment ?? order.id, alertMessage: legMessage ?? order.alert_message ?? '',
        positionSize: current, previousPositionSize: previous, leg: leg ?? (order.category === 'exit' ? 'close' : 'entry') });
}

/** One observed market point; no earlier bar high/low is revisited for live pending orders. */
export function processLiveStrategyPoint(context: any): number {
    const d = context.data, index = d.close.data.length - 1, price = d.close.data[index];
    const full = { open: d.open.data[index], high: d.high.data[index], low: d.low.data[index] }, raw = context._rawBar;
    const pending = new Map(context.strategy.pending_orders.map((order: Order) => [order, order.bar]));
    const count = context.strategy._fillCount ?? 0;
    try {
        d.open.data[index] = d.high.data[index] = d.low.data[index] = price;
        context._rawBar = undefined;
        for (const order of pending.keys() as Iterable<Order>) if (order.status === 'pending' && order.bar >= context.idx) order.bar = context.idx - 1;
        beginStrategyBar(context); riskStartBar(context); applyPendingCloseMarginCall(context);
        processBarOrders(context); finalizeStrategyBar(context);
        return (context.strategy._fillCount ?? 0) - count;
    } finally {
        d.open.data[index] = full.open; d.high.data[index] = full.high; d.low.data[index] = full.low;
        context._rawBar = raw;
        for (const [order, bar] of pending as Map<Order, number>) if (order.status === 'pending') order.bar = bar;
    }
}

/** Only confirmed bars use process_orders_on_close; explicit immediate closes also work intrabar. */
export function processLiveStrategyClose(context: any, confirmed: boolean): number {
    const strategy = context.strategy, count = strategy._fillCount ?? 0, onClose = strategy.config.process_orders_on_close;
    try {
        if (confirmed) { riskAtBarClose(context); if (!strategy._pending_close_mc) processMarginCall(context, 'close'); riskAtBarClose(context); }
        else strategy.config.process_orders_on_close = false;
        processOrdersOnClose(context);
        return (strategy._fillCount ?? 0) - count;
    } finally { strategy.config.process_orders_on_close = onClose; }
}
`;
  sources.set("PineTS.class.ts", core); sources.set("namespaces/strategy/utils.ts", utils);
  for (const name of ["entry", "order"]) {
    const key = `namespaces/strategy/methods/${name}.ts`, text = sources.get(key);
    if (!text) throw new Error(`PineTS ${name} source unavailable.`);
    sources.set(key, replace(text, "            comment: commentValue,", "            comment: commentValue,\n            alert_message: extractValue(parsed.alert_message),\n            disable_alert: extractValue(parsed.disable_alert),"));
  }
  let risk = sources.get("namespaces/strategy/methods/risk.ts");
  if (!risk) throw new Error("PineTS risk source unavailable.");
  risk = replace(risk, "{ value: Number(argValue(value)), type: argValue(type) };", "{ value: Number(argValue(value)), type: argValue(type), alert_message: argValue(_alert_message) };", 2);
  sources.set("namespaces/strategy/methods/risk.ts", risk);
}
