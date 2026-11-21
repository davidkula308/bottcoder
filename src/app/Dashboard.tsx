import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, FileCode2, Maximize2, Minimize2, Moon, Play, Power, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getBridge } from "./bridge";
import { CodeSurface, TerminalPanel } from "./surfaces";
import { AppsPanel, IdePanel, SchedulePanel, SessionPanel, SetupPanel } from "./panels";
import { useStored } from "./use-stored";
import { useCodingSession, type BotStatus } from "./use-coding-session";
import { archiveProject } from "./project-runner";
import { progress } from "./project";
import { missingForSession } from "./setup";
import type { LiveMode } from "./live";
import { ActivitySection, UpdateSection } from "./panels-activity";
import { DEFAULT_ACTIVITY, isActivityDue, pickActivityApp, type ActivityConfig } from "./activity";
import type { UpdateInfo } from "./update";
import {
  DEFAULT_AI,
  DEFAULT_SESSION,
  dayKey,
  formatClock,
  isScheduleDue,
  remainingMs,
  type Schedule,
} from "./engine";

const TABS = [
  { id: "session", label: "Session" },
  { id: "schedule", label: "Schedule" },
  { id: "apps", label: "Open apps" },
  { id: "ide", label: "Editors" },
  { id: "setup", label: "Setup" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const STATUS_LABEL: Record<BotStatus, string> = {
  idle: "idle",
  thinking: "thinking",
  writing: "writing code",
  running: "running",
  resting: "next file soon",
  error: "engine offline",
};

export function Dashboard() {
  const bridge = getBridge();
  const [session, setSession] = useStored("session", DEFAULT_SESSION);
  const [ai, setAi] = useStored("ai", DEFAULT_AI);
  const [prefs, setPrefs] = useStored("prefs", {
    workspace: bridge.isDesktop ? "" : "C:\\Users\\you\\NightShift\\workspace",
    followIde: null as string | null,
    autoStart: false,
    liveMode: "off" as LiveMode,
    typingCps: 30,
    theme: "night" as "night" | "day",
    autoUpdate: true,
  });
  const [activity, setActivity] = useStored<ActivityConfig>("activity", DEFAULT_ACTIVITY);
  const [activityDone, setActivityDone] = useState(0);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateProgress, setUpdateProgress] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [setupMissing, setSetupMissing] = useState<string[]>([]);
  const [schedules, setSchedules] = useStored<Schedule[]>("schedules", []);
  const [tab, setTab] = useState<TabId>("session");
  const [term, setTerm] = useState("");

  // Everything shown in the app's terminal is also mirrored into VS Code's "NightShift" terminal when writing there.
  const mirrorRef = useRef(false);
  mirrorRef.current = prefs.liveMode === "addon";
  const appendTerm = useCallback(
    (t: string) => {
      setTerm((s) => (s + t).slice(-40_000));
      if (mirrorRef.current) bridge.ide.live.term(t).catch(() => {});
    },
    [bridge],
  );

  const bot = useCodingSession({
    session,
    ai,
    workspace: prefs.workspace,
    followIde: prefs.followIde,
    liveMode: prefs.liveMode,
    typingCps: prefs.typingCps,
    onTerminal: appendTerm,
  });

  // Theme on <html> so every layer (including popovers) follows it.
  useEffect(() => {
    document.documentElement.classList.toggle("theme-day", prefs.theme === "day");
  }, [prefs.theme]);

  // Focus view: only the coding screen. Esc leaves it.
  const toggleFocus = useCallback((on: boolean) => {
    setFocus(on);
    if (on) document.documentElement.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFocus(false);
    const onFs = () => !document.fullscreenElement && setFocus(false);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, []);

  // Load the saved project plan for this folder.
  const { reloadPlan } = bot;
  useEffect(() => {
    reloadPlan();
  }, [prefs.workspace, session.mode, reloadPlan]);

  // What still blocks a session (desktop only).
  useEffect(() => {
    if (!bridge.isDesktop) return;
    bridge.setup
      .check(ai.ollamaUrl)
      .then((r) =>
        setSetupMissing(
          missingForSession(r, {
            ...ai,
            mode: session.mode,
            projectType: session.projectType,
            languages: session.languages,
          }),
        ),
      )
      .catch(() => {});
  }, [bridge, ai, session.mode, session.projectType, session.languages, tab]);

  const runInTerminal = useCallback(
    async (cmd: string, timeoutSec: number) => {
      appendTerm(`\n$ ${cmd}\n`);
      const code = await bridge.terminal.run(cmd, prefs.workspace, timeoutSec, appendTerm);
      appendTerm(`[exit ${code ?? "timeout"}]\n`);
      return code;
    },
    [appendTerm, bridge, prefs.workspace],
  );

  const startBot = useCallback(() => {
    if (!prefs.workspace) {
      setTab("session");
      return;
    }
    if (!bot.running) bot.start();
  }, [bot, prefs.workspace]);

  // Auto-start after boot
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !bridge.launchedAtStartup) return;
    const t = setTimeout(() => {
      if (prefs.autoStart && prefs.workspace) {
        autoStarted.current = true;
        startBot();
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [bridge.launchedAtStartup, prefs.autoStart, prefs.workspace, startBot]);

  // Schedules
  const schedRef = useRef({ schedules, startBot });
  schedRef.current = { schedules, startBot };
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const due = schedRef.current.schedules.filter((s) => isScheduleDue(s, now));
      if (!due.length) return;
      for (const s of due) {
        if (s.kind === "session") schedRef.current.startBot();
        else
          getBridge()
            .system.launch(s.target, s.kind)
            .then((r) => appendTerm(`\n[schedule] ${s.name}: ${r}\n`));
      }
      const key = dayKey(now);
      setSchedules((list) =>
        list.map((s) => (due.some((d) => d.id === s.id) ? { ...s, lastRunKey: key } : s)),
      );
    };
    const t = setInterval(tick, 20_000);
    tick();
    return () => clearInterval(t);
  }, [appendTerm, setSchedules]);

  // During coding: open one of the chosen apps every N minutes of the session, then close it.
  const actRef = useRef({ activity, done: 0, last: undefined as string | undefined });
  actRef.current.activity = activity;
  useEffect(() => {
    actRef.current.done = 0;
    setActivityDone(0);
    if (!bot.startedAt) return;
    const startedAt = bot.startedAt;
    const tick = () => {
      const r = actRef.current;
      if (!isActivityDue(r.activity, Date.now() - startedAt, r.done)) return;
      r.done++;
      setActivityDone(r.done);
      const app = pickActivityApp(r.activity.apps, Math.random, r.last);
      if (!app) return;
      r.last = app.path;
      appendTerm(`\n[activity] opening ${app.name} for ${r.activity.openSeconds}s\n`);
      getBridge()
        .system.blink(app.path, r.activity.openSeconds, r.activity.minimized)
        .then((msg) => appendTerm(`[activity] ${msg}\n`))
        .catch(() => {});
    };
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
  }, [bot.startedAt, appendTerm]);

  // Updates: check at start and every 6 hours; apply by itself when no session is running.
  const checkUpdate = useCallback(async () => {
    if (!bridge.isDesktop) return setUpdate(await bridge.update.check());
    setUpdate(
      await bridge.update
        .check()
        .catch((e: Error) => ({
          current: "?",
          latest: null,
          available: false,
          notes: "",
          error: e.message,
        })),
    );
  }, [bridge]);
  const applyUpdate = useCallback(async () => {
    setUpdateProgress("starting update…");
    try {
      await bridge.update.apply((p) => setUpdateProgress(p.status));
    } catch (e) {
      setUpdateProgress(
        `update failed: ${String((e as Error).message).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, "")}`,
      );
    }
  }, [bridge]);
  useEffect(() => {
    checkUpdate();
    const t = setInterval(checkUpdate, 6 * 3_600_000);
    return () => clearInterval(t);
  }, [checkUpdate]);
  useEffect(() => {
    if (
      bridge.isDesktop &&
      prefs.autoUpdate &&
      update?.available &&
      !bot.running &&
      !updateProgress
    )
      applyUpdate();
  }, [bridge.isDesktop, prefs.autoUpdate, update, bot.running, updateProgress, applyUpdate]);

  const left = bot.startedAt ? remainingMs(bot.startedAt, session.durationMinutes, bot.now) : null;
  const elapsed = bot.startedAt ? bot.now - bot.startedAt : 0;
  const clock = !bot.running
    ? session.durationMinutes === null
      ? "∞"
      : formatClock(session.durationMinutes * 60_000)
    : left === null
      ? formatClock(elapsed)
      : formatClock(left);

  const active = bot.status !== "idle";
  const planInfo = bot.plan ? progress(bot.plan) : null;
  const statusDot = (
    <span
      className={cn(
        "size-2 rounded-full",
        bot.status === "error"
          ? "bg-destructive"
          : active
            ? "animate-pulse-signal bg-signal"
            : "bg-muted-foreground",
      )}
    />
  );

  if (focus) {
    return (
      <div className="relative flex h-screen flex-col bg-surface">
        <CodeSurface code={bot.surface} file={bot.currentFile} status={bot.status} big />
        <div className="absolute bottom-4 right-4 flex items-center gap-3 rounded-full border bg-card/90 px-3 py-1.5 opacity-40 backdrop-blur transition-opacity hover:opacity-100">
          {statusDot}
          <span className="font-mono text-xs tabular-nums text-primary">{clock}</span>
          {bot.running ? (
            <button
              onClick={() => bot.stop()}
              className="font-mono text-[11px] uppercase text-destructive"
            >
              stop
            </button>
          ) : (
            <button onClick={startBot} className="font-mono text-[11px] uppercase text-primary">
              start
            </button>
          )}
          <button
            aria-label="Leave focus view"
            onClick={() => toggleFocus(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <Minimize2 className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid-dots flex min-h-screen flex-col bg-background lg:h-screen">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b bg-card/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground shadow-glow">
            <Cpu className="size-4" />
          </div>
          <div>
            <h1 className="font-display text-base font-bold leading-none tracking-tight">
              NightShift Coder
            </h1>
            <p className="label-caps mt-1">
              {ai.provider === "ollama" ? "ollama" : "nvidia nim"} · {ai.model}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-full border bg-muted px-3 py-1">
          {statusDot}
          <span className="font-mono text-[11px] uppercase tracking-wider">
            {STATUS_LABEL[bot.status]}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={prefs.theme === "day" ? "Switch to dark theme" : "Switch to light theme"}
              title={prefs.theme === "day" ? "Dark theme" : "Light theme"}
              onClick={() => setPrefs({ ...prefs, theme: prefs.theme === "day" ? "night" : "day" })}
            >
              {prefs.theme === "day" ? <Moon /> : <Sun />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Show only the coding screen"
              title="Coding screen only (Esc to leave)"
              onClick={() => toggleFocus(true)}
            >
              <Maximize2 />
            </Button>
          </div>
          <div className="text-right">
            <div className="label-caps">
              {bot.running ? (left === null ? "elapsed" : "time left") : "session length"}
            </div>
            <div className="font-mono text-2xl font-semibold tabular-nums text-primary">
              {clock}
            </div>
          </div>
          {bot.running ? (
            <Button variant="halt" size="xl" onClick={() => bot.stop()}>
              <Power /> Stop
            </Button>
          ) : (
            <Button variant="signal" size="xl" onClick={startBot}>
              <Play /> Start coding
            </Button>
          )}
        </div>
      </header>

      {bridge.isDesktop && setupMissing.length > 0 && (
        <button
          onClick={() => setTab("setup")}
          className="border-b bg-accent px-4 py-1.5 text-center font-mono text-[11px] text-warn hover:underline"
        >
          Setup needed before coding: {setupMissing.join(" · ")} — open Setup
        </button>
      )}
      {bridge.isDesktop && update?.available && (
        <button
          onClick={() => (bot.running ? setTab("setup") : applyUpdate())}
          className="border-b bg-accent px-4 py-1.5 text-center font-mono text-[11px] text-primary hover:underline"
        >
          {updateProgress ??
            `Version ${update.latest} is ready — ${bot.running ? "it installs when this session ends (or open Setup)" : "click to update and restart"}`}
        </button>
      )}
      {!bridge.isDesktop && (
        <div className="border-b bg-accent px-4 py-1.5 text-center font-mono text-[11px] text-accent-foreground">
          Preview mode — the AI, terminal and app launching are simulated here. Install the Windows
          app for the real thing.
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_400px]">
        <main className="grid min-h-0 gap-3 lg:grid-rows-[minmax(0,1fr)_260px]">
          <CodeSurface code={bot.surface} file={bot.currentFile} status={bot.status} />
          <TerminalPanel
            output={term}
            cwd={prefs.workspace}
            onKill={() => bridge.terminal.kill()}
            onRun={(cmd) => void runInTerminal(cmd, 120)}
          />
        </main>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="border-b px-4 py-3">
            <p className="font-mono text-xs text-foreground">{bot.message}</p>
            <div className="mt-2 flex gap-4 font-mono text-[11px] text-muted-foreground">
              <span>round #{bot.iteration}</span>
              <span>{bot.files.length} written</span>
              {planInfo && session.mode === "project" ? (
                <span className="text-primary">
                  plan {planInfo.done}/{planInfo.total}
                </span>
              ) : (
                <span>{session.mode}</span>
              )}
            </div>
          </div>
          <nav className="flex overflow-x-auto border-b">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "-mb-px shrink-0 border-b-2 px-3 py-2.5 font-mono text-[11px] uppercase tracking-wider transition-colors",
                  tab === t.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {tab === "session" && (
              <SessionPanel
                session={session}
                setSession={setSession}
                workspace={prefs.workspace}
                setWorkspace={(workspace) => setPrefs({ ...prefs, workspace })}
                locked={bot.running}
                plan={bot.plan}
                onResetProject={async () => {
                  if (!prefs.workspace) return;
                  await archiveProject(bridge, prefs.workspace);
                  await bot.reloadPlan();
                }}
              />
            )}
            {tab === "schedule" && (
              <div className="space-y-5">
                <ActivitySection
                  activity={activity}
                  setActivity={setActivity}
                  elapsedMs={bot.startedAt ? bot.now - bot.startedAt : null}
                  done={activityDone}
                />
                <SchedulePanel schedules={schedules} setSchedules={setSchedules} />
              </div>
            )}
            {tab === "apps" && <AppsPanel />}
            {tab === "ide" && (
              <IdePanel
                workspace={prefs.workspace}
                followIde={prefs.followIde}
                setFollowIde={(followIde) => setPrefs({ ...prefs, followIde })}
                liveMode={prefs.liveMode}
                setLiveMode={(liveMode) => setPrefs({ ...prefs, liveMode })}
                typingCps={prefs.typingCps}
                setTypingCps={(typingCps) => setPrefs({ ...prefs, typingCps })}
              />
            )}
            {tab === "setup" && (
              <div className="space-y-5">
                <UpdateSection
                  info={update}
                  onCheck={checkUpdate}
                  onApply={applyUpdate}
                  progress={updateProgress}
                  autoUpdate={prefs.autoUpdate}
                  setAutoUpdate={(autoUpdate) => setPrefs({ ...prefs, autoUpdate })}
                />
                <SetupPanel
                  ai={ai}
                  setAi={setAi}
                  autoStart={prefs.autoStart}
                  setAutoStart={(autoStart) => setPrefs({ ...prefs, autoStart })}
                  runInTerminal={runInTerminal}
                />
              </div>
            )}
          </div>
          <div className="max-h-40 overflow-y-auto border-t px-4 py-3">
            <div className="label-caps mb-2">recent files</div>
            {bot.files.length === 0 && (
              <p className="text-xs text-muted-foreground">Nothing written yet.</p>
            )}
            {bot.files.slice(0, 20).map((f) => (
              <div key={f.at} className="flex items-center gap-2 py-0.5 font-mono text-[11px]">
                <FileCode2 className="size-3 text-primary" />
                <span className="flex-1 truncate">{f.filename}</span>
                <span
                  className={cn(
                    f.exitCode === 0
                      ? "text-primary"
                      : f.exitCode === undefined
                        ? "text-muted-foreground"
                        : "text-warn",
                  )}
                >
                  {f.exitCode === undefined
                    ? "saved"
                    : f.exitCode === 0
                      ? "ok"
                      : `exit ${f.exitCode ?? "timeout"}`}
                </span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
