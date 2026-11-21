import { describe, expect, it } from "vitest";
import { writePractice } from "./practice";

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe("practice code (no AI needed)", () => {
  it("avoids the programs from a previous session after its signature history is reloaded", () => {
    const used = new Set<string>();
    const codes = new Set<string>();
    const random = seeded(21);
    for (let i = 0; i < 100; i++) {
      const s = writePractice(random, used);
      used.add(s.signature);
      codes.add(s.code);
    }
    const reopened = new Set(JSON.parse(JSON.stringify([...used])) as string[]);
    const replay = seeded(21);
    for (let i = 0; i < 100; i++) {
      const s = writePractice(replay, reopened);
      expect(codes.has(s.code)).toBe(false);
      expect(reopened.has(s.signature)).toBe(false);
      reopened.add(s.signature);
    }
  });
  it("writes 300 programs in a row without repeating one", () => {
    const used = new Set<string>();
    const codes = new Set<string>();
    const rand = seeded(7);
    for (let i = 0; i < 300; i++) {
      const s = writePractice(rand, used);
      expect(used.has(s.signature)).toBe(false);
      used.add(s.signature);
      codes.add(s.code);
    }
    expect(codes.size).toBe(300);
  });
  it("uses at least 5 different languages", () => {
    const used = new Set<string>();
    const langs = new Set<string>();
    const rand = seeded(3);
    for (let i = 0; i < 60; i++) {
      const s = writePractice(rand, used);
      used.add(s.signature);
      langs.add(s.language);
    }
    expect(langs.size).toBeGreaterThanOrEqual(5);
  });
  it("every program has real code and a file name", () => {
    const used = new Set<string>();
    const rand = seeded(11);
    for (let i = 0; i < 100; i++) {
      const s = writePractice(rand, used);
      used.add(s.signature);
      expect(s.code.split("\n").length).toBeGreaterThanOrEqual(8);
      expect(s.code.replace(/\| undefined/g, "")).not.toMatch(/\bundefined\b|\{SEEDS\}|\{K\}|\bNaN\b/);
      expect(s.filename).toMatch(/^[\w-]+\.(py|ts|js|go|rs|java)$/);
    }
  });
});
