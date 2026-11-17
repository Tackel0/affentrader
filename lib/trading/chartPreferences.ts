export interface ChartTradingPreferences {showButtons:boolean;instantOrders:boolean}
export const DEFAULT_CHART_TRADING:ChartTradingPreferences={showButtons:true,instantOrders:false};
export function validChartTrading(value:unknown):value is ChartTradingPreferences {
  return Boolean(value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).every(key=>key==="showButtons"||key==="instantOrders")&&typeof (value as ChartTradingPreferences).showButtons==="boolean"&&typeof (value as ChartTradingPreferences).instantOrders==="boolean");
}
