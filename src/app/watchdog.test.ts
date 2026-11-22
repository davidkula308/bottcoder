import { describe, expect, it, vi } from "vitest";
import { StallError, guardStall } from "./watchdog";

describe("AI reply watchdog", () => {
  it("gives up when the AI goes silent, so coding continues", async () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const p = guardStall(() => new Promise<string>(() => {}), { firstMs: 90_000, gapMs: 30_000, onStall });
    const check = expect(p).rejects.toBeInstanceOf(StallError);
    await vi.advanceTimersByTimeAsync(90_001);
    await check;
    expect(onStall).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("keeps waiting while chunks keep arriving", async () => {
    vi.useFakeTimers();
    const p = guardStall(async (progress) => {
      for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 20_000)); progress(); }
      return "done";
    }, { firstMs: 25_000, gapMs: 25_000 });
    await vi.advanceTimersByTimeAsync(100_001);
    await expect(p).resolves.toBe("done");
    vi.useRealTimers();
  });
});
