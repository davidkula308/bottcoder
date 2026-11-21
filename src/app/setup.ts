// Pure rules for the first-run setup helper.
import type { ProjectType, Provider } from "./engine";

export interface SetupReport {
  ollama: { installed: boolean; running: boolean; version: string | null };
  models: string[];
  python: string | null;
  node: string | null;
  git: string | null;
  winget: boolean;
  ramGB: number;
  cpu: string;
  cores: number;
}

export interface ToolInfo {
  id: "ollama" | "python" | "node" | "git";
  label: string;
  why: string;
  winget: string;
  url: string;
}

export const TOOLS: ToolInfo[] = [
  { id: "ollama", label: "Ollama", why: "Runs the AI on your PC, offline.", winget: "Ollama.Ollama", url: "https://ollama.com/download" },
  { id: "python", label: "Python", why: "Runs Python projects and their tests.", winget: "Python.Python.3.12", url: "https://www.python.org/downloads/" },
  { id: "node", label: "Node.js", why: "Runs JavaScript projects and their tests.", winget: "OpenJS.NodeJS.LTS", url: "https://nodejs.org/" },
  { id: "git", label: "Git", why: "Saves every working step so changes can be undone.", winget: "Git.Git", url: "https://git-scm.com/download/win" },
];

export function wingetCommand(tool: ToolInfo): string {
  return `winget install -e --id ${tool.winget} --accept-source-agreements --accept-package-agreements`;
}

/** Model that fits this PC's memory when there is no NVIDIA graphics card. */
export function recommendModel(ramGB: number): { model: string; size: string; why: string } {
  if (ramGB >= 24) return { model: "qwen2.5-coder:7b", size: "4.7 GB", why: "Best code quality. Slow without a graphics card." };
  if (ramGB >= 12) return { model: "qwen2.5-coder:3b", size: "1.9 GB", why: "Good balance of speed and quality for your memory." };
  return { model: "qwen2.5-coder:1.5b", size: "1.0 GB", why: "Fast and light; fits PCs with under 12 GB of memory." };
}

export function hasModel(models: string[], model: string): boolean {
  const want = model.includes(":") ? model : `${model}:latest`;
  return models.some((m) => m === model || m === want);
}

export function toolPresent(report: SetupReport, id: ToolInfo["id"]): boolean {
  if (id === "ollama") return report.ollama.installed || report.ollama.running;
  return !!report[id];
}

/** What still blocks a session. Git is recommended, not required. */
export function missingForSession(
  report: SetupReport,
  opts: { provider: Provider; model: string; mode: string; projectType: ProjectType; languages: string[] },
): string[] {
  const missing: string[] = [];
  if (opts.provider === "ollama") {
    if (!report.ollama.running) missing.push(report.ollama.installed ? "Start Ollama" : "Install Ollama");
    else if (!hasModel(report.models, opts.model)) missing.push(`Download the ${opts.model} model`);
  }
  const needsPython =
    opts.mode === "project" ? ["python-cli", "python-game", "data"].includes(opts.projectType) : opts.languages.includes("python");
  const needsNode =
    opts.mode === "project" ? ["node-cli", "web"].includes(opts.projectType) : opts.languages.some((l) => l === "javascript" || l === "typescript");
  if (needsPython && !report.python) missing.push("Install Python");
  if (needsNode && !report.node) missing.push("Install Node.js");
  return missing;
}
