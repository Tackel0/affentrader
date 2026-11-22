export const ACCOUNT_SCOPE_COOKIE = "affentrader-workspace-profile";
export const ACCOUNT_SCOPE_HEADER = "x-affentrader-workspace-profile";
const accountId = /^[a-f0-9]{32}$/;

export function validWorkspaceProfile(value: unknown): value is string {
  return typeof value === "string" && accountId.test(value);
}

export function readWorkspaceProfile(): string {
  if (typeof document === "undefined") return "";
  const value = document.cookie.split(";").map(part => part.trim()).find(part => part.startsWith(`${ACCOUNT_SCOPE_COOKIE}=`))?.slice(ACCOUNT_SCOPE_COOKIE.length + 1);
  return validWorkspaceProfile(value) ? value : "";
}

let tabProfile: string | undefined;
let hadWorkspace = false;
export function workspaceProfile(): string {
  if (typeof window === "undefined") return "";
  if (tabProfile === undefined) {
    tabProfile = readWorkspaceProfile();
    if (tabProfile) {
      const prefix = `affentrader-profile-${tabProfile}:`;
      try { hadWorkspace = ["affentrader-chart-v1", "affentrader-watchlists-v1", "affentrader-premium-v1"].some(key => localStorage.getItem(prefix + key) !== null); }
      catch { /* Workspace persistence is unavailable in this browser. */ }
    }
  }
  return tabProfile;
}

export function hadLocalAccountWorkspace(): boolean { workspaceProfile(); return hadWorkspace; }

export function accountScopedName(base: string): string {
  const profile = workspaceProfile();
  return profile ? `affentrader-profile-${profile}:${base}` : base;
}
