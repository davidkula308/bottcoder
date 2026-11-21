// One round of "Real project" mode: plan → pick task → read code → ask AI → apply → test → commit/rollback.
import type { DesktopBridge } from "./bridge";
import type { AiConfig, SessionConfig } from "./engine";
import type { LiveSink } from "./live";
import {
  PLAN_FILE,
  PROJECT_SYSTEM,
  STATE_DIR,
  STATE_FILE,
  addTasks,
  applyEdits,
  currentStreamingBlock,
  extendPrompt,
  newProject,
  nextTask,
  parseChecklist,
  parseProjectResponse,
  pickContextFiles,
  planPrompt,
  recordResult,
  renderPlan,
  safeCommitMessage,
  taskPrompt,
  verifyCommand,
  type ProjectState,
} from "./project";
import type { BotStatus } from "./use-coding-session";

export interface RoundUi {
  status(s: BotStatus): void;
  message(m: string): void;
  surface(code: string): void;
  file(f: { name: string; language: string } | null): void;
  terminal(t: string): void;
  fileWritten(f: { filename: string; path: string; language: string; exitCode: number | null | undefined }): void;
  plan(state: ProjectState): void;
}

export interface RoundDeps {
  bridge: DesktopBridge;
  root: string;
  session: SessionConfig;
  ai: AiConfig;
  alive: () => boolean;
  ui: RoundUi;
  sink: LiveSink | null;
  followIde: string | null;
  git: { ok: boolean };
}

const GITIGNORE = ".nightshift/\n__pycache__/\n*.pyc\nnode_modules/\n.vscode/\n";
const CONTEXT_BUDGET = 12_000;

export async function loadProject(bridge: DesktopBridge, root: string): Promise<ProjectState | null> {
  if (!root) return null;
  const raw = await bridge.fs.read(root, STATE_FILE).catch(() => null);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as ProjectState;
    return s.version === 1 ? s : null;
  } catch {
    return null;
  }
}

export async function archiveProject(bridge: DesktopBridge, root: string): Promise<void> {
  const raw = await bridge.fs.read(root, STATE_FILE).catch(() => null);
  if (raw) await bridge.fs.writeFile(root, `${STATE_DIR}/archive/state-${Date.now()}.json`, raw);
  await bridge.fs.remove(root, STATE_FILE).catch(() => {});
}

async function save(d: RoundDeps, state: ProjectState) {
  await d.bridge.fs.writeFile(d.root, STATE_FILE, JSON.stringify(state, null, 2));
  await d.bridge.fs.writeFile(d.root, PLAN_FILE, renderPlan(state));
  d.ui.plan(state);
}

async function sh(d: RoundDeps, cmd: string, timeoutSec = 60, echo = true): Promise<{ code: number | null; out: string }> {
  if (echo) d.ui.terminal(`\n$ ${cmd}\n`);
  let out = "";
  const code = await d.bridge.terminal.run(cmd, d.root, timeoutSec, (t) => {
    out += t;
    d.ui.terminal(t);
  });
  if (echo) d.ui.terminal(`[exit ${code ?? "timeout"}]\n`);
  return { code, out };
}

const GIT_ID = `-c user.name="NightShift Coder" -c user.email=bot@nightshift.local`;

async function commit(d: RoundDeps, msg: string) {
  if (!d.git.ok) return;
  await sh(d, `git add -A && git ${GIT_ID} commit -q -m "${safeCommitMessage(msg)}"`);
}

async function ask(d: RoundDeps, prompt: string, showCode: boolean): Promise<string | null> {
  let text = "";
  try {
    text = await d.bridge.ai.generate(
      { provider: d.ai.provider, model: d.ai.model, system: PROJECT_SYSTEM, prompt, ollamaUrl: d.ai.ollamaUrl, nimKey: d.ai.nimKey },
      (chunk) => {
        if (!d.alive()) return;
        text += chunk;
        if (!showCode) {
          d.ui.surface(text);
          return;
        }
        d.sink?.onText(text);
        const b = currentStreamingBlock(text);
        if (b) {
          d.ui.status("writing");
          d.ui.file({ name: b.path, language: b.path.split(".").pop() ?? "text" });
          d.ui.surface(b.code);
        }
      },
    );
  } catch (e) {
    if (!d.alive()) return null;
    d.ui.status("error");
    d.ui.message(`AI engine not reachable: ${(e as Error).message}. Retrying shortly…`);
    return null;
  }
  return text;
}

