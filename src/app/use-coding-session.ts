import { useCallback, useEffect, useRef, useState } from "react";
import { getBridge, type DesktopBridge } from "./bridge";
import {
  STUCK_LIMIT,
  buildPrompt,
  isSessionOver,
  parseCodeResponse,
  runCommandFor,
  streamingCode,
  type AiConfig,
  type SessionConfig,
} from "./engine";
import { VSCODE_FAMILY, connectEditor, createAddonSink, createKeyboardSink, mergeSettings, type LiveMode, type LiveSink } from "./live";
import { loadProject, runProjectRound } from "./project-runner";
import type { ProjectState } from "./project";
import { createPacer } from "./pacer";
import { writePractice } from "./practice";
import { hasModel } from "./setup";
import type { SessionRecord } from "./history";

export type BotStatus = "idle" | "thinking" | "writing" | "running" | "resting" | "error";

export interface WrittenFile {
  filename: string;
  path: string;
  language: string;
  at: number;
  exitCode: number | null | undefined;
  /** false = tested and thrown away, or practice code that was only shown */
  kept?: boolean;
  practice?: boolean;
}

interface Options {
  session: SessionConfig;
  ai: AiConfig;
  workspace: string;
  followIde: string | null;
  liveMode: LiveMode;
  typingCps: number;
  /** Typing speed on screen. cps null = as fast as the AI writes. */
  speed: { cps: number | null; humanLike: boolean };
  /** false = code is tested in a temporary folder and thrown away. */
  saveFiles: boolean;
  onTerminal: (text: string) => void;
  onSessionEnd?: (rec: SessionRecord) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PRACTICE_KEY = "nightshift:practiceUsed";
/** Practice code at "as fast as possible" still types visibly. */
const PRACTICE_MAX_CPS = 90;

function loadUsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(PRACTICE_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function saveUsed(used: Set<string>) {
  try {
    localStorage.setItem(PRACTICE_KEY, JSON.stringify([...used]));
  } catch {
    /* storage full — not important */
  }
}

/** Same bridge, but AI text arrives at the chosen typing speed. */
function withPacing(bridge: DesktopBridge, speed: Options["speed"], alive: () => boolean): DesktopBridge {
  if (speed.cps === null) return bridge;
  return {
    ...bridge,
    ai: {
      ...bridge.ai,
      async generate(req, onChunk) {
        const pacer = createPacer(speed, onChunk, alive);
        const full = await bridge.ai.generate(req, (c) => pacer.push(c));
        await pacer.drain();
        return full;
      },
    },
  };
}

/** Is the AI engine usable right now (running, and the model is there)? */
async function aiReady(bridge: DesktopBridge, ai: AiConfig): Promise<boolean> {
  if (ai.provider === "nim" && !ai.nimKey.trim()) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const models = await Promise.race([
      bridge.ai.listModels({ provider: ai.provider, ollamaUrl: ai.ollamaUrl, nimKey: ai.nimKey }),
      new Promise<string[]>((resolve) => { timer = setTimeout(() => resolve([]), 3000); }),
    ]);
    if (ai.provider === "nim" && !models.length) return false;
    return ai.provider === "nim" ? true : hasModel(models, ai.model);
  } catch {
    return false;
  } finally { clearTimeout(timer); }
}

export function useCodingSession(opts: Options) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const runRef = useRef(0);
  const statsRef = useRef({ files: 0, lines: 0, ai: false, practice: false, kept: true, begin: 0, root: "" });
  const [status, setStatus] = useState<BotStatus>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [iteration, setIteration] = useState(0);
  const [surface, setSurface] = useState("");
  const [currentFile, setCurrentFile] = useState<{ name: string; language: string } | null>(null);
  const [files, setFiles] = useState<WrittenFile[]>([]);
  const [plan, setPlan] = useState<ProjectState | null>(null);
  const [practice, setPractice] = useState(false);
  const [message, setMessage] = useState("Ready. Press Start coding.");
  const screenRef = useRef({ surface, file: currentFile });
  screenRef.current = { surface, file: currentFile };

  useEffect(() => {
    try {
      const screen = JSON.parse(localStorage.getItem("nightshift:lastScreen") ?? "null") as { surface: string; file: { name: string; language: string } | null } | null;
      if (screen && typeof screen.surface === "string") {
        setSurface(screen.surface);
        setCurrentFile(screen.file);
      }
    } catch { /* ignore damaged storage */ }
  }, []);

  useEffect(() => {
    if (!surface) return;
    const t = setTimeout(() => {
      try { localStorage.setItem("nightshift:lastScreen", JSON.stringify({ surface, file: currentFile })); } catch { /* storage unavailable */ }
    }, 500);
    return () => clearTimeout(t);
  }, [surface, currentFile]);

