import type { CrosshairPoint } from "@/types/trading";

let current: CrosshairPoint | null = null;
const listeners = new Set<(point: CrosshairPoint | null, remote: boolean) => void>();

export const readLinkedCrosshair = () => current;

export function subscribeLinkedCrosshair(listener: (point: CrosshairPoint | null, remote: boolean) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setLinkedCrosshair(point: CrosshairPoint | null, remote: boolean): void {
  if ((!point && !current) || (point && current && point.source === current.source &&
    point.symbol === current.symbol && point.time === current.time && point.price === current.price)) return;
  current = point;
  listeners.forEach((listener) => listener(point, remote));
}
