import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleDashed,
  Download,
  ExternalLink,
  Keyboard,
  RefreshCw,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getBridge, type IdeInfo } from "./bridge";
import { Field, Segmented } from "./controls";
import type { AiConfig, ProjectType, SessionConfig } from "./engine";
import { connectEditor, type LiveMode } from "./live";
import { PROJECT_TYPES, progress, type ProjectState } from "./project";
import {
  TOOLS,
  hasModel,
  recommendModel,
  toolPresent,
  wingetCommand,
  type SetupReport,
} from "./setup";

/* ---------------- Project mode ---------------- */

export function ProjectTypePicker({
  value,
  onChange,
}: {
  value: ProjectType;
  onChange: (t: ProjectType) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-1.5">
      {PROJECT_TYPES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cn(
            "rounded-md border px-3 py-2 text-left transition-colors",
            value === t.id ? "border-primary bg-primary/10" : "bg-muted/40 hover:border-primary/50",
          )}
        >
          <div className={cn("text-sm", value === t.id ? "text-primary" : "text-foreground")}>
            {t.label}
          </div>
          <div className="text-xs text-muted-foreground">{t.description}</div>
        </button>
      ))}
    </div>
  );
}

export function PlanView({
  plan,
  onReset,
  locked,
}: {
  plan: ProjectState | null;
  onReset: () => void;
  locked: boolean;
}) {
  if (!plan)
    return (
      <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        No project in this folder yet. Press Start and the bot writes a plan first, then builds it
        task by task.
      </p>
    );
  const p = progress(plan);
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="label-caps">current project</div>
          <div className="truncate text-sm">{plan.goal}</div>
        </div>
        <span className="shrink-0 font-mono text-xs text-primary">
          {p.done}/{p.total}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }}
        />
      </div>
      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {plan.tasks.map((t) => (
          <li key={t.id} className="flex items-start gap-2 text-xs">
            {t.status === "done" ? (
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
            ) : t.status === "skipped" ? (
              <XCircle className="mt-0.5 size-3.5 shrink-0 text-warn" />
            ) : (
              <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span
              className={cn(
                t.status === "done" ? "text-muted-foreground line-through" : "text-foreground",
              )}
            >
              {t.title}
              {t.status === "todo" && t.attempts > 0 && (
                <span className="ml-1 text-warn">(try {t.attempts + 1}/3)</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <Button variant="ghost" size="sm" disabled={locked} onClick={onReset} className="w-full">
        <RotateCcw /> Start a fresh project
      </Button>
    </div>
  );
}

export function ProjectSection({
  session,
  setSession,
  plan,
  onReset,
  locked,
}: {
  session: SessionConfig;
  setSession: (s: SessionConfig) => void;
  plan: ProjectState | null;
  onReset: () => void;
  locked: boolean;
}) {
  return (
    <>
      <Field label="Project type">
        <ProjectTypePicker
          value={session.projectType}
          onChange={(projectType) => setSession({ ...session, projectType })}
        />
      </Field>
      <PlanView plan={plan} onReset={onReset} locked={locked} />
    </>
  );
}

/* ---------------- Live typing ---------------- */

export function LiveTypingSection({
  mode,
  setMode,
  cps,
  setCps,
  ides,
  followIde,
  workspace,
}: {
  mode: LiveMode;
  setMode: (m: LiveMode) => void;
  cps: number;
  setCps: (n: number) => void;
  ides: IdeInfo[];
  followIde: string | null;
  workspace: string;
}) {
  const bridge = getBridge();
  const [addon, setAddon] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [note, setNote] = useState("");
  const ping = useCallback(() => bridge.ide.live.ping().then(setAddon), [bridge]);
  useEffect(() => {
    ping();
    const t = setInterval(ping, 5000);
    return () => clearInterval(t);
  }, [ping]);
  const vsFamily = ides.filter(
    (i) => ["vscode", "cursor", "windsurf"].includes(i.id) && i.available,
  );
  const target = ides.find((i) => i.id === followIde)?.name ?? "Notepad";

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="label-caps flex items-center gap-2">
        <Keyboard className="size-3.5" /> live typing
      </div>
      <Segmented
        value={mode}
        options={[
          { value: "off", label: "Off" },
          { value: "addon", label: "Write in VS Code" },
          { value: "keyboard", label: "Real keyboard" },
        ]}
        onChange={setMode}
      />

      {mode === "addon" && (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            When coding starts, NightShift opens your workspace in VS Code and writes the code there
            letter by letter. Commands and their output show in a “NightShift” terminal inside VS
            Code. NightShift still runs everything and reads the results, so keep it open (it can be
            minimized).
          </p>
          <p className={addon ? "text-primary" : "text-warn"}>
            {addon
              ? `● Connected to ${addon}`
              : "○ Not connected yet — press Connect, or just start coding."}
          </p>
          <div className="flex flex-wrap gap-2">
            {vsFamily.length > 0 && (
              <Button
                variant="signal"
                size="sm"
                disabled={!workspace || connecting}
                onClick={async () => {
                  setConnecting(true);
                  const app = await connectEditor(bridge, {
                    root: workspace,
                    preferred: followIde,
                    onNote: setNote,
                  });
                  setConnecting(false);
                  if (app) setNote(`Connected to ${app}.`);
                  ping();
                }}
              >
                {connecting ? "Connecting…" : "Connect VS Code"}
              </Button>
            )}
            {vsFamily.map((i) => (
              <Button
                key={i.id}
                variant="ghost"
                size="sm"
                onClick={async () => setNote(await bridge.ide.installAddon(i.id))}
              >
                Reinstall add-on in {i.name}
              </Button>
            ))}
            {vsFamily.length === 0 && <span>No VS Code-style editor found.</span>}
          </div>
        </div>
      )}

      {mode === "keyboard" && (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            Types with <span className="text-foreground">real keystrokes</span> into {target}, so
            Windows sees real typing activity and the PC won't fall asleep. Pick the editor with
            “mirror” above.
          </p>
          <p className="text-warn">
            Leave the editor window in front. If you switch to another window, typing pauses for
            that file so it never types into the wrong place. The finished file is always saved
            correctly.
          </p>
          <Field label={`Typing speed · ${cps} characters per second`}>
            <input
              type="range"
              min={8}
              max={80}
              value={cps}
              onChange={(e) => setCps(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </Field>
        </div>
      )}
      {note && <p className="font-mono text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

/* ---------------- Setup helper ---------------- */

export function SetupHelper({
  ai,
  setAi,
  runInTerminal,
}: {
  ai: AiConfig;
  setAi: (a: AiConfig) => void;
  runInTerminal: (cmd: string, timeoutSec: number) => Promise<number | null>;
}) {
  const bridge = getBridge();
  const [report, setReport] = useState<SetupReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pull, setPull] = useState<{ status: string; percent: number | null } | null>(null);

  const check = useCallback(async (): Promise<SetupReport | null> => {
    setChecking(true);
    try {
      const r = await bridge.setup.check(ai.ollamaUrl);
      setReport(r);
      return r;
    } catch {
      return null;
    } finally {
      setChecking(false);
    }
  }, [bridge, ai.ollamaUrl]);

  useEffect(() => {
    check();
  }, [check]);

  const rec = report ? recommendModel(report.ramGB) : null;
  const modelReady = report ? hasModel(report.models, ai.model) : false;

  const [ollamaProg, setOllamaProg] = useState<{ status: string; percent: number | null } | null>(
    null,
  );

  /** Electron wraps errors as "Error invoking remote method 'x': Error: …"; keep only the readable part. */
  const plain = (e: unknown) =>
    String((e as Error)?.message ?? e).replace(
      /^Error invoking remote method '[^']+': (\w*Error: )?/,
      "",
    );

  const download = async (): Promise<boolean> => {
    setPull({ status: "starting", percent: 0 });
    try {
      await bridge.ai.pull({ ollamaUrl: ai.ollamaUrl, model: ai.model }, setPull);
      setPull({ status: "done", percent: 100 });
      await check();
      return true;
    } catch (e) {
      setPull({ status: `failed: ${plain(e)}`, percent: null });
      await check();
      return false;
    }
  };

  /** Installs Ollama without winget: the app downloads the official installer and runs it for this user. */
  const installOllama = async (): Promise<boolean> => {
    setBusy("ollama");
    setOllamaProg({ status: "starting…", percent: 0 });
    try {
      await bridge.setup.installOllama(ai.ollamaUrl, setOllamaProg);
      setOllamaProg(null);
      return true;
    } catch (e) {
      setOllamaProg({ status: `failed: ${plain(e)}`, percent: null });
      return false;
    } finally {
      setBusy(null);
      await check();
    }
  };

  const install = async (id: (typeof TOOLS)[number]["id"]) => {
    const tool = TOOLS.find((t) => t.id === id);
    if (!tool || !report) return;
    if (id === "ollama") {
      // Finish the job: once the AI engine is up, fetch the chosen model straight away.
      if ((await installOllama()) && ai.provider === "ollama") await download();
      return;
    }
    if (!report.winget) {
      await bridge.system.openUrl(tool.url);
      return;
    }
    setBusy(id);
    await runInTerminal(wingetCommand(tool), 1800);
    setBusy(null);
    await check();
  };

  /** One button for everything the AI needs: Ollama first if missing, then the model. */
  const getModel = async () => {
    if (report && !report.ollama.installed && !(await installOllama())) return;
    await download();
  };

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <span className="label-caps">setup helper</span>
        <Button variant="ghost" size="sm" onClick={() => check()}>
          <RefreshCw className={checking ? "animate-spin" : ""} /> Re-check
        </Button>
      </div>
      {!report ? (
        <p className="text-xs text-muted-foreground">Checking your PC…</p>
      ) : (
        <>
          {TOOLS.map((t) => {
            const ok = toolPresent(report, t.id);
            const detail =
              t.id === "ollama"
                ? report.ollama.running
                  ? `running ${report.ollama.version ?? ""}`
                  : report.ollama.installed
                    ? "installed, not running — open Ollama"
                    : "not installed"
                : (report[t.id] ?? "not installed");
            return (
              <div key={t.id} className="flex items-center gap-3">
                {ok ? (
                  <CheckCircle2 className="size-4 shrink-0 text-primary" />
                ) : (
                  <XCircle className="size-4 shrink-0 text-warn" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm">
                    {t.label}{" "}
                    {t.id === "git" && (
                      <span className="text-xs text-muted-foreground">(recommended)</span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {detail}
                  </div>
                  {t.id === "ollama" && ollamaProg && (
                    <div className="mt-1 space-y-1">
                      <div
                        className={`text-[11px] ${ollamaProg.status.startsWith("failed") ? "text-warn" : "text-muted-foreground"}`}
                      >
                        {ollamaProg.status}
                      </div>
                      {ollamaProg.percent !== null && !ollamaProg.status.startsWith("failed") && (
                        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${ollamaProg.percent}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {busy === t.id && t.id !== "ollama" && (
                    <div className="text-[11px] text-muted-foreground">
                      Progress shows in the Terminal tab. If Windows asks for permission, click Yes.
                    </div>
                  )}
                </div>
                {!ok && (
                  <div className="flex shrink-0 items-center gap-1">
                    {(report.winget || t.id === "ollama") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        title={`Download from ${t.url}`}
                        onClick={() => bridge.system.openUrl(t.url)}
                      >
                        <ExternalLink />
                      </Button>
                    )}
                    <Button
                      variant="panel"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => install(t.id)}
                    >
                      {t.id === "ollama" || report.winget ? (
                        busy === t.id ? (
                          "Installing…"
                        ) : (
                          "Install"
                        )
                      ) : (
                        <>
                          <ExternalLink /> Get
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}

          <div className="border-t pt-3">
            <div className="text-sm">
              Your PC: {report.ramGB} GB memory · {report.cores} cores
            </div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">{report.cpu}</div>
            {rec && (
              <div className="mt-2 rounded border bg-card p-2 text-xs">
                <div>
                  Recommended model: <span className="font-mono text-primary">{rec.model}</span> (
                  {rec.size})
                </div>
                <div className="text-muted-foreground">{rec.why}</div>
                {ai.model !== rec.model && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-7 px-2"
                    onClick={() => setAi({ ...ai, provider: "ollama", model: rec.model })}
                  >
                    Use this model
                  </Button>
                )}
              </div>
            )}
          </div>

          {ai.provider === "ollama" && (
            <div className="flex items-center gap-3">
              {modelReady ? (
                <CheckCircle2 className="size-4 shrink-0 text-primary" />
              ) : (
                <XCircle className="size-4 shrink-0 text-warn" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm">AI model {ai.model}</div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  {modelReady
                    ? "downloaded — works offline"
                    : pull
                      ? pull.status
                      : report.ollama.installed
                        ? "not downloaded yet (needs internet once)"
                        : "not downloaded yet — Download installs Ollama too"}
                </div>
                {pull && pull.percent !== null && pull.status !== "done" && (
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${pull.percent}%` }}
                    />
                  </div>
                )}
              </div>
              {!modelReady && (
                <Button
                  variant="panel"
                  size="sm"
                  disabled={
                    busy !== null ||
                    (pull !== null && pull.status !== "done" && !pull.status.startsWith("failed"))
                  }
                  onClick={getModel}
                >
                  <Download /> Download
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
