import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as bridges from "./bridge";
import { DEFAULT_AI, DEFAULT_SESSION } from "./engine";
import { useCodingSession } from "./use-coding-session";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("sessions with no installed AI", () => {
  it("tests AI code in scratch storage, removes it, and never writes into the selected permanent workspace", async () => {
    const original = bridges.getBridge();
    const write = vi.fn(async (root: string, file: string) => `${root}/${file}`);
    const remove = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn(async () => 0);
    const code = "FILE: sample.py\n```python\nprint(42)\n```";
    vi.spyOn(bridges, "getBridge").mockReturnValue({ ...original,
      ai: { ...original.ai, listModels: vi.fn().mockResolvedValue([DEFAULT_AI.model]), generate: vi.fn(async (_req: bridges.GenerateRequest, chunk: (text: string) => void) => { chunk(code); return code; }) },
      fs: { ...original.fs, scratchDir: vi.fn().mockResolvedValue("/scratch"), writeFile: write, remove, clearScratch: clear }, terminal: { ...original.terminal, run } });
    const hook = renderHook(() => useCodingSession({ session: { ...DEFAULT_SESSION, mode: "random", autoRun: true, pauseSeconds: 60 }, ai: DEFAULT_AI, workspace: "/permanent", followIde: null, liveMode: "off", typingCps: 30, speed: { cps: null, humanLike: false }, saveFiles: false, onTerminal: vi.fn() }));
    act(() => { void hook.result.current.start(); });
    await waitFor(() => expect(remove).toHaveBeenCalledWith("/scratch", "sample.py"));
    expect(write).toHaveBeenCalledWith("/scratch", "sample.py", "print(42)\n");
    expect(run).toHaveBeenCalledWith("python \"sample.py\"", "/scratch", DEFAULT_SESSION.runTimeoutSeconds, expect.any(Function));
    await act(async () => { await hook.result.current.stop(); });
    expect(clear).toHaveBeenCalled();
    hook.unmount();
  });

  it("writes surface code without saving or needing a scratch folder and records the stopped session", async () => {
    const original = bridges.getBridge();
    const scratch = vi.fn().mockRejectedValue(new Error("disk unavailable"));
    const write = vi.fn();
    vi.spyOn(bridges, "getBridge").mockReturnValue({ ...original, ai: { ...original.ai, listModels: vi.fn().mockRejectedValue(new Error("Ollama missing")) }, fs: { ...original.fs, scratchDir: scratch, writeFile: write } });
    const ended = vi.fn();
    const hook = renderHook(() => useCodingSession({ session: { ...DEFAULT_SESSION, pauseSeconds: 0 }, ai: DEFAULT_AI, workspace: "", followIde: null, liveMode: "off", typingCps: 30, speed: { cps: 200, humanLike: false }, saveFiles: false, onTerminal: vi.fn(), onSessionEnd: ended }));
    act(() => { void hook.result.current.start(); });
    await waitFor(() => expect(hook.result.current.surface.length).toBeGreaterThan(3));
    expect(hook.result.current.practice).toBe(true);
    expect(scratch).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("nightshift:openSession") ?? "null")).toMatchObject({ durationMinutes: DEFAULT_SESSION.durationMinutes });
    await act(async () => { await hook.result.current.stop(); });
    expect(localStorage.getItem("nightshift:openSession")).toBeNull();
    expect(ended).toHaveBeenCalledWith(expect.objectContaining({ kept: false, reason: "Stopped." }));
    hook.unmount();
  });

  it("continues elapsed coding time without counting time spent closed", async () => {
    const original = bridges.getBridge();
    vi.spyOn(bridges, "getBridge").mockReturnValue({ ...original, ai: { ...original.ai, listModels: vi.fn().mockResolvedValue([]) } });
    const hook = renderHook(() => useCodingSession({ session: { ...DEFAULT_SESSION, durationMinutes: 300 }, ai: DEFAULT_AI, workspace: "", followIde: null, liveMode: "off", typingCps: 30, speed: { cps: 200, humanLike: false }, saveFiles: false, onTerminal: vi.fn() }));
    const elapsed = 72 * 60_000;
    const previous = { id: "previous", startedAt: 0, endedAt: elapsed, mode: "random", engine: "practice" as const, files: 12, lines: 240, kept: false, reason: "App closed during coding." };
    act(() => { void hook.result.current.start(elapsed, previous); });
    await waitFor(() => expect(hook.result.current.running).toBe(true));
    expect(Date.now() - (hook.result.current.startedAt ?? Date.now())).toBeGreaterThanOrEqual(elapsed);
    expect(Date.now() - (hook.result.current.startedAt ?? 0)).toBeLessThan(elapsed + 2000);
    await waitFor(() => expect(JSON.parse(localStorage.getItem("nightshift:openSession") ?? "null")?.record.files).toBe(12));
    await act(async () => { await hook.result.current.stop(); });
    hook.unmount();
  });
});