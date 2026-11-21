// Pure, platform-free logic for the coding bot. Shared by the web preview and the desktop app.

export type Mode = "random" | "strategic";
export type Provider = "ollama" | "nim";

export interface SessionConfig {
  /** null = unlimited */
  durationMinutes: number | null;
  mode: Mode;
  goal: string;
  languages: string[];
  autoRun: boolean;
  pauseSeconds: number;
  runTimeoutSeconds: number;
}

export interface AiConfig {
  provider: Provider;
  model: string;
  ollamaUrl: string;
  nimKey: string;
}

export const DEFAULT_SESSION: SessionConfig = {
  durationMinutes: 300,
  mode: "strategic",
  goal: "Build a small command-line toolkit of useful utilities, one feature at a time.",
  languages: ["python", "javascript"],
  autoRun: true,
  pauseSeconds: 5,
  runTimeoutSeconds: 60,
};

export const DEFAULT_AI: AiConfig = {
  provider: "ollama",
  model: "qwen2.5-coder:1.5b",
  ollamaUrl: "http://127.0.0.1:11434",
  nimKey: "",
};

export const LANGUAGES = [
  { id: "python", label: "Python", ext: "py" },
  { id: "javascript", label: "JavaScript", ext: "js" },
  { id: "typescript", label: "TypeScript", ext: "ts" },
  { id: "powershell", label: "PowerShell", ext: "ps1" },
  { id: "go", label: "Go", ext: "go" },
  { id: "html", label: "HTML/CSS", ext: "html" },
] as const;

/* ---------------- Session timing ---------------- */

export function remainingMs(
  startMs: number,
  durationMinutes: number | null,
  nowMs: number,
): number | null {
  if (durationMinutes === null) return null;
  return Math.max(0, startMs + durationMinutes * 60_000 - nowMs);
}

export function isSessionOver(
  startMs: number,
  durationMinutes: number | null,
  nowMs: number,
): boolean {
  const left = remainingMs(startMs, durationMinutes, nowMs);
  return left !== null && left <= 0;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/* ---------------- Prompting ---------------- */

const RANDOM_IDEAS = [
  "a text-based adventure mini game",
  "a CSV statistics summarizer",
  "a password strength checker",
  "a markdown to HTML converter",
  "a tiny key-value store with persistence to a JSON file",
  "a prime number sieve benchmark",
  "a todo list manager that saves to a file",
  "a unit converter (length, weight, temperature)",
  "a maze generator that prints ASCII art",
  "a simple tokenizer and calculator for math expressions",
  "a folder size analyzer",
  "a Conway's Game of Life simulation printed in the terminal",
  "a random quote generator with categories",
  "a binary search tree with insert, delete and traversal",
  "a log file analyzer that counts errors by type",
];

export const SYSTEM_PROMPT = `You are NightShift, an autonomous coding bot running on the user's PC.
Every reply must contain exactly one complete, runnable source file.
Format strictly:
FILE: relative/path/name.ext
\`\`\`language
...full code...
\`\`\`
Rules: no external packages unless they are in the standard library, the program must finish on its own within a few seconds (no servers, no waiting for input), print visible output that shows it works, keep it under 150 lines.`;

export interface PromptContext {
  iteration: number;
  files: string[];
  lastOutput?: string | undefined;
  lastExitCode?: number | null | undefined;
  rand: () => number;
}

function pick<T>(items: readonly T[], rand: () => number): T {
  const i = Math.min(items.length - 1, Math.floor(rand() * items.length));
  return items[i] as T;
}

export function buildPrompt(cfg: SessionConfig, ctx: PromptContext): { system: string; prompt: string } {
  const langs = cfg.languages.length ? cfg.languages : ["python"];
  if (cfg.mode === "random") {
    const lang = pick(langs, ctx.rand);
    const idea = pick(RANDOM_IDEAS, ctx.rand);
    return {
      system: SYSTEM_PROMPT,
      prompt: `Iteration ${ctx.iteration}. Write ${idea} in ${lang}. Pick a fresh, descriptive filename.`,
    };
  }
  const recent = ctx.files.slice(-12).join(", ") || "none yet";
  const feedback =
    ctx.lastOutput !== undefined
      ? `\nLast run exited with code ${ctx.lastExitCode ?? "unknown"}. Output (tail):\n${ctx.lastOutput.slice(-1500)}\nIf it failed, fix that file first (reuse its filename).`
      : "";
  return {
    system: SYSTEM_PROMPT,
    prompt: `Project goal: ${cfg.goal}
Allowed languages: ${langs.join(", ")}.
Iteration ${ctx.iteration}. Files written so far: ${recent}.${feedback}
Write the next most useful file that moves the project toward the goal.`,
  };
}

/* ---------------- Parsing model output ---------------- */

export interface ParsedCode {
  filename: string;
  language: string;
  code: string;
}

const EXT_BY_LANG: Record<string, string> = {
  python: "py", py: "py", javascript: "js", js: "js", typescript: "ts", ts: "ts",
  powershell: "ps1", ps1: "ps1", go: "go", html: "html", css: "css", bash: "sh", sh: "sh",
  rust: "rs", c: "c", cpp: "cpp", java: "java", json: "json",
};

export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .map((p) => p.replace(/[^\w.-]/g, "_"))
    .join("/");
  return cleaned || "snippet.txt";
}

export function parseCodeResponse(text: string, iteration: number): ParsedCode | null {
  const fence = /```([\w+#-]*)[^\n]*\n([\s\S]*?)(```|$)/.exec(text);
  if (!fence) return null;
  const language = (fence[1] || "text").toLowerCase();
  const code = (fence[2] ?? "").replace(/\s+$/, "") + "\n";
  if (!code.trim()) return null;
  const fileMatch = /FILE:\s*`?([^\s`]+)`?/i.exec(text);
  const ext = EXT_BY_LANG[language] ?? "txt";
  const filename = sanitizeFilename(fileMatch?.[1] ?? `snippet_${iteration}.${ext}`);
  return { filename, language, code };
}

/** Code visible so far while the model is still streaming. */
export function streamingCode(text: string): string {
  const start = text.indexOf("```");
  if (start === -1) return "";
  const lineEnd = text.indexOf("\n", start);
  if (lineEnd === -1) return "";
  const body = text.slice(lineEnd + 1);
  const end = body.indexOf("```");
  return end === -1 ? body : body.slice(0, end);
}

export function runCommandFor(filename: string): string | null {
  const q = `"${filename}"`;
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "py": return `python ${q}`;
    case "js": case "mjs": case "cjs": return `node ${q}`;
    case "ts": return `npx --yes tsx ${q}`;
    case "ps1": return `powershell -ExecutionPolicy Bypass -File ${q}`;
    case "go": return `go run ${q}`;
    case "sh": return `bash ${q}`;
    default: return null;
  }
}

/* ---------------- Schedules ---------------- */

export interface Schedule {
  id: string;
  name: string;
  kind: "app" | "command" | "session";
  target: string;
  /** "HH:MM" 24h */
  time: string;
  /** 0 = Sunday ... 6 = Saturday. Empty = every day. */
  days: number[];
  enabled: boolean;
  lastRunKey?: string;
}

export function dayKey(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function isScheduleDue(s: Schedule, now: Date): boolean {
  if (!s.enabled) return false;
  if (s.days.length && !s.days.includes(now.getDay())) return false;
  const [h, m] = s.time.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return false;
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const target = h * 60 + m;
  // Fire within a 2-minute window so a sleeping timer tick doesn't miss it.
  if (minutesNow < target || minutesNow > target + 1) return false;
  return s.lastRunKey !== dayKey(now);
}
