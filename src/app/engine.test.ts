import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION,
  formatClock,
  isScheduleDue,
  isSessionOver,
  parseCodeResponse,
  remainingMs,
  runCommandFor,
  sanitizeFilename,
  type Schedule,
} from "./engine";

const HOUR = 3_600_000;

describe("coding session timer", () => {
  it("a 5 hour session keeps going at 4h59m and stops at 5h", () => {
    const start = 1_000_000;
    expect(isSessionOver(start, 300, start + 5 * HOUR - 60_000)).toBe(false);
    expect(isSessionOver(start, 300, start + 5 * HOUR)).toBe(true);
    expect(formatClock(remainingMs(start, 300, start)!)).toBe("05:00:00");
  });

  it("unlimited sessions never end", () => {
    expect(remainingMs(0, null, 1000 * HOUR)).toBeNull();
    expect(isSessionOver(0, null, 1000 * HOUR)).toBe(false);
  });

  it("defaults to a 5 hour session", () => {
    expect(DEFAULT_SESSION.durationMinutes).toBe(300);
  });
});

describe("parsing generated code", () => {
  it("reads filename and code block", () => {
    const r = parseCodeResponse("FILE: tools/hello.py\n```python\nprint('hi')\n```", 1);
    expect(r).toEqual({ filename: "tools/hello.py", language: "python", code: "print('hi')\n" });
  });

  it("never lets a file escape the workspace folder", () => {
    expect(sanitizeFilename("../../Windows/System32/evil.py")).toBe("Windows/System32/evil.py");
    expect(sanitizeFilename("C:\\x\\..\\y.js")).toBe("C_/x/y.js");
  });

  it("picks the right runner", () => {
    expect(runCommandFor("a.py")).toBe('python "a.py"');
    expect(runCommandFor("page.html")).toBeNull();
  });
});

describe("schedules", () => {
  const base: Schedule = { id: "1", name: "VS Code", kind: "app", target: "code", time: "09:00", days: [1], enabled: true };
  const monday9 = new Date(2026, 10, 23, 9, 0); // Mon 23 Nov 2026

  it("fires on the chosen day and time", () => {
    expect(isScheduleDue(base, monday9)).toBe(true);
  });
  it("does not fire on other days", () => {
    expect(isScheduleDue(base, new Date(2026, 10, 24, 9, 0))).toBe(false);
  });
  it("fires only once per day", () => {
    expect(isScheduleDue({ ...base, lastRunKey: "2026-11-23" }, monday9)).toBe(false);
  });
  it("disabled schedules never fire", () => {
    expect(isScheduleDue({ ...base, enabled: false }, monday9)).toBe(false);
  });
});
