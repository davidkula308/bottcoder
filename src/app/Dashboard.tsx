import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, FileCode2, Play, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getBridge } from "./bridge";
import { CodeSurface, TerminalPanel } from "./surfaces";
import { AppsPanel, IdePanel, SchedulePanel, SessionPanel, SetupPanel } from "./panels";
import { useStored } from "./use-stored";
import { useCodingSession, type BotStatus } from "./use-coding-session";
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
  });
  const [schedules, setSchedules] = useStored<Schedule[]>("schedules", []);
  const [tab, setTab] = useState<TabId>("session");
  const [term, setTerm] = useState("");

  const appendTerm = useCallback((t: string) => setTerm((s) => (s + t).slice(-40_000)), []);

  const bot = useCodingSession({
    session,
    ai,
    workspace: prefs.workspace,
    followIde: prefs.followIde,
    onTerminal: appendTerm,
  });

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
      setSchedules((list) => list.map((s) => (due.some((d) => d.id === s.id) ? { ...s, lastRunKey: key } : s)));
    };
    const t = setInterval(tick, 20_000);
    tick();
    return () => clearInterval(t);
  }, [appendTerm, setSchedules]);

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

  return (
    <div className="grid-dots flex min-h-screen flex-col bg-background lg:h-screen">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b bg-card/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground shadow-glow">
            <Cpu className="size-4" />
          </div>
          <div>
            <h1 className="font-display text-base font-bold leading-none tracking-tight">NightShift Coder</h1>
            <p className="label-caps mt-1">
              {ai.provider === "ollama" ? "ollama" : "nvidia nim"} · {ai.model}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-full border bg-muted px-3 py-1">
          <span
            className={cn(
              "size-2 rounded-full",
              bot.status === "error" ? "bg-destructive" : active ? "animate-pulse-signal bg-signal" : "bg-muted-foreground",
            )}
          />
          <span className="font-mono text-[11px] uppercase tracking-wider">{STATUS_LABEL[bot.status]}</span>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <div className="text-right">
            <div className="label-caps">{bot.running ? (left === null ? "elapsed" : "time left") : "session length"}</div>
            <div className="font-mono text-2xl font-semibold tabular-nums text-primary">{clock}</div>
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

      {!bridge.isDesktop && (
        <div className="border-b bg-accent px-4 py-1.5 text-center font-mono text-[11px] text-accent-foreground">
          Preview mode — the AI, terminal and app launching are simulated here. Install the Windows app for the real thing.
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_400px]">
        <main className="grid min-h-0 gap-3 lg:grid-rows-[minmax(0,1fr)_260px]">
          <CodeSurface code={bot.surface} file={bot.currentFile} status={bot.status} />
          <TerminalPanel
            output={term}
            cwd={prefs.workspace}
            onKill={() => bridge.terminal.kill()}
            onRun={async (cmd) => {
              appendTerm(`\n$ ${cmd}\n`);
              const code = await bridge.terminal.run(cmd, prefs.workspace, 120, appendTerm);
              appendTerm(`[exit ${code ?? "timeout"}]\n`);
            }}
          />
        </main>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="border-b px-4 py-3">
            <p className="font-mono text-xs text-foreground">{bot.message}</p>
            <div className="mt-2 flex gap-4 font-mono text-[11px] text-muted-foreground">
              <span>file #{bot.iteration}</span>
              <span>{bot.files.length} written</span>
              <span>{session.mode}</span>
            </div>
          </div>
          <nav className="flex overflow-x-auto border-b">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "-mb-px shrink-0 border-b-2 px-3 py-2.5 font-mono text-[11px] uppercase tracking-wider transition-colors",
                  tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
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
              />
            )}
            {tab === "schedule" && <SchedulePanel schedules={schedules} setSchedules={setSchedules} />}
            {tab === "apps" && <AppsPanel />}
            {tab === "ide" && (
              <IdePanel
                workspace={prefs.workspace}
                followIde={prefs.followIde}
                setFollowIde={(followIde) => setPrefs({ ...prefs, followIde })}
              />
            )}
            {tab === "setup" && (
              <SetupPanel ai={ai} setAi={setAi} autoStart={prefs.autoStart} setAutoStart={(autoStart) => setPrefs({ ...prefs, autoStart })} />
            )}
          </div>
          <div className="max-h-40 overflow-y-auto border-t px-4 py-3">
            <div className="label-caps mb-2">recent files</div>
            {bot.files.length === 0 && <p className="text-xs text-muted-foreground">Nothing written yet.</p>}
            {bot.files.slice(0, 20).map((f) => (
              <div key={f.at} className="flex items-center gap-2 py-0.5 font-mono text-[11px]">
                <FileCode2 className="size-3 text-primary" />
                <span className="flex-1 truncate">{f.filename}</span>
                <span
                  className={cn(
                    f.exitCode === 0 ? "text-primary" : f.exitCode === undefined ? "text-muted-foreground" : "text-warn",
                  )}
                >
                  {f.exitCode === undefined ? "saved" : f.exitCode === 0 ? "ok" : `exit ${f.exitCode ?? "timeout"}`}
                </span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