  useEffect(() => {
    if (!startedAt) return;
    const checkpoint = () => {
      if (!statsRef.current.begin) return;
      try {
        const st = statsRef.current;
        const record: SessionRecord = { id: `${startedAt}`, startedAt, endedAt: Date.now(), mode: optsRef.current.session.mode, engine: st.ai && st.practice ? "mixed" : st.ai ? "ai" : "practice", files: st.files, lines: st.lines, kept: st.kept, reason: "App closed during coding." };
        localStorage.setItem("nightshift:openSession", JSON.stringify({ startedAt, elapsedMs: Date.now() - startedAt, durationMinutes: optsRef.current.session.durationMinutes, session: optsRef.current.session, savedAt: Date.now(), record }));
        localStorage.setItem("nightshift:lastScreen", JSON.stringify(screenRef.current));
      } catch { /* storage unavailable */ }
    };
    checkpoint();
    window.addEventListener("beforeunload", checkpoint);
    return () => window.removeEventListener("beforeunload", checkpoint);
  }, [startedAt, now]);

  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  const reloadPlan = useCallback(async () => {
    const { workspace } = optsRef.current;
    setPlan(workspace ? await loadProject(getBridge(), workspace) : null);
  }, []);

  const stop = useCallback(async (reason = "Stopped.") => {
    const wasRunning = statsRef.current.begin > 0;
    const st = statsRef.current;
    statsRef.current = { ...st, begin: 0 };
    try { localStorage.removeItem("nightshift:openSession"); } catch { /* storage unavailable */ }
    runRef.current++;
    setStatus("idle");
    setPractice(false);
    setMessage(reason);
    const b = getBridge();
    await Promise.allSettled([b.ai.cancel(), b.terminal.kill(), b.system.keepAwake(false)]);
    if (wasRunning) {
      if (!st.kept) await b.fs.clearScratch().catch(() => {});
      optsRef.current.onSessionEnd?.({
        id: `${st.begin}`,
        startedAt: st.begin,
        endedAt: Date.now(),
        mode: optsRef.current.session.mode,
        engine: st.ai && st.practice ? "mixed" : st.ai ? "ai" : "practice",
        files: st.files,
        lines: st.lines,
        kept: st.kept,
        reason,
      });
    }
    setStartedAt(null);
  }, []);

  useEffect(() => {
    if (startedAt && isSessionOver(startedAt, optsRef.current.session.durationMinutes, now)) void stop("Time is up — session finished.");
  }, [startedAt, now, stop]);

  const makeSink = useCallback(async (root: string): Promise<LiveSink | null> => {
    const { liveMode, followIde, typingCps, speed } = optsRef.current;
    const bridge = getBridge();
    if (liveMode === "addon") {
      const app = await bridge.ide.live.ping();
      return app ? createAddonSink(bridge, root) : null;
    }
    if (liveMode === "keyboard") {
      return createKeyboardSink(bridge, {
        root,
        editor: followIde ?? "notepad",
        cps: speed.cps ?? typingCps,
        onNote: setMessage,
      });
    }
    return null;
  }, []);

  /** Built-in practice code: shown on screen only, never saved or run. Works with nothing installed. */
  const practiceRound = useCallback(async (alive: () => boolean, used: Set<string>) => {
    const { session, speed } = optsRef.current;
    const snip = writePractice(Math.random, used);
    used.add(snip.signature);
    saveUsed(used);
    setStatus("writing");
    setCurrentFile({ name: snip.filename, language: snip.language });
    setSurface("");
    let shown = "";
    const pacer = createPacer(
      { cps: speed.cps === null ? PRACTICE_MAX_CPS : Math.min(speed.cps, PRACTICE_MAX_CPS * 2), humanLike: speed.humanLike },
      (c) => {
        shown += c;
        setSurface(shown);
      },
      alive,
    );
    pacer.push(snip.code);
    await pacer.drain();
    if (!alive()) return;
    statsRef.current.files++;
    statsRef.current.lines += snip.code.split("\n").length;
    setFiles((f) => [{ filename: snip.filename, path: "", language: snip.language, at: Date.now() + Math.random(), exitCode: undefined, kept: false, practice: true }, ...f].slice(0, 200));
    setStatus("resting");
    setMessage(`Practice code: ${snip.filename} (shown only, not saved). Next one in ${session.pauseSeconds}s…`);
    await sleep(session.pauseSeconds * 1000);
  }, []);

