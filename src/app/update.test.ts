import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { compareVersions, isSafeUpdatePath, fetchAndInstallUpdate, UPDATE_FEED_URL } from "./update";

describe("app updates", () => {
  it("fetches from the published bottcoder update link", () => {
    expect(UPDATE_FEED_URL).toBe("https://bottcoder.lovable.app/updates");
  });
  it("Fetch updates checks and installs the available files without an installer", async () => {
    const check = vi.fn(async () => ({ current: "1.3.0", latest: "1.3.1", available: true, notes: "" }));
    const apply = vi.fn(async () => true);
    const result = await fetchAndInstallUpdate({ check, apply, isRunning: () => false, onInfo: vi.fn(), onStatus: vi.fn() });
    expect(result).toBe("installed");
    expect(check).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
  });
  it("waits until the current coding session stops before installing", async () => {
    const apply = vi.fn(async () => true);
    const result = await fetchAndInstallUpdate({ check: async () => ({ current: "1.3.0", latest: "1.3.1", available: true, notes: "" }), apply, isRunning: () => true, onInfo: vi.fn(), onStatus: vi.fn() });
    expect(result).toBe("queued");
    expect(apply).not.toHaveBeenCalled();
  });
  it("does not install if the published feed cannot be reached", async () => {
    const apply = vi.fn(async () => true);
    const result = await fetchAndInstallUpdate({ check: async () => { throw new Error("offline"); }, apply, isRunning: () => false, onInfo: vi.fn(), onStatus: vi.fn() });
    expect(result).toBe("error");
    expect(apply).not.toHaveBeenCalled();
  });
  it("does not reinstall the current version", async () => {
    const apply = vi.fn(async () => true);
    const result = await fetchAndInstallUpdate({ check: async () => ({ current: "1.3.1", latest: "1.3.1", available: false, notes: "" }), apply, isRunning: () => false, onInfo: vi.fn(), onStatus: vi.fn() });
    expect(result).toBe("current");
    expect(apply).not.toHaveBeenCalled();
  });
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
