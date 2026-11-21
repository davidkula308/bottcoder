import { describe, expect, it } from "vitest";
import { DEFAULT_ACTIVITY, clampActivity, isActivityDue, msUntilNextActivity, pickActivityApp } from "./activity";

const MIN = 60_000;
const apps = [
  { name: "Notepad", path: "C:\\Windows\\notepad.exe" },
  { name: "Paint", path: "C:\\Windows\\mspaint.exe" },
];
const on = { ...DEFAULT_ACTIVITY, enabled: true, apps };

describe("activity apps during a session", () => {
  it("every 30 minutes: nothing at 29m, first app at 30m, second at 60m", () => {
    expect(isActivityDue(on, 29 * MIN, 0)).toBe(false);
    expect(isActivityDue(on, 30 * MIN, 0)).toBe(true);
    expect(isActivityDue(on, 45 * MIN, 1)).toBe(false);
    expect(isActivityDue(on, 60 * MIN, 1)).toBe(true);
  });
  it("every 40 minutes: first app at 40m", () => {
    const cfg = { ...on, everyMinutes: 40 };
    expect(isActivityDue(cfg, 39 * MIN, 0)).toBe(false);
    expect(isActivityDue(cfg, 40 * MIN, 0)).toBe(true);
  });
  it("custom 7 minutes works and reports time to the next one", () => {
    expect(isActivityDue({ ...on, everyMinutes: 7 }, 7 * MIN, 0)).toBe(true);
    expect(msUntilNextActivity(10 * MIN, 7, 1)).toBe(4 * MIN);
  });
  it("does nothing when switched off or no apps are chosen", () => {
    expect(isActivityDue({ ...on, enabled: false }, 90 * MIN, 0)).toBe(false);
    expect(isActivityDue({ ...on, apps: [] }, 90 * MIN, 0)).toBe(false);
  });
  it("picks a random app but not the same one twice in a row", () => {
    expect(pickActivityApp(apps, () => 0, apps[0]?.path)?.name).toBe("Paint");
    expect(pickActivityApp(apps, () => 0.99)?.name).toBe("Paint");
    expect(pickActivityApp([apps[0]!], () => 0, apps[0]?.path)?.name).toBe("Notepad");
  });
  it("keeps the app open between 3 and 600 seconds and at least 1 minute apart", () => {
    expect(clampActivity({ ...on, openSeconds: 1, everyMinutes: 0.2 })).toMatchObject({ openSeconds: 3, everyMinutes: 1 });
    expect(clampActivity({ ...on, openSeconds: 5000 }).openSeconds).toBe(600);
  });
});
