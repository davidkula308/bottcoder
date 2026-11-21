import { useCallback, useEffect, useRef, useState } from "react";
import { getBridge } from "./bridge";
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
import { createAddonSink, createKeyboardSink, mergeSettings, type LiveMode, type LiveSink } from "./live";
import { loadProject, runProjectRound } from "./project-runner";
import type { ProjectState } from "./project";

export type BotStatus = "idle" | "thinking" | "writing" | "running" | "resting" | "error";

export interface WrittenFile {
  filename: string;
  path: string;
  language: string;
  at: number;
  exitCode: number | null | undefined;
}

interface Options {
  session: SessionConfig;
  ai: AiConfig;
  workspace: string;
  followIde: string | null;
  liveMode: LiveMode;
  typingCps: number;
  onTerminal: (text: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const VSCODE_FAMILY = ["vscode", "cursor", "windsurf"];

export function useCodingSession(opts: Options) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const runRef = useRef(0);
  const [status, setStatus] = useState<BotStatus>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [iteration, setIteration] = useState(0);
  const [surface, setSurface] = useState("");
  const [currentFile, setCurrentFile] = useState<{ name: string; language: string } | null>(null);
  const [files, setFiles] = useState<WrittenFile[]>([]);
  const [plan, setPlan] = useState<ProjectState | null>(null);
  const [message, setMessage] = useState("Ready. Pick a workspace folder and press Start.");

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
    runRef.current++;
    setStartedAt(null);
    setStatus("idle");
    setMessage(reason);
    const b = getBridge();
    await Promise.allSettled([b.ai.cancel(), b.terminal.kill(), b.system.keepAwake(false)]);
  }, []);

  const makeSink = useCallback(async (): Promise<LiveSink | null> => {
    const { liveMode, workspace, followIde, typingCps } = optsRef.current;
    const bridge = getBridge();
    if (liveMode === "addon") {
      const app = await bridge.ide.live.ping();
      return app ? createAddonSink(bridge, workspace) : null;
    }
    if (liveMode === "keyboard") {
      return createKeyboardSink(bridge, {
        root: workspace,
        editor: followIde ?? "notepad",
        cps: typingCps,
        onNote: setMessage,
      });
    }
    return null;
  }, []);

  const start = useCallback(async () => {
    const bridge = getBridge();
    const myRun = ++runRef.current;
    const begin = Date.now();
    setStartedAt(begin);
    setNow(begin);
    await bridge.system.keepAwake(true);
    const history: string[] = [];
    const failStreak: Record<string, number> = {};
    let lastOutput: string | undefined;
    let lastExit: number | null | undefined;
    let stuckFile: string | undefined;
    let iter = 0;
    const alive = () => runRef.current === myRun;

    const git = { ok: false };
    {
      let out = "";
      const code = await bridge.terminal.run("git --version", optsRef.current.workspace, 15, (t) => (out += t));
      git.ok = code === 0 && /git version/i.test(out);
    }
    {
      const { liveMode, followIde, workspace } = optsRef.current;
      if (liveMode === "keyboard" && VSCODE_FAMILY.includes(followIde ?? "")) {
        const existing = await bridge.fs.read(workspace, ".vscode/settings.json");
        await bridge.fs.writeFile(workspace, ".vscode/settings.json", mergeSettings(existing));
      }
    }

    while (alive()) {
      const { session, ai, workspace, followIde, onTerminal } = optsRef.current;
      if (isSessionOver(begin, session.durationMinutes, Date.now())) {
        await stop("Time is up — session finished.");
        return;
      }
      iter++;
      setIteration(iter);
      const sink = await makeSink();

      if (session.mode === "project") {
        const reached = await runProjectRound({
          bridge,
          root: workspace,
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
            fileWritten: (f) => setFiles((list) => [{ ...f, at: Date.now() + Math.random() }, ...list].slice(0, 200)),
            plan: setPlan,
          },
        });
        if (!alive()) return;
        if (!reached) {
          await sleep(15_000);
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
        setStatus("error");
        setMessage(`AI engine not reachable: ${(e as Error).message}. Retrying in 15s…`);
        await sleep(15_000);
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
      await sink?.finish(parsed.filename, parsed.code);
      let path = parsed.filename;
      try {
        path = await bridge.fs.writeFile(workspace, parsed.filename, parsed.code);
      } catch (e) {
        setMessage(`Could not save file: ${(e as Error).message}`);
      }
      if (!history.includes(parsed.filename)) history.push(parsed.filename);
      if (followIde && !sink?.opensEditor) bridge.ide.open(followIde, workspace, path).catch(() => {});

      const entry: WrittenFile = { filename: parsed.filename, path, language: parsed.language, at: Date.now(), exitCode: undefined };
      setFiles((f) => [entry, ...f].slice(0, 200));

      const cmd = session.autoRun ? runCommandFor(parsed.filename) : null;
      if (cmd) {
        setStatus("running");
        setMessage(`Running ${parsed.filename}…`);
        onTerminal(`\n$ ${cmd}\n`);
        let out = "";
        const code = await bridge.terminal.run(cmd, workspace, session.runTimeoutSeconds, (d) => {
          out += d;
          onTerminal(d);
        });
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

      setStatus("resting");
      setMessage(`Saved ${parsed.filename}. Next file in ${session.pauseSeconds}s…`);
      await sleep(session.pauseSeconds * 1000);
    }
  }, [stop, makeSink]);

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
    start,
    stop,
    running: startedAt !== null,
  };
}
