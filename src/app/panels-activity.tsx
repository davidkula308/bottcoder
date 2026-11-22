// "During coding" activity apps + in-app updates panels.
import { useEffect, useMemo, useState } from "react";
import { Activity, Download, Play, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBridge, type LaunchableApp } from "./bridge";
import { Chip, Field, SwitchRow, inputClass } from "./controls";
import {
  ACTIVITY_PRESETS,
  clampActivity,
  msUntilNextActivity,
  type ActivityConfig,
} from "./activity";
import { formatClock } from "./engine";
import { PUBLISHED_APP_URL, type UpdateInfo } from "./update";

const SOURCE_LABEL: Record<LaunchableApp["source"], string> = {
  light: "light · built into Windows",
  open: "open now",
  installed: "installed",
};

export function ActivitySection({
  activity,
  setActivity,
  elapsedMs,
  done,
}: {
  activity: ActivityConfig;
  setActivity: (a: ActivityConfig) => void;
  /** null when no session is running */
  elapsedMs: number | null;
  done: number;
}) {
  const bridge = getBridge();
  const [list, setList] = useState<LaunchableApp[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const custom = !ACTIVITY_PRESETS.includes(
    activity.everyMinutes as (typeof ACTIVITY_PRESETS)[number],
  );
  const set = (patch: Partial<ActivityConfig>) =>
    setActivity(clampActivity({ ...activity, ...patch }));

  const load = async () => {
    setLoading(true);
    try {
      setList(await bridge.system.listLaunchable());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chosen = new Set(activity.apps.map((a) => a.path.toLowerCase()));
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list ?? [])
      .filter((a) => !q || a.name.toLowerCase().includes(q) || a.path.toLowerCase().includes(q))
      .slice(0, 60);
  }, [list, query]);

  const toggle = (a: LaunchableApp) =>
    set({
      apps: chosen.has(a.path.toLowerCase())
        ? activity.apps.filter((x) => x.path.toLowerCase() !== a.path.toLowerCase())
        : [...activity.apps, { name: a.name, path: a.path }],
    });

  return (
    <div className="space-y-3 rounded-md border bg-muted/40 p-3">
      <div className="label-caps flex items-center gap-2">
        <Activity className="size-3.5" /> during coding
      </div>
      <SwitchRow
        label="Open an app now and then, then close it"
        hint="Reads the running session's time. Picks one of your chosen apps at random, opens it, and closes only that window again."
        checked={activity.enabled}
        onChange={(enabled) => set({ enabled })}
      />

      <Field label="Open an app every">
        <div className="flex flex-wrap items-center gap-1.5">
          {ACTIVITY_PRESETS.map((m) => (
            <Chip
              key={m}
              active={activity.everyMinutes === m}
              onClick={() => set({ everyMinutes: m })}
            >
              {m} min
            </Chip>
          ))}
          <Chip active={custom} onClick={() => !custom && set({ everyMinutes: 15 })}>
            custom
          </Chip>
          {custom && (
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                value={activity.everyMinutes}
                onChange={(e) => set({ everyMinutes: Number(e.target.value) })}
                className={`${inputClass} w-20`}
                aria-label="Minutes between apps"
              />
              <span className="text-xs text-muted-foreground">min</span>
            </span>
          )}
        </div>
      </Field>

      <Field label={`Keep it open for · ${activity.openSeconds} seconds`}>
        <input
          type="range"
          min={5}
          max={120}
          step={5}
          value={activity.openSeconds}
          onChange={(e) => set({ openSeconds: Number(e.target.value) })}
          className="w-full accent-primary"
        />
      </Field>

      <SwitchRow
        label="Open minimized"
        hint="Use this with live typing, so the app doesn't take the keyboard away from the editor."
        checked={activity.minimized}
        onChange={(minimized) => set({ minimized })}
      />

      {elapsedMs !== null && activity.enabled && activity.apps.length > 0 && (
        <p className="font-mono text-[11px] text-primary">
          next app in {formatClock(msUntilNextActivity(elapsedMs, activity.everyMinutes, done))} ·{" "}
          {done} opened this session
        </p>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="label-caps">your apps · {activity.apps.length} chosen</span>
          <Button variant="ghost" size="sm" onClick={load} aria-label="Refresh app list">
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
        {activity.apps.length === 0 && (
          <p className="text-xs text-warn">
            Pick at least one app below. Light ones like Notepad open fastest.
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {activity.apps.map((a) => (
            <span
              key={a.path}
              className="flex items-center gap-1 rounded border border-primary bg-primary/15 px-2 py-1 font-mono text-[11px] text-primary"
            >
              {a.name}
              <button
                aria-label={`Remove ${a.name}`}
                onClick={() => set({ apps: activity.apps.filter((x) => x.path !== a.path) })}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
        {activity.apps.length > 0 && (
          <Button
            variant="panel"
            size="sm"
            onClick={async () => {
              const a = activity.apps[Math.floor(Math.random() * activity.apps.length)];
              if (!a) return;
              setNote(`Opening ${a.name} for ${activity.openSeconds}s…`);
              setNote(await bridge.system.blink(a.path, activity.openSeconds, activity.minimized));
            }}
          >
            <Play /> Test now
          </Button>
        )}
        {note && <p className="font-mono text-[11px] text-muted-foreground">{note}</p>}

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <input
            placeholder="Search apps on this PC"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`${inputClass} pl-8`}
          />
        </div>
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {list === null && <p className="text-xs text-muted-foreground">Looking for apps…</p>}
          {list !== null && shown.length === 0 && (
            <p className="text-xs text-muted-foreground">No apps found.</p>
          )}
          {shown.map((a) => (
            <button
              key={a.path}
              onClick={() => toggle(a)}
              className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors ${
                chosen.has(a.path.toLowerCase())
                  ? "border-primary bg-primary/10"
                  : "bg-card hover:border-primary/50"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">{a.name}</span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">
                  {SOURCE_LABEL[a.source]}
                </span>
              </span>
              <span className="font-mono text-[10px] text-primary">
                {chosen.has(a.path.toLowerCase()) ? "✓ chosen" : "add"}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function UpdateSection({
  info,
  onFetch,
  onApply,
  progress,
  autoUpdate,
  setAutoUpdate,
  busy,
  running,
}: {
  info: UpdateInfo | null;
  onFetch: () => void;
  onApply: () => void;
  progress: string | null;
  autoUpdate: boolean;
  setAutoUpdate: (v: boolean) => void;
  busy: boolean;
  running: boolean;
}) {
  const desktop = getBridge().isDesktop;
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <span className="label-caps">updates</span>
        <Button variant="signal" size="sm" onClick={onFetch} disabled={busy}>
          <RefreshCw className={busy ? "animate-spin" : ""} /> {busy ? "Fetching…" : "Fetch updates"}
        </Button>
      </div>
      <a href={PUBLISHED_APP_URL} target="_blank" rel="noreferrer" className="block break-all font-mono text-[11px] text-primary underline underline-offset-4">{PUBLISHED_APP_URL}</a>
      <div className="font-mono text-[11px] text-muted-foreground">
        {info ? `this version ${info.current}` : "checking…"}
        {info?.latest && ` · newest ${info.latest}`}
        {info?.error && ` · couldn't check (${info.error})`}
      </div>
      {info?.available && (
        <div className="space-y-2 rounded border bg-card p-2 text-xs">
          <div>
            Version <span className="font-mono text-primary">{info.latest}</span> is ready.
          </div>
          {info.notes && <div className="text-muted-foreground">{info.notes}</div>}
          <Button variant="signal" size="sm" disabled={busy || !desktop} onClick={onApply}>
            <Download /> {running ? "Install when coding stops" : "Update and restart"}
          </Button>
        </div>
      )}
      {progress && <p role="status" className="break-words font-mono text-[11px] text-primary">{progress}</p>}
      <SwitchRow
        label="Update automatically"
        hint="Downloads new versions by itself and restarts only when no coding session is running. No installer needed."
        checked={autoUpdate}
        onChange={setAutoUpdate}
      />
    </div>
  );
}
