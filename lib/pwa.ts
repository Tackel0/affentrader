"use client";

/** Browser-side helpers for the installable app and background push. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let installEvent: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

export function canInstall(): boolean {
  return installEvent !== null;
}

export function onInstallAvailable(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function promptInstall(): Promise<boolean> {
  if (!installEvent) return false;
  await installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  listeners.forEach((l) => l());
  return outcome === "accepted";
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  if (!window.isSecureContext) return null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installEvent = event as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    listeners.forEach((l) => l());
  });
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    window.isSecureContext
  );
}

function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export type PushState = "unsupported" | "denied" | "off" | "on";

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? "on" : "off";
}

/** Ask permission, subscribe and register this browser with the alert server. */
export async function enablePush(serverKey: string): Promise<void> {
  if (!pushSupported()) throw new Error("This browser does not support push notifications here (HTTPS or localhost is required).");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");
  const registration = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
  if (!registration) throw new Error("The service worker could not be registered.");
  await navigator.serviceWorker.ready;
  const { publicKey } = (await (await fetch("/api/push")).json()) as { publicKey: string };
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(publicKey),
    }));
  const response = await fetch("/api/push", {
    method: "POST",
    headers: { "content-type": "application/json", "x-affentrader-key": serverKey },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Server responded with HTTP ${response.status}`);
  }
}

export async function disablePush(serverKey: string): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await fetch(`/api/push?endpoint=${encodeURIComponent(subscription.endpoint)}`, {
    method: "DELETE",
    headers: { "x-affentrader-key": serverKey },
  }).catch(() => undefined);
  await subscription.unsubscribe();
}

export async function sendTestPush(serverKey: string): Promise<{ sent: number }> {
  const response = await fetch("/api/push", {
    method: "POST",
    headers: { "content-type": "application/json", "x-affentrader-key": serverKey },
    body: JSON.stringify({ test: true }),
  });
  const body = (await response.json()) as { sent?: number; error?: string };
  if (!response.ok) throw new Error(body.error ?? "Test push failed.");
  return { sent: body.sent ?? 0 };
}
