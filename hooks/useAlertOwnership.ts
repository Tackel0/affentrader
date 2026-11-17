"use client";
import { useEffect, useSyncExternalStore } from "react";
import { browserAlertOwner } from "@/lib/alerts/browserOwnership";
import { isPopout } from "@/lib/windowScope";
import type { AlertOwnerSnapshot } from "@/lib/alerts/browserLease";
const initial: AlertOwnerSnapshot = { status: "standby", epoch: 0 };
export function useAlertRole() {
  return useSyncExternalStore(browserAlertOwner().subscribe, browserAlertOwner().snapshot, () => initial);
}
/** Mounted once by the market workspace. Pagehide also handles the back/forward cache. */
export function useAlertOwnership() {
  const role = useAlertRole();
  useEffect(() => {
    if (isPopout()) return;
    const lease = browserAlertOwner(), start = () => lease.start(), stop = () => lease.stop();
    start(); window.addEventListener("pagehide", stop); window.addEventListener("pageshow", start);
    return () => { window.removeEventListener("pagehide", stop); window.removeEventListener("pageshow", start); stop(); };
  }, []);
  return role;
}
