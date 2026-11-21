// Pure rules for "Real project" mode: plan, tasks, prompts, parsing multi-file replies, edits.
import { sanitizeFilename, type ProjectType } from "./engine";

export interface ProjectTypeInfo {
  id: ProjectType;
  label: string;
  description: string;
  runtime: "python" | "node";
  entry: string | null;
  testCommand: string;
  guide: string;
}

export const PROJECT_TYPES: ProjectTypeInfo[] = [
  {
    id: "python-cli",
    label: "Command-line tool",
    description: "A Python tool you run in the terminal.",
    runtime: "python",
    entry: "main.py",
    testCommand: "python -m unittest discover -s tests -t . -v",
    guide:
      "Python 3 standard library only. Put the code in the app/ package (with app/__init__.py), the entry point in main.py using argparse, and unittest tests in tests/test_*.py (with tests/__init__.py). Running main.py with no arguments must print a short demo and exit.",
  },
  {
    id: "python-game",
    label: "Terminal game",
    description: "A Python game played in the terminal.",
    runtime: "python",
    entry: "main.py",
    testCommand: "python -m unittest discover -s tests -t . -v",
    guide:
      "Python 3 standard library only. Keep game rules as pure, testable functions in the game/ package (with game/__init__.py). main.py plays a short automatic demo round with no keyboard input and exits; add a --play flag for interactive play. unittest tests in tests/test_*.py (with tests/__init__.py).",
  },
  {
    id: "data",
    label: "Data tool",
    description: "Reads files, crunches numbers, writes reports.",
    runtime: "python",
    entry: "main.py",
    testCommand: "python -m unittest discover -s tests -t . -v",
    guide:
      "Python 3 standard library only (csv, json, statistics, pathlib). Ship small sample input files in data/. Code in the app/ package (with app/__init__.py), main.py processes the sample data and prints a report. unittest tests in tests/test_*.py (with tests/__init__.py).",
  },
  {
    id: "node-cli",
    label: "Node.js tool",
    description: "A JavaScript tool run with Node.js.",
    runtime: "node",
    entry: "index.js",
    testCommand: "node --test",
    guide:
      "Node.js 18+ built-in modules only, CommonJS (require/module.exports). Code in lib/, entry point index.js which prints a short demo and exits, tests in tests/*.test.js using node:test and node:assert.",
  },
  {
    id: "web",
    label: "Website / web app",
    description: "HTML, CSS and JavaScript you open in a browser.",
    runtime: "node",
    entry: null,
    testCommand: "node --test",
    guide:
      "Static site with no build tools and no CDNs: index.html, styles.css and ES modules in js/ (*.mjs). Keep logic in pure js/*.mjs modules that also run in Node, and test them in tests/*.test.mjs using node:test and node:assert.",
  },
];

export function projectType(id: ProjectType): ProjectTypeInfo {
  return PROJECT_TYPES.find((t) => t.id === id) ?? (PROJECT_TYPES[0] as ProjectTypeInfo);
}

/* ---------------- State ---------------- */

export type TaskStatus = "todo" | "done" | "skipped";
export interface Task {
  id: number;
  title: string;
  status: TaskStatus;
  attempts: number;
}
export interface LogEntry {
  at: number;
  taskId: number;
  result: "pass" | "fail" | "skipped" | "planned";
  note: string;
}
export interface ProjectState {
  version: 1;
  goal: string;
  type: ProjectType;
  tasks: Task[];
  rounds: number;
  lastFailure?: string | undefined;
  log: LogEntry[];
  createdAt: number;
  updatedAt: number;
}

export const STATE_DIR = ".nightshift";
export const STATE_FILE = ".nightshift/state.json";
export const PLAN_FILE = "PLAN.md";
/** Failed attempts on one task before it is rolled back and skipped. */
export const MAX_ATTEMPTS = 3;

export function newProject(goal: string, type: ProjectType, now: number): ProjectState {
  return { version: 1, goal, type, tasks: [], rounds: 0, log: [], createdAt: now, updatedAt: now };
}

