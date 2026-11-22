import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, FileCode2, Maximize2, Minimize2, Moon, Play, Power, RefreshCw, Sun } from "lucide-react";
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
import { fetchAndInstallUpdate, type UpdateInfo } from "./update";
import { DEFAULT_SPEED, resolveSpeed, type SpeedSetting } from "./pacer";
import { addRecord, type SessionRecord } from "./history";
import { canResume, type OpenSession } from "./history";
import { planOptimization, type OptimizePlan } from "./optimize";
import { HistoryPanel, KeepFiles, OptimizeDialog, SpeedDialog } from "./panels-session";
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
  { id: "history", label: "History" },
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
    saveFiles: false,
  });
  const [speed, setSpeed] = useStored<SpeedSetting>("speed", DEFAULT_SPEED);
  const [history, setHistory] = useStored<SessionRecord[]>("history", []);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [openSession, setOpenSession] = useState<OpenSession | null>(null);
  const [resumeMs, setResumeMs] = useState(0);
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [optimizePlan, setOptimizePlan] = useState<OptimizePlan | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeStatus, setOptimizeStatus] = useState("");
  const [downloads, setDownloads] = useState(true);
  const [activity, setActivity] = useStored<ActivityConfig>("activity", DEFAULT_ACTIVITY);
  const [activityDone, setActivityDone] = useState(0);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateProgress, setUpdateProgress] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState(false);
  const updateTaskRef = useRef(false);
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
    speed: resolveSpeed(speed),
    saveFiles: prefs.saveFiles,
    onTerminal: appendTerm,
    onSessionEnd: (rec) => { setHistory((list) => addRecord(list, rec)); setOpenSession(null); },
  });
  const runningRef = useRef(bot.running);
  runningRef.current = bot.running;

  useEffect(() => {
    try {
      const previous = JSON.parse(localStorage.getItem("nightshift:openSession") ?? "null") as OpenSession | null;
      if (previous?.record) setHistory((list) => previous.record ? addRecord(list, previous.record) : list);
      if (canResume(previous)) setOpenSession(previous);
      if (localStorage.getItem("nightshift:optimizationPromptSeen") !== "true") setOptimizeOpen(true);
    } catch { /* storage unavailable */ }
  }, [setHistory]);

  useEffect(() => {
    if (!optimizeOpen) return;
    let cancelled = false;
    setOptimizeStatus("Checking your PC…");
    Promise.all([bridge.setup.check(ai.ollamaUrl), bridge.ide.detect()]).then(([report, editors]) => {
      if (cancelled) return;
      setOptimizePlan(planOptimization(report, editors));
      setOptimizeStatus("");
    }).catch(() => { if (!cancelled) setOptimizeStatus("PC checks are unavailable. You can still start surface coding."); });
    return () => { cancelled = true; };
  }, [optimizeOpen, bridge, ai.ollamaUrl]);

  const closeOptimization = (open: boolean) => {
    setOptimizeOpen(open);
    if (!open) try { localStorage.setItem("nightshift:optimizationPromptSeen", "true"); } catch { /* storage unavailable */ }
  };
  const optimize = async () => {
    if (!optimizePlan || optimizing || bot.running) return;
    const p = optimizePlan;
    setOptimizing(true);
    try {
      const workspace = prefs.saveFiles ? await bridge.fs.defaultWorkspace().catch(() => prefs.workspace) : prefs.workspace;
      setAi({ ...ai, provider: "ollama", model: p.model });
      setSession({ ...session, mode: p.mode, projectType: p.projectType, languages: p.languages, autoRun: p.autoRun });
      setPrefs({ ...prefs, workspace, followIde: p.followIde, liveMode: p.liveMode });
      setOptimizeStatus("Settings applied. Surface coding is ready, even without the AI.");
      if (p.followIde) {
        setOptimizeStatus("Connecting your coding app…");
        await bridge.ide.installAddon(p.followIde).catch((e: unknown) => appendTerm(`\n[setup] Editor connection unavailable: ${String(e)}. Coding here instead.\n`));
        if (workspace) await bridge.ide.open(p.followIde, workspace).catch(() => {});
      }
      if (downloads) {
        if (p.installOllama) await bridge.setup.installOllama(ai.ollamaUrl, (v) => setOptimizeStatus(`${v.status}${v.percent === null ? "" : ` · ${Math.round(v.percent)}%`}`));
        if (p.downloadModel) await bridge.ai.pull({ ollamaUrl: ai.ollamaUrl, model: p.model }, (v) => setOptimizeStatus(`${v.status}${v.percent === null ? "" : ` · ${Math.round(v.percent)}%`}`));
      }
      setOptimizeStatus("Ready. Your settings have been saved on this PC.");
      try { localStorage.setItem("nightshift:optimizationPromptSeen", "true"); } catch { /* storage unavailable */ }
    } catch (e) {
      setOptimizeStatus(`Settings saved; AI download did not finish. Start coding still works with surface code. ${String(e).replace(/^Error invoking remote method '[^']+': /, "")}`);
    } finally { setOptimizing(false); }
  };

  // Theme on <html> so every layer (including popovers) follows it.
  useEffect(() => {
    document.documentElement.classList.toggle("theme-day", prefs.theme === "day");
  }, [prefs.theme]);

  // Focus view stays in the app window; Windows keeps its taskbar. Esc leaves it.
  const toggleFocus = useCallback((on: boolean) => {
    setFocus(on);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFocus(false);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
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
    if (!bot.running && !updateTaskRef.current) bot.start();
  }, [bot]);

  const requestStart = () => { if (updateTaskRef.current) return; setResumeMs(0); setSpeedOpen(true); };
  const requestResume = () => {
    if (!openSession || !canResume(openSession)) return;
    if (openSession.session) setSession(openSession.session);
    else setSession({ ...session, durationMinutes: openSession.durationMinutes });
    setResumeMs(openSession.elapsedMs);
    setSpeedOpen(true);
  };
  const dismissResume = () => {
    setOpenSession(null);
    try { localStorage.removeItem("nightshift:openSession"); } catch { /* storage unavailable */ }
  };

  // Auto-start after boot
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !bridge.launchedAtStartup) return;
    const t = setTimeout(() => {
      if (prefs.autoStart) {
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
    if (updateTaskRef.current) return;
    if (!bridge.isDesktop) {
      setUpdateProgress("Open the installed Windows app to fetch and install updates.");
      return;
    }
    if (runningRef.current) {
      setPendingUpdate(true);
      setUpdateProgress("Update queued. It will install when coding stops.");
      return;
    }
    updateTaskRef.current = true;
    setUpdateBusy(true);
    setPendingUpdate(false);
    setUpdateProgress("starting update…");
    let restarting = false;
    try {
      const applied = await bridge.update.apply((p) => setUpdateProgress(p.status));
      restarting = applied;
      if (!applied) setUpdateProgress("The latest published version is already installed.");
    } catch (e) {
      setUpdateProgress(
        `update failed: ${String((e as Error).message).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, "")}`,
      );
    } finally { if (!restarting) { updateTaskRef.current = false; setUpdateBusy(false); } }
  }, [bridge]);
  const fetchUpdates = useCallback(async () => {
    if (updateTaskRef.current) return;
    setTab("setup");
    if (!bridge.isDesktop) {
      setUpdateProgress("Open the installed Windows app to fetch and install updates from https://bottcoder.lovable.app.");
      return;
    }
    updateTaskRef.current = true;
    setUpdateBusy(true);
    setPendingUpdate(false);
    let restarting = false;
    try {
      const result = await fetchAndInstallUpdate({
        check: () => bridge.update.check(),
        apply: (onProgress) => bridge.update.apply((p) => onProgress(p.status)),
        isRunning: () => runningRef.current,
        onInfo: setUpdate,
        onStatus: setUpdateProgress,
      });
      setPendingUpdate(result === "queued");
      restarting = result === "installed";
    } finally { if (!restarting) { updateTaskRef.current = false; setUpdateBusy(false); } }
  }, [bridge]);
  useEffect(() => {
    checkUpdate();
    const t = setInterval(checkUpdate, 6 * 3_600_000);
    return () => clearInterval(t);
  }, [checkUpdate]);
  useEffect(() => {
    if (
      bridge.isDesktop &&
      (prefs.autoUpdate || pendingUpdate) &&
      update?.available &&
      !bot.running &&
      !updateBusy &&
      (!updateProgress || pendingUpdate)
    )
      applyUpdate();
  }, [bridge.isDesktop, prefs.autoUpdate, pendingUpdate, update, bot.running, updateBusy, updateProgress, applyUpdate]);

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
  const dialogs = <>
    <SpeedDialog open={speedOpen} onOpenChange={setSpeedOpen} speed={speed} setSpeed={setSpeed} keep={prefs.saveFiles} setKeep={(saveFiles) => setPrefs({ ...prefs, saveFiles })} resuming={resumeMs > 0} onStart={() => {
      if (updateTaskRef.current) return;
      const previous = resumeMs > 0 ? openSession?.record : undefined;
      if (previous) setHistory((list) => list.filter((r) => r.id !== previous.id));
      setSpeedOpen(false);
      dismissResume();
      void bot.start(resumeMs, previous);
    }} />
    <OptimizeDialog open={optimizeOpen} onOpenChange={closeOptimization} plan={optimizePlan} status={optimizeStatus} busy={optimizing} downloads={downloads} setDownloads={setDownloads} onOptimize={() => void optimize()} />
  </>;
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
      <div className="grid h-dvh min-w-0 grid-rows-[minmax(0,2fr)_minmax(0,1fr)] bg-surface">
        <CodeSurface code={bot.surface} file={bot.currentFile} status={bot.status} big actions={
          <Button variant="ghost" size="icon" aria-label="Leave focus view" title="Return to dashboard" onClick={() => toggleFocus(false)}>
            <Minimize2 className="size-4" />
          </Button>
        } />
        <TerminalPanel output={term} cwd={prefs.workspace} onKill={() => bridge.terminal.kill()} onRun={(cmd) => void runInTerminal(cmd, 120)} outputOnly />
      </div>
    );
  }

  return (
    <div className="grid-dots flex min-h-screen flex-col bg-background lg:h-screen">
      {dialogs}
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
              {bot.practice ? "built-in surface coding · offline" : `${ai.provider === "ollama" ? "ollama" : "nvidia nim"} · ${ai.model}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-full border bg-muted px-3 py-1">
          {statusDot}
          <span className="font-mono text-[11px] uppercase tracking-wider">
            {STATUS_LABEL[bot.status]}
          </span>
        </div>

        <div className="ml-auto grid w-full grid-cols-[1fr_auto] items-center gap-3 sm:flex sm:w-auto sm:gap-4">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={fetchUpdates} disabled={updateBusy} title="Fetch and install updates from the published app">
              <RefreshCw className={updateBusy ? "animate-spin" : ""} />Fetch updates
            </Button>
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
              aria-label="Show only code and output"
              title="Code and output only"
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
            <Button variant="halt" size="xl" className="col-span-2 sm:col-auto" onClick={() => bot.stop()}>
              <Power /> Stop
            </Button>
          ) : (
            <Button variant="signal" size="xl" className="col-span-2 sm:col-auto" onClick={requestStart} disabled={updateBusy}>
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
          Optional AI setup: {setupMissing.join(" · ")} — surface coding is available now
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
      {!bot.running && canResume(openSession) && <div className="flex flex-wrap items-center justify-center gap-3 border-b bg-accent px-4 py-2 text-sm"><span>Previous session unfinished</span><Button size="sm" variant="signal" onClick={requestResume}><Play />Continue session</Button><Button size="sm" variant="ghost" onClick={dismissResume}>Dismiss</Button></div>}

      <div className="grid min-h-0 min-w-0 flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_400px]">
        <main className="grid min-h-0 min-w-0 gap-3 lg:grid-rows-[minmax(0,1fr)_260px]">
          <CodeSurface code={bot.surface} file={bot.currentFile} status={bot.status} />
          <TerminalPanel
            output={term}
            cwd={prefs.workspace}
            onKill={() => bridge.terminal.kill()}
            onRun={(cmd) => void runInTerminal(cmd, 120)}
          />
        </main>

        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
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
            {tab === "session" && (<div className="space-y-4">
              <KeepFiles checked={prefs.saveFiles} onChange={(saveFiles) => setPrefs({ ...prefs, saveFiles })} disabled={bot.running} />
              <SessionPanel
                session={session}
                setSession={setSession}
                workspace={prefs.workspace}
                setWorkspace={(workspace) => setPrefs({ ...prefs, workspace })}
                locked={bot.running}
                saveFiles={prefs.saveFiles}
                plan={bot.plan}
                onResetProject={async () => {
                  if (!prefs.workspace) return;
                  await archiveProject(bridge, prefs.workspace);
                  await bot.reloadPlan();
                }}
              /></div>
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
            {tab === "history" && <HistoryPanel records={history} openSession={bot.running ? null : openSession} onResume={requestResume} onDismiss={dismissResume} />}
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
                <Button variant="outline" className="w-full" disabled={bot.running} onClick={() => setOptimizeOpen(true)}>Optimize for this PC</Button>
                {optimizeStatus && <p role="status" className="text-xs text-muted-foreground">{optimizeStatus}</p>}
                <UpdateSection
                  info={update}
                  onFetch={fetchUpdates}
                  onApply={applyUpdate}
                  progress={updateProgress}
                  busy={updateBusy}
                  running={bot.running}
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
                    ? f.practice ? "surface only" : f.kept ? "saved" : "discarded"
                    : f.exitCode === 0
                      ? f.kept ? "ok · kept" : "ok · discarded"
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
