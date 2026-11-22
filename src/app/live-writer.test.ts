import { describe, expect, it } from "vitest";
import { createLiveWriter } from "./live";

function fakeLive(delayMs: number) {
  const calls: string[] = [];
  const wait = () => new Promise<void>((r) => setTimeout(r, delayMs));
  return {
    calls,
    live: {
      ping: async () => "Visual Studio Code",
      begin: async (_root: string, rel: string) => { await wait(); calls.push(`begin:${rel}`); },
      append: async (t: string) => { await wait(); calls.push(`+${t}`); },
      end: async (_root: string, rel: string) => { await wait(); calls.push(`end:${rel}`); },
      term: async () => {},
    },
  };
}

describe("typing into VS Code keeps up with the chosen speed", () => {
  it("gathers characters typed while VS Code is busy instead of queueing one request per character", async () => {
    const f = fakeLive(20);
    const w = createLiveWriter(f.live);
    void w.begin("C:/p", "a.py");
    for (const ch of "print('hi')") w.append(ch);
    await w.end("C:/p", "a.py", "print('hi')");
    const appends = f.calls.filter((c) => c.startsWith("+"));
    expect(appends.join("").replace(/\+/g, "")).toBe("print('hi')");
    expect(appends.length).toBeLessThanOrEqual(2);
  });

  it("never mixes text of the next file into the previous one", async () => {
    const f = fakeLive(5);
    const w = createLiveWriter(f.live);
    void w.begin("C:/p", "a.py");
    w.append("A1");
    void w.begin("C:/p", "b.py");
    w.append("B1");
    await w.end("C:/p", "b.py", "B1");
    expect(f.calls).toEqual(["begin:a.py", "+A1", "begin:b.py", "+B1", "end:b.py"]);
  });
});