export function parseChecklist(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX~]?\]\s*)?(.+)$/.exec(raw);
    if (!m?.[1]) continue;
    const title = m[1].replace(/\*\*|__|`/g, "").trim();
    if (title.length < 4 || out.includes(title)) continue;
    out.push(title);
    if (out.length >= 12) break;
  }
  return out;
}

export function addTasks(state: ProjectState, titles: string[], now: number): ProjectState {
  let id = state.tasks.reduce((m, t) => Math.max(m, t.id), 0);
  const tasks = [...state.tasks, ...titles.map((title) => ({ id: ++id, title, status: "todo" as const, attempts: 0 }))];
  return {
    ...state,
    tasks,
    updatedAt: now,
    log: [...state.log, { at: now, taskId: 0, result: "planned" as const, note: `${titles.length} tasks added` }].slice(-80),
  };
}

export function nextTask(state: ProjectState): Task | undefined {
  return state.tasks.find((t) => t.status === "todo");
}

export type RoundAction = "commit" | "retry" | "skip";

export function recordResult(
  state: ProjectState,
  taskId: number,
  passed: boolean,
  note: string,
  now: number,
): { state: ProjectState; action: RoundAction } {
  let action = "retry" as RoundAction;
  const tasks = state.tasks.map((t) => {
    if (t.id !== taskId) return t;
    const attempts = t.attempts + 1;
    if (passed) {
      action = "commit";
      return { ...t, attempts, status: "done" as const };
    }
    if (attempts >= MAX_ATTEMPTS) {
      action = "skip";
      return { ...t, attempts, status: "skipped" as const };
    }
    return { ...t, attempts };
  });
  const result = action === "commit" ? "pass" : action === "skip" ? "skipped" : "fail";
  return {
    action,
    state: {
      ...state,
      tasks,
      rounds: state.rounds + 1,
      lastFailure: action === "retry" ? note : undefined,
      updatedAt: now,
      log: [...state.log, { at: now, taskId, result, note: note.slice(-300) } as LogEntry].slice(-80),
    },
  };
}

export function progress(state: ProjectState) {
  const done = state.tasks.filter((t) => t.status === "done").length;
  const skipped = state.tasks.filter((t) => t.status === "skipped").length;
  return { done, skipped, total: state.tasks.length };
}

export function renderPlan(state: ProjectState): string {
  const { done, total } = progress(state);
  const lines = state.tasks.map((t) =>
    t.status === "done" ? `- [x] ${t.title}` : t.status === "skipped" ? `- [~] ${t.title} _(skipped after ${t.attempts} tries)_` : `- [ ] ${t.title}`,
  );
  return `# Project plan\n\n**Goal:** ${state.goal}\n\n**Type:** ${projectType(state.type).label} · ${done}/${total} done\n\n${lines.join("\n")}\n\n_Maintained automatically by NightShift Coder._\n`;
}

/* ---------------- Prompts ---------------- */

const FENCE = "```";

export const PROJECT_SYSTEM = `You are NightShift, an autonomous software engineer working inside a real project folder on the user's PC.
You complete one task at a time and your changes are tested automatically.

Reply using one or more of these blocks.

To create a new file or replace a whole file:
FILE: path/to/file.ext
${FENCE}lang
complete file content
${FENCE}

To change part of an existing file:
EDIT: path/to/file.ext
${FENCE}
<<<<<<< SEARCH
exact lines currently in the file
=======
replacement lines
>>>>>>> REPLACE
${FENCE}

Finish with one line:
SUMMARY: what you did, in one sentence

Rules:
- Write complete, working code. No placeholders, no TODOs, no "...".
- Add or update automated tests for every behaviour you add.
- Programs never wait for keyboard input and must finish on their own.
- Use only built-in standard library modules. No package installs, no network access.
- Paths are relative to the project root. Never touch .git or .nightshift.`;

export function planPrompt(goal: string, type: ProjectType): string {
  const t = projectType(type);
  return `Project goal: ${goal}
Project type: ${t.label}. ${t.guide}

Break this project into 6 to 10 small, concrete tasks in build order.
The first task creates the folder structure, the entry point and one passing test.
Each task must be doable in a single reply.
Reply ONLY with a markdown checklist, one "- [ ] task" per line.`;
}

