// Pure rules for "activity apps": during a coding session, open a chosen app now and then, then close it.

export interface ActivityApp {
  name: string;
  path: string;
}

export interface ActivityConfig {
  enabled: boolean;
  /** Open an app every this many minutes of coding (first one after the same time). */
  everyMinutes: number;
  /** How long the app stays open before it is closed again. */
  openSeconds: number;
  /** Open minimized so it doesn't steal the keyboard from live typing. */
  minimized: boolean;
  apps: ActivityApp[];
}

export const DEFAULT_ACTIVITY: ActivityConfig = {
  enabled: false,
  everyMinutes: 30,
  openSeconds: 20,
  minimized: false,
  apps: [],
};

export const ACTIVITY_PRESETS = [30, 40] as const;

/** How many app openings are due after this much coding time. */
export function activityCyclesDue(elapsedMs: number, everyMinutes: number): number {
  if (!(everyMinutes >= 1) || elapsedMs <= 0) return 0;
  return Math.floor(elapsedMs / (everyMinutes * 60_000));
}

/** True when the next app opening is due; `done` = openings already made in this session. */
export function isActivityDue(cfg: ActivityConfig, elapsedMs: number, done: number): boolean {
  return cfg.enabled && cfg.apps.length > 0 && activityCyclesDue(elapsedMs, cfg.everyMinutes) > done;
}

/** Milliseconds until the next opening (from the session's elapsed time). */
export function msUntilNextActivity(elapsedMs: number, everyMinutes: number, done: number): number {
  return Math.max(0, (done + 1) * everyMinutes * 60_000 - elapsedMs);
}

/** Random app from the list, avoiding the one opened last time when there is a choice. */
export function pickActivityApp(apps: ActivityApp[], rand: () => number, lastPath?: string): ActivityApp | null {
  if (!apps.length) return null;
  const pool = apps.length > 1 ? apps.filter((a) => a.path !== lastPath) : apps;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))] ?? null;
}

/** Keeps the setting sane: at least 1 minute between openings, 3 to 600 seconds open. */
export function clampActivity(cfg: ActivityConfig): ActivityConfig {
  return {
    ...cfg,
    everyMinutes: Math.max(1, Math.round(cfg.everyMinutes || 30)),
    openSeconds: Math.min(600, Math.max(3, Math.round(cfg.openSeconds || 20))),
  };
}