  const start = useCallback(
    async (resumeElapsedMs = 0, previousRecord?: SessionRecord) => {
      const raw = getBridge();
      const myRun = ++runRef.current;
      const begin = Date.now() - Math.max(0, resumeElapsedMs);
      const alive = () => runRef.current === myRun;
      const bridge = withPacing(raw, optsRef.current.speed, alive);
      setStartedAt(begin);
      setNow(Date.now());
      setFiles([]);
      const keep = optsRef.current.saveFiles;
      let root = keep ? optsRef.current.workspace : "";
      statsRef.current = { files: previousRecord?.files ?? 0, lines: previousRecord?.lines ?? 0, ai: previousRecord?.engine === "ai" || previousRecord?.engine === "mixed", practice: previousRecord?.engine === "practice" || previousRecord?.engine === "mixed", kept: keep && !!optsRef.current.workspace, begin, root };
      await raw.system.keepAwake(true).catch(() => {});
      if (!alive()) return;
      const used = loadUsed();
      const history: string[] = [];
      const failStreak: Record<string, number> = {};
      let lastOutput: string | undefined;
      let lastExit: number | null | undefined;
      let stuckFile: string | undefined;
      let iter = 0;

      setMessage("Checking the AI engine…");
      let engineOk = await aiReady(raw, optsRef.current.ai);
      if (!alive()) return;
      if (!engineOk) {
        setPractice(true);
        setMessage("No AI engine found — writing practice code on screen instead (not saved). It switches to the AI by itself once it's ready.");
      }
      if (engineOk && !root) root = await (keep ? raw.fs.defaultWorkspace() : raw.fs.scratchDir()).catch(() => "");
      statsRef.current.root = root;
      statsRef.current.kept = keep && !!root;

      const git = { ok: false };
      if (engineOk && root) {
        let out = "";
        const code = await raw.terminal.run("git --version", root, 15, (t) => (out += t)).catch(() => null);
        git.ok = code === 0 && /git version/i.test(out);
      }
      if (engineOk && root) {
        const { liveMode, followIde } = optsRef.current;
        if (liveMode === "addon") {
          // Code is written inside VS Code: open the folder there and make sure the add-on is listening.
          void connectEditor(raw, { root, preferred: followIde, onNote: (m) => { if (alive()) setMessage(m); } }).then((editor) => {
            if (alive()) setMessage(editor ? `Connected to ${editor} — code will be written there.` : "Coding here instead of VS Code.");
          }).catch(() => {});
        }
        if (liveMode === "keyboard" && VSCODE_FAMILY.includes(followIde ?? "")) {
          const existing = await raw.fs.read(root, ".vscode/settings.json").catch(() => null);
          await raw.fs.writeFile(root, ".vscode/settings.json", mergeSettings(existing)).catch(() => {});
        }
      }

      while (alive()) {
        const { session, ai, followIde, onTerminal } = optsRef.current;
        if (isSessionOver(begin, session.durationMinutes, Date.now())) {
          await stop("Time is up — session finished.");
          return;
        }
        iter++;
        setIteration(iter);

        // No AI: keep writing practice code, and look for the AI again every few programs.
        if (!engineOk && iter % 5 === 0) {
          engineOk = await aiReady(raw, ai);
          if (engineOk) {
            if (!root) root = await (keep ? raw.fs.defaultWorkspace() : raw.fs.scratchDir()).catch(() => "");
            statsRef.current.root = root;
            statsRef.current.kept = keep && !!root;
            if (root && optsRef.current.liveMode === "addon") void connectEditor(raw, { root, preferred: followIde, onNote: (m) => { if (alive()) setMessage(m); } }).catch(() => null);
            setMessage("AI engine found — switching from practice code to real coding.");
          }
        }
        if (!engineOk || !root) {
          setPractice(true);
          statsRef.current.practice = true;
          await practiceRound(alive, used);
          continue;
        }
        setPractice(false);
        statsRef.current.ai = true;
        const sink = await makeSink(root).catch(() => null);

        if (session.mode === "project") {
          const reached = await runProjectRound({
            bridge,
            root,
            session,
            ai,
            alive,
            sink,
            followIde,
            git,
            ui: {
              status: (s) => alive() && setStatus(s),
              message: (m) => alive() && setMessage(m),
              surface: (c) => alive() && setSurface(c),
              file: (f) => alive() && setCurrentFile(f),
              terminal: onTerminal,
              fileWritten: (f) => {
                statsRef.current.files++;
                setFiles((list) => [{ ...f, kept: statsRef.current.kept, at: Date.now() + Math.random() }, ...list].slice(0, 200));
              },
              plan: setPlan,
            },
          }).catch((e: unknown) => {
            onTerminal(`\n[project] ${String(e)} — switching to surface code.\n`);
            engineOk = false;
            return false;
          });
          if (!alive()) return;
          if (!reached) {
            engineOk = false;
            continue;
          }
          setStatus("resting");
          await sleep(session.pauseSeconds * 1000);
          continue;
        }

        setStatus("thinking");
        setMessage(session.mode === "random" ? "Picking something fun to build…" : "Planning the next step…");
        setSurface("");
        setCurrentFile(null);

        const { system, prompt } = buildPrompt(session, {
          iteration: iter,
          files: history,
          lastOutput,
          lastExitCode: lastExit,
          stuckFile,
          rand: Math.random,
        });
        stuckFile = undefined;

        let text = "";
        try {
          text = await bridge.ai.generate(
            { provider: ai.provider, model: ai.model, system, prompt, ollamaUrl: ai.ollamaUrl, nimKey: ai.nimKey },
            (chunk) => {
              if (!alive()) return;
              text += chunk;
              sink?.onText(text);
              const name = /FILE:\s*`?([^\s`]+)/i.exec(text)?.[1];
              const lang = /```([\w+#-]*)/.exec(text)?.[1];
              if (name) setCurrentFile({ name, language: lang || "text" });
              const code = streamingCode(text);
              if (code) {
                setStatus("writing");
                setSurface(code);
              }
            },
          );
        } catch (e) {
          if (!alive()) return;
          setMessage(`AI engine stopped answering (${(e as Error).message}) — writing practice code meanwhile.`);
          engineOk = false;
          continue;
        }
        if (!alive()) return;

        const parsed = parseCodeResponse(text, iter);
        if (!parsed) {
          setMessage("The model replied without code — asking again.");
          continue;
        }
        setSurface(parsed.code);
        setCurrentFile({ name: parsed.filename, language: parsed.language });
        await sink?.finish(parsed.filename, parsed.code).catch(() => {});
        let path = parsed.filename;
        try {
          path = await bridge.fs.writeFile(root, parsed.filename, parsed.code);
        } catch (e) {
          setMessage(`Could not save file: ${(e as Error).message}`);
        }
        statsRef.current.files++;
        statsRef.current.lines += parsed.code.split("\n").length;
        if (!history.includes(parsed.filename)) history.push(parsed.filename);
        if (followIde && !sink?.opensEditor && statsRef.current.kept) bridge.ide.open(followIde, root, path).catch(() => {});

        const entry: WrittenFile = { filename: parsed.filename, path, language: parsed.language, at: Date.now(), exitCode: undefined, kept: statsRef.current.kept };
        setFiles((f) => [entry, ...f].slice(0, 200));

        const cmd = session.autoRun ? runCommandFor(parsed.filename) : null;
        if (cmd) {
          setStatus("running");
          setMessage(`Running ${parsed.filename}…`);
          onTerminal(`\n$ ${cmd}\n`);
          let out = "";
          const code = await bridge.terminal.run(cmd, root, session.runTimeoutSeconds, (d) => {
            out += d;
            onTerminal(d);
          }).catch((e: unknown) => { onTerminal(`\n[test unavailable] ${String(e)}\n`); return null; });
          if (!alive()) return;
          lastOutput = out;
          lastExit = code;
          onTerminal(`[exit ${code ?? "timeout"}]\n`);
          setFiles((f) => f.map((x) => (x === entry ? { ...x, exitCode: code } : x)));
          failStreak[parsed.filename] = code === 0 ? 0 : (failStreak[parsed.filename] ?? 0) + 1;
          if ((failStreak[parsed.filename] ?? 0) >= STUCK_LIMIT) {
            stuckFile = parsed.filename;
            failStreak[parsed.filename] = 0;
          }
        } else {
          lastOutput = undefined;
        }
        // "Don't keep files": tested, now thrown away.
        if (!statsRef.current.kept) await bridge.fs.remove(root, parsed.filename).catch(() => {});

        setStatus("resting");
        setMessage(`${statsRef.current.kept ? "Saved" : "Tested and discarded"} ${parsed.filename}. Next file in ${session.pauseSeconds}s…`);
        await sleep(session.pauseSeconds * 1000);
      }
    },
    [stop, makeSink, practiceRound],
  );

  useEffect(() => () => void (runRef.current++), []);

  return {
    status,
    startedAt,
    now,
    iteration,
    surface,
    currentFile,
    files,
    plan,
    reloadPlan,
    message,
    practice,
    start,
    stop,
    running: startedAt !== null,
  };
}