export function extendPrompt(state: ProjectState, files: string[]): string {
  const done = state.tasks.filter((t) => t.status === "done").map((t) => t.title);
  return `Project goal: ${state.goal}
Every planned task is finished. Completed: ${done.slice(-15).join("; ") || "none"}.
Files: ${files.slice(0, 80).join(", ")}.
Suggest 3 to 5 next improvements (new features, edge cases, error handling, documentation).
Reply ONLY with a markdown checklist, one "- [ ] task" per line.`;
}

export function taskPrompt(args: {
  state: ProjectState;
  task: Task;
  files: string[];
  contents: { path: string; content: string }[];
}): string {
  const { state, task, files, contents } = args;
  const t = projectType(state.type);
  const { done, total } = progress(state);
  const finished = state.tasks.filter((x) => x.status === "done").map((x) => x.title).slice(-8);
  const retry =
    task.attempts > 0 && state.lastFailure
      ? `\nThis is attempt ${task.attempts + 1} of ${MAX_ATTEMPTS}. The previous attempt failed:\n${state.lastFailure.slice(-2000)}\nFix the cause.\n`
      : "";
  const body = contents.map((c) => `--- ${c.path} ---\n${c.content}`).join("\n\n");
  return `Project goal: ${state.goal}
Project type: ${t.label}. ${t.guide}
Progress: ${done}/${total} tasks done. Recently finished: ${finished.join("; ") || "none"}.

CURRENT TASK #${task.id}: ${task.title}
${retry}
Project files: ${files.slice(0, 150).join(", ") || "(empty folder)"}

Relevant file contents:
${body || "(none yet)"}

Do the current task now.`;
}

/* ---------------- Parsing replies ---------------- */

export interface SearchReplace {
  search: string;
  replace: string;
}
export type FileOp =
  | { kind: "write"; path: string; content: string }
  | { kind: "edit"; path: string; edits: SearchReplace[] };

function isProtected(path: string): boolean {
  return /^(\.git|\.nightshift)(\/|$)/i.test(path);
}

export function parseProjectResponse(text: string): { ops: FileOp[]; summary: string } {
  const ops: FileOp[] = [];
  const header = /^[ \t>*#]*(FILE|EDIT):\s*`?([^\s`*]+)`?[^\n]*$/gim;
  const marks: { kind: string; path: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = header.exec(text))) {
    marks.push({ kind: (m[1] ?? "").toUpperCase(), path: m[2] ?? "", start: m.index, end: header.lastIndex });
  }
  marks.forEach((mk, i) => {
    const chunk = text.slice(mk.end, marks[i + 1]?.start ?? text.length);
    const fence = /```[^\n]*\n([\s\S]*?)(?:\n```|$)/.exec(chunk);
    if (!fence) return;
    const path = sanitizeFilename(mk.path);
    if (isProtected(path)) return;
    const body = fence[1] ?? "";
    if (mk.kind === "FILE") {
      if (body.trim()) ops.push({ kind: "write", path, content: body.replace(/\s+$/, "") + "\n" });
      return;
    }
    const edits: SearchReplace[] = [];
    const pair = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n?=======\r?\n([\s\S]*?)\r?\n?>>>>>>> REPLACE/g;
    let p: RegExpExecArray | null;
    while ((p = pair.exec(body))) edits.push({ search: p[1] ?? "", replace: p[2] ?? "" });
    if (edits.length) ops.push({ kind: "edit", path, edits });
  });
  const summary = /^SUMMARY:\s*(.+)$/im.exec(text)?.[1]?.trim() ?? "";
  return { ops, summary };
}

