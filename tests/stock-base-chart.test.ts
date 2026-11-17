import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StockBaseChart } from "@/components/StockBaseChart";

const first = "2026-06-01";
const retest = "2026-06-05";
const failed = "2026-06-09";
const lost = "2026-06-10";
const row = {
  name: "Example stock",
  chart: [first, retest, failed, lost].map(session => ({ session, open: 100, high: 101, low: 97, close: 98 })),
  resistance: 100,
  invalidation: 98,
  firstLow: { session: first },
  retest: { session: retest },
};

describe("scanner chart event labels", () => {
  it.each([lost, failed])("exposes both events when support is lost on %s", supportLostOn => {
    const markup = renderToStaticMarkup(createElement(StockBaseChart, { row: {
      ...row,
      progress: { status: "support-lost", statusSince: supportLostOn, breakoutFailedOn: failed, supportLostOn },
    } }));
    expect(markup).toContain(`Breakout failed on ${failed}. Support lost on ${supportLostOn}.`);
    expect(markup).toContain(`× Breakout failed on ${failed}`);
    expect(markup).toContain(`! Support lost on ${supportLostOn}`);
  });

  it("uses the status date if that is the only available date and the candle is visible", () => {
    const progress = { status: "support-lost" as const, statusSince: lost };
    const visible = renderToStaticMarkup(createElement(StockBaseChart, { row: { ...row, progress } }));
    const outside = renderToStaticMarkup(createElement(StockBaseChart, { row: { ...row, chart: row.chart.slice(0, -1), progress } }));
    expect(visible).toContain(`Support lost on ${lost}`);
    expect(outside).not.toContain("Support lost");
  });
});
