// Pure rules for in-app updates (the feed lives on the published site under /updates).
export const PUBLISHED_APP_URL = "https://bottcoder.lovable.app";
export const UPDATE_FEED_URL = `${PUBLISHED_APP_URL}/updates`;

export interface UpdateInfo {
  current: string;
  latest: string | null;
  available: boolean;
  notes: string;
  error?: string;
}

/** Manual fetch checks the published feed, then installs only while coding is stopped. */
export async function fetchAndInstallUpdate(options: {
  check: () => Promise<UpdateInfo>;
  apply: (onProgress: (status: string) => void) => Promise<boolean>;
  isRunning: () => boolean;
  onInfo: (info: UpdateInfo) => void;
  onStatus: (status: string) => void;
}): Promise<"installed" | "queued" | "current" | "error"> {
  try {
    options.onStatus("Fetching updates from the published app…");
    const info = await options.check();
    options.onInfo(info);
    if (info.error) throw new Error(info.error);
    if (!info.available) {
      options.onStatus(`Up to date · version ${info.current}.`);
      return "current";
    }
    if (options.isRunning()) {
      options.onStatus(`Version ${info.latest} found. It will install when coding stops.`);
      return "queued";
    }
    options.onStatus("Downloading update files…");
    const installed = await options.apply(options.onStatus);
    options.onStatus(installed ? `Updated to ${info.latest} — restarting…` : "The latest version is already installed.");
    return installed ? "installed" : "current";
  } catch (e) {
    options.onStatus(`Could not fetch updates: ${String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, "")}. Try Fetch updates again.`);
    return "error";
  }
}

/** Compares "1.2.10" style versions. Returns >0 when a is newer than b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Only files of the app itself may be replaced by an update. */
export function isSafeUpdatePath(p: string): boolean {
  if (!p || p.includes("..") || p.includes("\\") || p.startsWith("/") || /^[a-z]:/i.test(p)) return false;
  return p === "package.json" || p.startsWith("electron/") || p.startsWith("dist-electron/renderer/");
}
