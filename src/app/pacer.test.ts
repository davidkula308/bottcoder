import { describe, expect, it } from "vitest";
import { charDelayMs, createPacer, resolveSpeed } from "./pacer";

describe("typing speed", () => {
  it("human typing is about 40 words a minute (3.5 characters a second)", () => {
    expect(resolveSpeed({ id: "human", customCps: 0 })).toEqual({ cps: 3.5, humanLike: true });
  });
  it("fast typist is 7 characters a second and quick is 25", () => {
    expect(resolveSpeed({ id: "typist", customCps: 0 }).cps).toBe(7);
    expect(resolveSpeed({ id: "quick", customCps: 0 }).cps).toBe(25);
  });
  it("'as fast as possible' doesn't slow anything down", () => {
    expect(resolveSpeed({ id: "instant", customCps: 0 }).cps).toBeNull();
  });
  it("custom speed is kept between 1 and 200 characters a second", () => {
    expect(resolveSpeed({ id: "custom", customCps: 500 }).cps).toBe(200);
    expect(resolveSpeed({ id: "custom", customCps: 18 }).cps).toBe(18);
  });
  it("human-like typing pauses longer at the end of a line", () => {
    const mid = () => 0.5;
    expect(charDelayMs("\n", 3.5, true, mid)).toBeGreaterThan(charDelayMs("a", 3.5, true, mid) + 100);
    expect(charDelayMs("a", 10, false, mid)).toBe(100);
  });
  it("shows every character in order at the set speed", async () => {
    let shown = "";
    const p = createPacer({ cps: 2000, humanLike: false }, (c) => (shown += c), () => true);
    p.push("def main():\n");
    p.push("    return 1\n");
    await p.drain();
    expect(shown).toBe("def main():\n    return 1\n");
  });
});
