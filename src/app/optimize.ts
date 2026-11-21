// "Optimize for this PC": picks the settings that fit the machine, so the user doesn't have to.
import type { IdeInfo } from "./bridge";
import type { Mode, ProjectType } from "./engine";
import type { LiveMode } from "./live";
import { VSCODE_FAMILY } from "./live";
import { hasModel, recommendModel, type SetupReport } from "./setup";

export interface OptimizePlan {
  model: string;
  modelSize: string;
  mode: Mode;
  projectType: ProjectType;
  languages: string[];
  autoRun: boolean;
  liveMode: LiveMode;
  followIde: string | null;
  installOllama: boolean;
  downloadModel: boolean;
  /** Plain-language list shown before applying. */
  steps: string[];
}

export function planOptimization(report: SetupReport, ides: IdeInfo[]): OptimizePlan {
  const rec = recommendModel(report.ramGB);
  const editor = ides.find((i) => VSCODE_FAMILY.includes(i.id) && i.available) ?? null;
  const python = !!report.python;
  const node = !!report.node;
  const projectType: ProjectType = python ? "python-cli" : node ? "node-cli" : "python-cli";
  const languages = [python && "python", node && "javascript"].filter(Boolean) as string[];
  const installOllama = !report.ollama.installed && !report.ollama.running;
  const downloadModel = !hasModel(report.models, rec.model);

  const steps = [
    `Use the ${rec.model} AI model (${rec.size}) — it fits ${report.ramGB} GB of memory without a graphics card.`,
    python || node
      ? `Build real ${python ? "Python" : "JavaScript"} projects and test every step.`
      : "Neither Python nor Node.js is installed, so code is written and shown without running it.",
    editor ? `Write the code inside ${editor.name}, with the bot's terminal shown there too.` : "Show the code here in NightShift (VS Code wasn't found).",
    installOllama ? "Download and install Ollama, the offline AI engine." : "Ollama is already installed.",
    downloadModel ? `Download the AI model (needs internet once).` : "The AI model is already downloaded.",
    "Until the AI is ready, keep writing practice code on screen so the bot is never idle.",
  ];

  return {
    model: rec.model,
    modelSize: rec.size,
    mode: python || node ? "project" : "random",
    projectType,
    languages: languages.length ? languages : ["python", "javascript"],
    autoRun: python || node,
    liveMode: editor ? "addon" : "off",
    followIde: editor?.id ?? null,
    installOllama,
    downloadModel,
    steps,
  };
}