async function initProject(d: RoundDeps): Promise<ProjectState | null> {
  d.ui.status("thinking");
  d.ui.message("Setting up a new project and writing the plan…");
  d.ui.file({ name: PLAN_FILE, language: "markdown" });
  d.ui.surface("");
  if (d.git.ok && !(await d.bridge.fs.exists(d.root, ".git"))) await sh(d, "git init -q");
  const existingIgnore = await d.bridge.fs.read(d.root, ".gitignore");
  if (!existingIgnore?.includes(".nightshift")) {
    await d.bridge.fs.writeFile(d.root, ".gitignore", (existingIgnore ?? "") + GITIGNORE);
  }
  const reply = await ask(d, planPrompt(d.session.goal, d.session.projectType), false);
  if (reply === null || !d.alive()) return null;
  const titles = parseChecklist(reply);
  if (!titles.length) {
    d.ui.message("The AI didn't return a usable plan — trying again.");
    return null;
  }
  const state = addTasks(newProject(d.session.goal, d.session.projectType, Date.now()), titles, Date.now());
  await save(d, state);
  d.ui.surface(renderPlan(state));
  await commit(d, "Plan project");
  return state;
}

/** Returns false when the round could not reach the AI (caller waits before retrying). */
export async function runProjectRound(d: RoundDeps): Promise<boolean> {
  let state = await loadProject(d.bridge, d.root);
  if (!state) {
    state = await initProject(d);
    return state !== null;
  }
  d.ui.plan(state);

  let task = nextTask(state);
  if (!task) {
    d.ui.status("thinking");
    d.ui.message("Plan finished — choosing the next improvements…");
    const files = (await d.bridge.fs.list(d.root)).map((f) => f.path);
    const reply = await ask(d, extendPrompt(state, files), false);
    if (reply === null || !d.alive()) return reply !== null;
    const titles = parseChecklist(reply);
    if (!titles.length) return true;
    state = addTasks(state, titles, Date.now());
    await save(d, state);
    await commit(d, "Extend plan");
    task = nextTask(state);
    if (!task) return true;
  }

  // Read the project
  d.ui.status("thinking");
  d.ui.message(`Task #${task.id}: ${task.title}${task.attempts ? ` (try ${task.attempts + 1})` : ""}`);
  d.ui.surface("");
  d.ui.file(null);
  const tree = await d.bridge.fs.list(d.root);
  const picked = pickContextFiles(tree, `${task.title}\n${state.lastFailure ?? ""}`, CONTEXT_BUDGET);
  const contents: { path: string; content: string }[] = [];
  for (const p of picked) {
    const c = await d.bridge.fs.read(d.root, p);
    if (c !== null) contents.push({ path: p, content: c });
  }

  const reply = await ask(d, taskPrompt({ state, task, files: tree.map((f) => f.path), contents }), true);
  if (reply === null) return false;
  if (!d.alive()) return true;

  // Apply changes
  const { ops, summary } = parseProjectResponse(reply);
  const problems: string[] = [];
  for (const op of ops) {
    if (!d.alive()) return true;
    let content: string | null = null;
    if (op.kind === "write") content = op.content;
    else {
      const current = await d.bridge.fs.read(d.root, op.path);
      if (current === null) {
        problems.push(`EDIT failed: ${op.path} does not exist. Use FILE to create it.`);
        continue;
      }
      const r = applyEdits(current, op.edits);
      if (!r.ok) {
        problems.push(`EDIT failed in ${op.path}: could not find "${r.failed}". Use FILE to rewrite the whole file.`);
        continue;
      }
      content = r.content;
    }
    if (op.kind === "write") await d.sink?.finish(op.path, content);
    const abs = await d.bridge.fs.writeFile(d.root, op.path, content);
    if (d.followIde && !d.sink?.opensEditor) d.bridge.ide.open(d.followIde, d.root, abs).catch(() => {});
    d.ui.fileWritten({ filename: op.path, path: abs, language: op.path.split(".").pop() ?? "", exitCode: undefined });
  }
  if (!ops.length) problems.push("The reply contained no FILE or EDIT blocks. Reply using the required format.");

  // Verify
  let passed = problems.length === 0;
  let note = problems.join("\n") || summary || "done";
  if (passed) {
    const files = (await d.bridge.fs.list(d.root)).map((f) => f.path);
    const cmd = verifyCommand(state.type, files);
    if (cmd) {
      d.ui.status("running");
      d.ui.message(`Testing task #${task.id}…`);
      const r = await sh(d, cmd, d.session.runTimeoutSeconds);
      if (!d.alive()) return true;
      passed = r.code === 0;
      if (!passed) note = `Command: ${cmd}\nExit: ${r.code ?? "timeout"}\n${r.out}`;
    }
  }

  const result = recordResult(state, task.id, passed, note, Date.now());
  state = result.state;
  if (result.action === "commit") {
    await save(d, state);
    await commit(d, `Task ${task.id}: ${task.title}`);
    d.ui.message(`✓ Task #${task.id} done${summary ? ` — ${summary}` : ""}`);
  } else if (result.action === "skip") {
    if (d.git.ok) await sh(d, "git reset -q --hard && git clean -q -fd");
    await save(d, state);
    await commit(d, `Skip task ${task.id} after 3 failed tries`);
    d.ui.message(`Task #${task.id} failed 3 times — undone and skipped. Moving on.`);
  } else {
    await save(d, state);
    d.ui.message(`Task #${task.id} didn't pass yet — fixing it next round.`);
  }
  return true;
}
