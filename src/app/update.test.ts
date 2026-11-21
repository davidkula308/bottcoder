import { describe, expect, it } from "vitest";
import { compareVersions, isSafeUpdatePath } from "./update";

describe("app updates", () => {
  it("knows 1.2.1 is newer than 1.2.0 and 1.10.0 newer than 1.9.9", () => {
    expect(compareVersions("1.2.1", "1.2.0")).toBeGreaterThan(0);
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("1.1.2", "1.2.0")).toBeLessThan(0);
  });
  it("only replaces the app's own files", () => {
    expect(isSafeUpdatePath("electron/main.cjs")).toBe(true);
    expect(isSafeUpdatePath("dist-electron/renderer/assets/index.js")).toBe(true);
    expect(isSafeUpdatePath("package.json")).toBe(true);
    expect(isSafeUpdatePath("../evil.exe")).toBe(false);
    expect(isSafeUpdatePath("C:/Windows/x.dll")).toBe(false);
    expect(isSafeUpdatePath("node_modules/x.js")).toBe(false);
  });
});
