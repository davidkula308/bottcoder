import { describe, expect, it } from "vitest";
import { HISTORY_LIMIT, addRecord, canResume, resumeLeftMs, type SessionRecord } from "./history";

const rec = (id: string): SessionRecord => ({ id, startedAt: 0, endedAt: 1, mode: "project", engine: "ai", files: 1, lines: 10, kept: true, reason: "" });
const MIN = 60_000;

describe("previous sessions", () => {
  it("newest first and keeps the last 50", () => {
    let list: SessionRecord[] = [];
    for (let i = 0; i < 60; i++) list = addRecord(list, rec(String(i)));
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list[0]?.id).toBe("59");
  });
  it("a 5h session closed after 1h12m can continue with 3h48m left", () => {
    const open = { startedAt: 0, elapsedMs: 72 * MIN, durationMinutes: 300, savedAt: 0 };
    expect(resumeLeftMs(open)).toBe(228 * MIN);
    expect(canResume(open)).toBe(true);
  });
  it("offers to continue even short sessions, but never a finished session", () => {
    expect(canResume({ startedAt: 0, elapsedMs: 300 * MIN, durationMinutes: 300, savedAt: 0 })).toBe(false);
    expect(canResume({ startedAt: 0, elapsedMs: 20_000, durationMinutes: null, savedAt: 0 })).toBe(true);
    expect(canResume({ startedAt: 0, elapsedMs: 10 * MIN, durationMinutes: null, savedAt: 0 })).toBe(true);
  });
});
