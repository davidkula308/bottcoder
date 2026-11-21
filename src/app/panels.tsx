import { useEffect, useState } from "react";
import { AppWindow, CalendarClock, ExternalLink, FolderOpen, Plus, RefreshCw, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBridge, type IdeInfo, type RunningApp } from "./bridge";
import { Chip, Field, Segmented, SwitchRow, inputClass } from "./controls";
import { LANGUAGES, type AiConfig, type Schedule, type SessionConfig } from "./engine";
import type { LiveMode } from "./live";
import type { ProjectState } from "./project";
import { LiveTypingSection, ProjectSection, SetupHelper } from "./panels-extra";

const DURATIONS = [
  { value: "30", label: "30m" },
  { value: "60", label: "1h" },
  { value: "120", label: "2h" },
  { value: "300", label: "5h" },
  { value: "480", label: "8h" },
  { value: "unlimited", label: "∞" },
];

export function SessionPanel({
  session,
  setSession,
  workspace,
  setWorkspace,
  locked,
  plan,
  onResetProject,
}: {
  session: SessionConfig;
  setSession: (s: SessionConfig) => void;
  workspace: string;
  setWorkspace: (p: string) => void;
  locked: boolean;
  plan: ProjectState | null;
  onResetProject: () => void;
}) {
  const dur = session.durationMinutes === null ? "unlimited" : String(session.durationMinutes);
  const preset = DURATIONS.some((d) => d.value === dur) ? dur : "custom";
  return (
    <div className="space-y-5">
      <Field label="Workspace folder" hint="Every file the bot writes is saved inside this folder, and code runs only here.">
        <div className="flex gap-2">
          <div className={`${inputClass} truncate`}>{workspace || "not chosen"}</div>
          <Button
            variant="panel"
            size="sm"
            onClick={async () => {
              const p = await getBridge().fs.pickFolder();
              if (p) setWorkspace(p);
            }}
          >
            <FolderOpen /> Choose
          </Button>
        </div>
      </Field>

      <Field label="Coding time">
        <Segmented
          value={preset}
          options={DURATIONS}
          onChange={(v) => setSession({ ...session, durationMinutes: v === "unlimited" ? null : Number(v) })}
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Custom hours</span>
          <input
            type="number"
            min={0.25}
            step={0.25}
            disabled={session.durationMinutes === null}
            value={session.durationMinutes === null ? "" : session.durationMinutes / 60}
            onChange={(e) => setSession({ ...session, durationMinutes: Math.max(1, Math.round(Number(e.target.value) * 60)) })}
            className={`${inputClass} w-24`}
          />
        </div>
      </Field>

      <Field label="Style">
        <Segmented
          value={session.mode}
          options={[
            { value: "project", label: "Real project" },
            { value: "strategic", label: "Strategic" },
            { value: "random", label: "Random" },
          ]}
          onChange={(mode) => setSession({ ...session, mode })}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          {session.mode === "project"
            ? "Plans a real project, builds it across many files with tests, saves every working step with Git and continues where it left off next time."
            : session.mode === "strategic"
              ? "One file at a time toward your goal, fixing errors from each run."
              : "Fun stand-alone programs on random topics."}
        </p>
      </Field>

      {session.mode !== "random" && (
        <Field
          label="Project goal"
          hint={
            session.mode === "project"
              ? "Describe what to build. Used when a new project starts in this folder."
              : "The bot builds toward this, reading each run's output to fix errors before moving on."
          }
        >
          <textarea
            value={session.goal}
            onChange={(e) => setSession({ ...session, goal: e.target.value })}
            rows={3}
            className={`${inputClass} resize-none leading-5`}
          />
        </Field>
      )}

      {session.mode === "project" && (
        <ProjectSection session={session} setSession={setSession} plan={plan} onReset={onResetProject} locked={locked} />
      )}

      {session.mode !== "project" && (
      <Field label="Languages">
        <div className="flex flex-wrap gap-1.5">
          {LANGUAGES.map((l) => {
            const on = session.languages.includes(l.id);
            return (
              <Chip
                key={l.id}
                active={on}
                onClick={() =>
                  setSession({
                    ...session,
                    languages: on ? session.languages.filter((x) => x !== l.id) : [...session.languages, l.id],
                  })
                }
              >
                {l.label}
              </Chip>
            );
          })}
        </div>
      </Field>
      )}

      <SwitchRow
        label={session.mode === "project" ? "Run tests automatically" : "Run each file automatically"}
        hint="Runs the new file in the terminal and feeds errors back to the bot."
        checked={session.autoRun}
        onChange={(autoRun) => setSession({ ...session, autoRun })}
      />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Pause between files (s)">
          <input
            type="number"
            min={0}
            value={session.pauseSeconds}
            onChange={(e) => setSession({ ...session, pauseSeconds: Math.max(0, Number(e.target.value)) })}
            className={inputClass}
          />
        </Field>
        <Field label="Run time limit (s)">
          <input
            type="number"
            min={5}
            value={session.runTimeoutSeconds}
            onChange={(e) => setSession({ ...session, runTimeoutSeconds: Math.max(5, Number(e.target.value)) })}
            className={inputClass}
          />
        </Field>
      </div>
      {locked && <p className="label-caps text-warn">changes apply from the next file</p>}
    </div>
  );
}

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function SchedulePanel({
  schedules,
  setSchedules,
}: {
  schedules: Schedule[];
  setSchedules: (s: Schedule[]) => void;
}) {
  const [draft, setDraft] = useState<Omit<Schedule, "id">>({
    name: "",
    kind: "app",
    target: "",
    time: "09:00",
    days: [],
    enabled: true,
  });

  const add = () => {
    if (draft.kind !== "session" && !draft.target.trim()) return;
    setSchedules([
      ...schedules,
      { ...draft, id: crypto.randomUUID(), name: draft.name || (draft.kind === "session" ? "Coding session" : draft.target) },
    ]);
    setDraft({ ...draft, name: "", target: "" });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-md border bg-muted/40 p-3">
        <div className="label-caps flex items-center gap-2">
          <CalendarClock className="size-3.5" /> new schedule
        </div>
        <Segmented
          value={draft.kind}
          options={[
            { value: "app", label: "Open app" },
            { value: "command", label: "Command" },
            { value: "session", label: "Start coding" },
          ]}
          onChange={(kind) => setDraft({ ...draft, kind })}
        />
        <input
          placeholder="Name (optional)"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className={inputClass}
        />
        {draft.kind !== "session" && (
          <div className="flex gap-2">
            <input
              placeholder={draft.kind === "app" ? "C:\\Program Files\\...\\app.exe" : "e.g. git pull && npm test"}
              value={draft.target}
              onChange={(e) => setDraft({ ...draft, target: e.target.value })}
              className={inputClass}
            />
            {draft.kind === "app" && (
              <Button
                variant="panel"
                size="sm"
                onClick={async () => {
                  const p = await getBridge().system.pickApp();
                  if (p) setDraft({ ...draft, target: p });
                }}
              >
                Browse
              </Button>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="time"
            value={draft.time}
            onChange={(e) => setDraft({ ...draft, time: e.target.value })}
            className={`${inputClass} w-28`}
          />
          {DAY_LABELS.map((d, i) => (
            <Chip
              key={d}
              active={draft.days.includes(i)}
              onClick={() =>
                setDraft({ ...draft, days: draft.days.includes(i) ? draft.days.filter((x) => x !== i) : [...draft.days, i] })
              }
            >
              {d}
            </Chip>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">No days selected = every day.</p>
        <Button variant="signal" size="sm" className="w-full" onClick={add}>
          <Plus /> Add schedule
        </Button>
      </div>

      <div className="space-y-2">
        {schedules.length === 0 && <p className="text-sm text-muted-foreground">No schedules yet.</p>}
        {schedules.map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-md border bg-card p-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{s.name}</div>
              <div className="truncate font-mono text-[11px] text-muted-foreground">
                {s.time} · {s.days.length ? s.days.map((d) => DAY_LABELS[d]).join(" ") : "daily"} · {s.kind}
              </div>
            </div>
            <Chip active={s.enabled} onClick={() => setSchedules(schedules.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)))}>
              {s.enabled ? "on" : "off"}
            </Chip>
            <button
              aria-label="Delete schedule"
              onClick={() => setSchedules(schedules.filter((x) => x.id !== s.id))}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AppsPanel() {
  const [apps, setApps] = useState<RunningApp[]>([]);
  const [loading, setLoading] = useState(false);
  const refresh = async () => {
    setLoading(true);
    try {
      setApps(await getBridge().system.listApps());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="label-caps">{apps.length} open apps · refreshes every 10s</span>
        <Button variant="ghost" size="sm" onClick={refresh}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
        </Button>
      </div>
      {apps.map((a) => (
        <div key={a.pid} className="flex items-start gap-3 rounded-md border bg-card p-3">
          <AppWindow className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{a.title || a.name}</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              {a.name} · pid {a.pid} · {a.memory}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function IdePanel({
  workspace,
  followIde,
  setFollowIde,
  liveMode,
  setLiveMode,
  typingCps,
  setTypingCps,
}: {
  workspace: string;
  followIde: string | null;
  setFollowIde: (id: string | null) => void;
  liveMode: LiveMode;
  setLiveMode: (m: LiveMode) => void;
  typingCps: number;
  setTypingCps: (n: number) => void;
}) {
  const [ides, setIdes] = useState<IdeInfo[]>([]);
  const [note, setNote] = useState("");
  useEffect(() => {
    getBridge().ide.detect().then(setIdes);
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Link a coding environment. With mirroring on, every new file opens there the moment it is written.
      </p>
      <LiveTypingSection
        mode={liveMode}
        setMode={setLiveMode}
        cps={typingCps}
        setCps={setTypingCps}
        ides={ides}
        followIde={followIde}
        workspace={workspace}
      />
      {ides.map((ide) => (
        <div key={ide.id} className="flex items-center gap-3 rounded-md border bg-card p-3">
          <span className={`size-2 rounded-full ${ide.available ? "bg-signal" : "bg-muted-foreground/40"}`} />
          <div className="flex-1">
            <div className="text-sm">{ide.name}</div>
            <div className="font-mono text-[11px] text-muted-foreground">{ide.available ? "found" : "not found"}</div>
          </div>
          {ide.available && (
            <>
              <Chip active={followIde === ide.id} onClick={() => setFollowIde(followIde === ide.id ? null : ide.id)}>
                mirror
              </Chip>
              <Button
                variant="panel"
                size="sm"
                disabled={!workspace}
                onClick={async () => setNote(await getBridge().ide.open(ide.id, workspace))}
              >
                <ExternalLink /> Open
              </Button>
            </>
          )}
        </div>
      ))}
      {note && <p className="font-mono text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

export function SetupPanel({
  ai,
  setAi,
  autoStart,
  setAutoStart,
  runInTerminal,
}: {
  ai: AiConfig;
  setAi: (a: AiConfig) => void;
  autoStart: boolean;
  setAutoStart: (v: boolean) => void;
  runInTerminal: (cmd: string, timeoutSec: number) => Promise<number | null>;
}) {
  const bridge = getBridge();
  const [models, setModels] = useState<string[]>([]);
  const [conn, setConn] = useState("");
  const [boot, setBoot] = useState(false);
  const [shortcutNote, setShortcutNote] = useState("");

  useEffect(() => {
    bridge.system.getStartup().then(setBoot);
  }, [bridge]);

  const check = async () => {
    setConn("checking…");
    try {
      const list = await bridge.ai.listModels({ provider: ai.provider, ollamaUrl: ai.ollamaUrl, nimKey: ai.nimKey });
      setModels(list);
      setConn(list.length ? `connected · ${list.length} models` : "connected, but no models installed");
    } catch (e) {
      setConn(`not reachable: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-5">
      <SetupHelper ai={ai} setAi={setAi} runInTerminal={runInTerminal} />
      <Field label="AI engine">
        <Segmented
          value={ai.provider}
          options={[
            { value: "ollama", label: "Ollama · offline" },
            { value: "nim", label: "NVIDIA NIM · online" },
          ]}
          onChange={(provider) =>
            setAi({ ...ai, provider, model: provider === "nim" ? "qwen/qwen2.5-coder-32b-instruct" : "qwen2.5-coder:1.5b" })
          }
        />
      </Field>

      {ai.provider === "ollama" ? (
        <Field
          label="Ollama address"
          hint={
            <>
              Leave this as it is. Use the setup helper above to install Ollama and download{" "}
              <code className="text-primary">{ai.model}</code>; after that the AI runs on your processor with no
              graphics card and no internet.
            </>
          }
        >
          <input value={ai.ollamaUrl} onChange={(e) => setAi({ ...ai, ollamaUrl: e.target.value })} className={inputClass} />
        </Field>
      ) : (
        <Field label="NVIDIA API key" hint="Runs on NVIDIA's cloud GPUs — much faster on PCs without a graphics card. Needs internet and a free key from build.nvidia.com. Stored only on this PC.">
          <input
            type="password"
            value={ai.nimKey}
            onChange={(e) => setAi({ ...ai, nimKey: e.target.value })}
            placeholder="nvapi-…"
            className={inputClass}
          />
        </Field>
      )}

      <Field label="Model">
        <input value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} className={inputClass} />
        {models.length > 0 && (
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-auto">
            {models.map((m) => (
              <Chip key={m} active={ai.model === m} onClick={() => setAi({ ...ai, model: m })}>
                {m}
              </Chip>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3">
          <Button variant="panel" size="sm" onClick={check}>
            <Zap /> Check connection
          </Button>
          <span className="font-mono text-[11px] text-muted-foreground">{conn}</span>
        </div>
      </Field>

      <div className="space-y-2">
        <div className="label-caps">Startup</div>
        <SwitchRow
          label="Start with Windows"
          hint="Opens quietly in the system tray when you turn on your PC. The screen stays on while a session runs."
          checked={boot}
          onChange={async (v) => setBoot(await bridge.system.setStartup(v))}
        />
        <SwitchRow
          label="Start coding on launch"
          hint="Begins a session automatically using your saved settings."
          checked={autoStart}
          onChange={setAutoStart}
        />
        <Button variant="panel" size="sm" className="w-full" onClick={async () => setShortcutNote(await bridge.system.createShortcuts())}>
          Add to Start Menu & Desktop
        </Button>
        <p className="text-xs text-muted-foreground">
          {shortcutNote || "Then open Start, right-click NightShift Coder and choose “Pin to Start”."}
        </p>
      </div>
    </div>
  );
}
