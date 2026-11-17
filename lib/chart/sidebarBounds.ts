/** Bound a phone's overlay sidebar to the chart instead of covering its controls. */
export function sidebarBottomInset(ownerBottom: number, chartBottom: number): number {
  return Number.isFinite(ownerBottom) && Number.isFinite(chartBottom) ? Math.max(0, Math.ceil(ownerBottom - chartBottom)) : 0;
}
export function bindSidebarChartBounds(sidebar: HTMLElement, chart: HTMLElement): () => void {
  const update = () => {
    const owner = sidebar.offsetParent instanceof HTMLElement ? sidebar.offsetParent : document.documentElement;
    sidebar.style.setProperty("--sidebar-chart-bottom", `${sidebarBottomInset(owner.getBoundingClientRect().bottom, chart.getBoundingClientRect().bottom)}px`);
  };
  const observer = new ResizeObserver(update);
  observer.observe(chart);
  if (sidebar.offsetParent instanceof HTMLElement) observer.observe(sidebar.offsetParent);
  window.addEventListener("resize", update);
  update();
  return () => { observer.disconnect(); window.removeEventListener("resize", update); sidebar.style.removeProperty("--sidebar-chart-bottom"); };
}
