// Pure rules for in-app updates (the feed lives on the published site under /updates).

export interface UpdateInfo {
  current: string;
  latest: string | null;
  available: boolean;
  notes: string;
  error?: string;
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
