import { describe, expect, it } from "vitest";
import { hasModel, missingForSession, recommendModel, type SetupReport } from "./setup";

const report: SetupReport = {
  ollama: { installed: true, running: true, version: "0.5" },
  models: ["qwen2.5-coder:1.5b"],
  python: "Python 3.12",
  node: null,
  git: null,
  winget: true,
  ramGB: 8,
  cpu: "x",
  cores: 4,
};

describe("model recommendation (no NVIDIA card)", () => {
  it("picks 1.5b under 12 GB, 3b from 12 GB, 7b from 24 GB", () => {
    expect(recommendModel(8).model).toBe("qwen2.5-coder:1.5b");
    expect(recommendModel(16).model).toBe("qwen2.5-coder:3b");
    expect(recommendModel(32).model).toBe("qwen2.5-coder:7b");
  });
  it("matches installed model names", () => {
    expect(hasModel(["llama3:latest"], "llama3")).toBe(true);
    expect(hasModel(["qwen2.5-coder:1.5b"], "qwen2.5-coder:3b")).toBe(false);
  });
});

describe("session readiness", () => {
  const base = { provider: "ollama" as const, model: "qwen2.5-coder:1.5b", mode: "project", languages: [] };
  it("is ready for a Python project with Ollama, the model and Python", () => {
    expect(missingForSession(report, { ...base, projectType: "python-cli" })).toEqual([]);
  });
  it("asks for Node.js for a website project", () => {
    expect(missingForSession(report, { ...base, projectType: "web" })).toEqual(["Install Node.js"]);
  });
  it("asks to download a model that is not installed", () => {
    expect(missingForSession(report, { ...base, model: "qwen2.5-coder:3b", projectType: "python-cli" })).toEqual([
      "Download the qwen2.5-coder:3b model",
    ]);
  });
});
