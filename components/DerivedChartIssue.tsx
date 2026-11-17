"use client";
import { useSyncExternalStore } from "react";
import { TriangleAlert } from "lucide-react";
import { derivedRenderIssue, subscribeDerivedIssues } from "@/lib/chart/derivedRenderState";
import { resetDerivedSetting } from "@/lib/chart/derivedSettings";
import { chartTypeInfo, DEFAULT_CHART_TYPE_SETTINGS } from "@/lib/chart/chartTypes";
import { defaultTpo } from "@/lib/orderflow/tpoSettings";
import { defaultFootprint } from "@/lib/orderflow/footprint";
import { seriesPreferencesHost } from "@/lib/chart/seriesBinding";

export function DerivedChartIssue({ layerId, owner, symbol, timeframe, type }: { layerId: string; owner: string; symbol: string; timeframe: string; type: string }) {
  const issue = useSyncExternalStore(subscribeDerivedIssues, () => derivedRenderIssue(layerId), () => null);
  if (!issue || issue.owner !== owner || issue.symbol !== symbol || issue.timeframe !== timeframe || issue.type !== type) return null;
  const title = chartTypeInfo(type)?.label ?? type;
  return <div className="derived-chart-issue" role="alert" aria-label={`${title} chart unavailable`}>
    <strong><TriangleAlert size={14} />{title} chart unavailable</strong>
    <p>{issue.message}</p>
    {Object.hasOwn(DEFAULT_CHART_TYPE_SETTINGS, type) && <button type="button" className="button" onClick={() => resetDerivedSetting(owner, type as keyof typeof DEFAULT_CHART_TYPE_SETTINGS)}>Reset {title} settings</button>}
    {type === "tpo" && seriesPreferencesHost(owner).read()?.tpo && <button type="button" className="button" onClick={() => {
      const host = seriesPreferencesHost(owner), current = host.read(); if (current) host.write({ ...current, tpo: defaultTpo() });
    }}>Reset TPO settings</button>}
    {type === "footprint" && seriesPreferencesHost(owner).read()?.footprint && <button type="button" className="button" onClick={() => {
      const host = seriesPreferencesHost(owner), current = host.read(); if (current) host.write({ ...current, footprint: defaultFootprint() });
    }}>Reset Footprint settings</button>}
  </div>;
}
