// Previous sessions, kept on this PC so they survive closing and reopening the app.

export interface SessionRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  mode: string;
  /** "ai" = written by the AI model, "practice" = built-in practice code (no AI found) */
  engine: "ai" | "practice" | "mixed";
  files: number;
  lines: number;
  kept: boolean;
  reason: string;
}

/** A session that was still running when the app closed. */
export interface OpenSession {
  startedAt: number;
  elapsedMs: number;
  durationMinutes: number | null;
  savedAt: number;
}

export const HISTORY_LIMIT = 50;

export function addRecord(list: SessionRecord[], rec: SessionRecord): SessionRecord[] {
  return [rec, ...list.filter((r) => r.id !== rec.id)].slice(0, HISTORY_LIMIT);
}

/** Time still left for a session cut off by closing the app; null = unlimited, 0 = nothing left. */
export function resumeLeftMs(open: OpenSession): number | null {
  if (open.durationMinutes === null) return null;
  return Math.max(0, open.durationMinutes * 60_000 - open.elapsedMs);
}

/** Worth offering "continue": it ran at least a minute and has time left. */
export function canResume(open: OpenSession | null): boolean {
  if (!open || open.elapsedMs < 60_000) return false;
  const left = resumeLeftMs(open);
  return left === null || left > 60_000;
}

export function totalCodingMs(list: SessionRecord[]): number {
  return list.reduce((s, r) => s + Math.max(0, r.endedAt - r.startedAt), 0);
}
