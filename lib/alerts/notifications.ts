"use client";
let audio: AudioContext | null = null;
export function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    audio = null;
  }
}
export function playChime() {
  if (!audio || audio.state !== "running") return;
  for (const [index, frequency] of [880, 1174.66, 1567.98].entries()) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const start = audio.currentTime + index * 0.12;
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + 0.4);
  }
}
export async function requestNotifications(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  return (await Notification.requestPermission()) === "granted";
}
export function browserNotify(title: string, body: string) {
  if ("Notification" in window && Notification.permission === "granted")
    new Notification(title, { body, icon: "/icon.svg" });
}
