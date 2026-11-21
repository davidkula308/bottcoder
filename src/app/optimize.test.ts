import { describe, expect, it } from "vitest";
import { planOptimization } from "./optimize";
import type { SetupReport } from "./setup";

const pc: SetupReport = {
  ollama: { installed: false, running: false, version: null },
  models: [],
  python: "Python 3.13.7",
  node: "v22.19.0",
  git: "git version 2.51.0",
  winget: true,
  ramGB: 16,
  cpu: "i7-8550U",
  cores: 8,
};
const vscode = [{ id: "vscode", name: "VS Code", available: true }];

describe("optimize for this PC", () => {
  it("16 GB, Python, VS Code, no Ollama: 3b model, Python project in VS Code, installs Ollama + model", () => {
    const p = planOptimization(pc, vscode);
    expect(p).toMatchObject({ model: "qwen2.5-coder:3b", mode: "project", projectType: "python-cli", liveMode: "addon", followIde: "vscode", installOllama: true, downloadModel: true, autoRun: true });
  });
  it("without VS Code the code is shown in NightShift", () => {
    expect(planOptimization(pc, []).liveMode).toBe("off");
  });
  it("without Python or Node it writes code without running it", () => {
    const p = planOptimization({ ...pc, python: null, node: null }, vscode);
    expect(p.autoRun).toBe(false);
    expect(p.mode).toBe("random");
  });
  it("skips downloads that are already done", () => {
    const p = planOptimization({ ...pc, ollama: { installed: true, running: true, version: "1" }, models: ["qwen2.5-coder:3b"] }, vscode);
    expect(p.installOllama).toBe(false);
    expect(p.downloadModel).toBe(false);
  });
});
