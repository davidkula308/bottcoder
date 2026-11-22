import { describe, expect, it } from "vitest";
import { parentFolder, sessionFolderName } from "./live";

describe("VS Code session project name", () => {
  it("uses the name the user typed, without unsafe characters", () => {
    expect(sessionFolderName("My bot: test/1?")).toBe("My bot test 1");
  });
  it("falls back to a dated session name when empty", () => {
    expect(sessionFolderName("  ", new Date(2026, 10, 22, 9, 5))).toBe("Session 2026-11-22 0905");
  });
  it("finds the project folder from a Windows file path", () => {
    expect(parentFolder("C:\\Users\\me\\NightShift\\Sessions\\Demo\\README.md")).toBe("C:\\Users\\me\\NightShift\\Sessions\\Demo");
  });
});