/** Apply SEARCH/REPLACE edits. Exact match first, then a match that ignores trailing spaces and indentation drift. */
export function applyEdits(
  content: string,
  edits: SearchReplace[],
): { ok: true; content: string } | { ok: false; failed: string } {
  let out = content.replace(/\r\n/g, "\n");
  for (const e of edits) {
    const search = e.search.replace(/\r\n/g, "\n");
    if (!search.trim()) {
      out = out.replace(/\n?$/, "\n") + e.replace + "\n";
      continue;
    }
    const idx = out.indexOf(search);
    if (idx !== -1) {
      out = out.slice(0, idx) + e.replace + out.slice(idx + search.length);
      continue;
    }
    const lines = out.split("\n");
    const want = search.split("\n").map((l) => l.trim());
    let found = -1;
    for (let i = 0; i + want.length <= lines.length && found === -1; i++) {
      if (want.every((w, j) => (lines[i + j] ?? "").trim() === w)) found = i;
    }
    if (found === -1) return { ok: false, failed: search.split("\n")[0] ?? "" };
    lines.splice(found, want.length, ...e.replace.split("\n"));
    out = lines.join("\n");
  }
  return { ok: true, content: out };
}

/** The FILE block currently being streamed, for live typing. */
export function currentStreamingBlock(text: string): { path: string; code: string } | null {
  const header = /^[ \t>*#]*(FILE|EDIT):\s*`?([^\s`*]+)`?[^\n]*$/gim;
  let last: { kind: string; path: string; end: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = header.exec(text))) last = { kind: (m[1] ?? "").toUpperCase(), path: m[2] ?? "", end: header.lastIndex };
  if (!last || last.kind !== "FILE") return null;
  const rest = text.slice(last.end);
  const open = /```[^\n]*\n/.exec(rest);
  if (!open) return null;
  let code = rest.slice(open.index + open[0].length);
  const close = code.indexOf("\n```");
  if (close !== -1) code = code.slice(0, close + 1);
  else code = code.replace(/\n?`{1,3}$/, ""); // hold back a fence that is still arriving
  const path = sanitizeFilename(last.path);
  if (isProtected(path)) return null;
  return { path, code };
}

/* ---------------- Verification & context ---------------- */

export interface FileEntry {
  path: string;
  size: number;
  mtime: number;
}

export function isTestFile(path: string): boolean {
  return /(^|\/)tests?\//.test(path) || /\.test\.[cm]?js$/.test(path) || /(^|\/)test_[^/]*\.py$/.test(path);
}

export function verifyCommand(type: ProjectType, files: string[]): string | null {
  const t = projectType(type);
  const hasTests = files.some((f) => isTestFile(f) && /\.(py|[cm]?js)$/.test(f));
  const runEntry = t.entry && files.includes(t.entry) ? `${t.runtime} ${t.entry}` : null;
  if (hasTests && runEntry) return `${t.testCommand} && ${runEntry}`;
  if (hasTests) return t.testCommand;
  return runEntry;
}

const TEXT_EXT = /\.(py|js|mjs|cjs|ts|json|md|txt|html|css|csv|toml|ini|cfg|yml|yaml)$/i;

export function pickContextFiles(files: FileEntry[], hints: string, budgetChars: number): string[] {
  const hint = hints.toLowerCase();
  const recency = [...files].sort((a, b) => b.mtime - a.mtime).map((f) => f.path);
  const scored = files
    .filter((f) => TEXT_EXT.test(f.path) && f.path !== PLAN_FILE && f.size <= budgetChars)
    .map((f) => {
      const base = f.path.split("/").pop()?.toLowerCase() ?? "";
      let score = 0;
      if (hint.includes(f.path.toLowerCase()) || (base.length > 3 && hint.includes(base))) score += 100;
      if (/^(main\.py|index\.js|index\.html)$/.test(f.path)) score += 20;
      if (isTestFile(f.path)) score += 5;
      score += Math.max(0, 15 - recency.indexOf(f.path));
      return { f, score };
    })
    .sort((a, b) => b.score - a.score);
  const out: string[] = [];
  let used = 0;
  for (const { f } of scored) {
    if (used + f.size > budgetChars) continue;
    out.push(f.path);
    used += f.size;
  }
  return out;
}

export function safeCommitMessage(msg: string): string {
  return msg.replace(/["`$\\%!^&|<>\r\n]/g, "").slice(0, 70);
}
