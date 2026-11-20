"use client";

import { useEffect, useState } from "react";
import { hotStorage } from "@/lib/debouncedStorage";

const CHECK_INTERVAL_MS = 60_000;
const CHECK_TIMEOUT_MS = 8_000;

export function DeploymentUpdate({ loadedRevision }: { loadedRevision: string }) {
  const [available, setAvailable] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    let request: AbortController | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    async function check() {
      if (document.hidden || request) return;
      const controller = new AbortController();
      request = controller;
      timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
      try {
        const response = await fetch("/api/health", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const health = await response.json();
        if (!controller.signal.aborted && health?.ok === true && typeof health.revision === "string" && health.revision) {
          setAvailable(health.revision === loadedRevision ? null : health.revision);
        }
      } catch {
        // A network failure doesn't tell us the hosted revision changed.
      } finally {
        clearTimeout(timeout);
        request = null;
      }
    }

    const interval = setInterval(check, CHECK_INTERVAL_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    void check();
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
      request?.abort();
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [loadedRevision]);

  if (!available || available === loadedRevision || available === dismissed) return null;
  return (
    <aside className="deployment-update" lang="de" aria-label="AffenTerminal-Update">
      <span role="status">Neue Version verfügbar</span>
      <button className="button primary" type="button" onClick={() => {
        hotStorage.flush();
        window.location.reload();
      }}>Neu laden</button>
      <button
        className="button deployment-update-dismiss"
        type="button"
        aria-label="Update-Hinweis schließen"
        onClick={() => setDismissed(available)}
      >×</button>
    </aside>
  );
}
