export const deploymentDay = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function azureDeploymentDate(revision: string | undefined): Date | null {
  // Azure releases use r<UTC YYYYMMDDhhmmss>-<hash> as the revision suffix.
  const match = revision?.match(/--r(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-[a-f0-9]+$/);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && date.toISOString() === iso ? date : null;
}
