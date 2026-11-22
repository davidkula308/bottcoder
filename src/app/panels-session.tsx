import { Code2, Gauge, History, Monitor, Play, Settings2, Sparkles } from "lucide-react";
import type { WriteTarget } from "./live";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { SPEEDS, type SpeedSetting } from "./pacer";
import { canResume, resumeLeftMs, totalCodingMs, type OpenSession, type SessionRecord } from "./history";
import { formatClock } from "./engine";
import type { OptimizePlan } from "./optimize";

export function KeepFiles({ checked, onChange, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <div className="flex items-center justify-between gap-4 border-t pt-3">
    <label htmlFor="keep-files" className="text-sm">Keep code files</label>
    <Switch id="keep-files" checked={checked} onCheckedChange={onChange} disabled={disabled} />
  </div>;
}

export function VsCodeNotice({ project, file, status }: { project: { name: string; folder: string; connected: string | null }; file: string | null; status: string }) {
  return <section className="flex min-h-[260px] min-w-0 flex-col items-center justify-center gap-3 rounded-lg border bg-card p-6 text-center">
    <Code2 className="size-10 text-primary" />
    <h2 className="text-lg">Writing in {project.connected}</h2>
    <p className="text-sm">Project <span className="font-mono text-primary">{project.name}</span></p>
    <p className="max-w-full break-all font-mono text-xs text-muted-foreground">{project.folder}</p>
    <p className="font-mono text-xs text-muted-foreground">{status}{file ? ` · ${file}` : ""}</p>
  </section>;
}

export function SpeedDialog({ open, onOpenChange, speed, setSpeed, keep, setKeep, onStart, resuming, target, setTarget, projectName, setProjectName }: {
  open: boolean; onOpenChange: (v: boolean) => void; speed: SpeedSetting; setSpeed: (s: SpeedSetting) => void;
  keep: boolean; setKeep: (v: boolean) => void; onStart: () => void; resuming: boolean;
  target: WriteTarget; setTarget: (t: WriteTarget) => void; projectName: string; setProjectName: (v: string) => void;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
    <DialogHeader><DialogTitle className="flex items-center gap-2"><Gauge className="size-5 text-primary" />Coding speed</DialogTitle>
      <DialogDescription>{resuming ? "Continue your previous session." : "Choose the pace for this session."}</DialogDescription></DialogHeader>
    <div className="grid grid-cols-2 gap-2">
      {[...SPEEDS, { id: "custom" as const, label: "Custom", cps: 0 }].map((s) => <Button key={s.id} variant="outline" aria-pressed={speed.id === s.id}
        className={cn("h-auto min-h-16 whitespace-normal flex-col items-start text-left", speed.id === s.id && "border-primary bg-primary/10 text-primary")}
        onClick={() => setSpeed({ ...speed, id: s.id })}>
        <span>{s.label}</span><span className="font-mono text-[11px] text-muted-foreground">{s.id === "human" ? "~40 words/min" : s.id === "typist" ? "~80 words/min" : s.id === "instant" ? "Previous speed" : s.id === "custom" ? "1–200 characters/sec" : "25 characters/sec"}</span>
      </Button>)}
    </div>
    {speed.id === "custom" && <div className="space-y-2"><label htmlFor="custom-speed" className="text-sm">Characters per second</label>
      <Input id="custom-speed" type="number" min={1} max={200} value={speed.customCps} onChange={(e) => setSpeed({ ...speed, customCps: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })} /></div>}
    <div className="space-y-2 border-t pt-3"><p className="text-sm">Where should the code be written?</p>
      <div className="grid grid-cols-2 gap-2">
        {([["app", "NightShift", Monitor], ["vscode", "VS Code", Code2]] as const).map(([id, label, Icon]) => <Button key={id} variant="outline" aria-pressed={target === id}
          className={cn("h-auto min-h-12", target === id && "border-primary bg-primary/10 text-primary")} onClick={() => setTarget(id)}><Icon />{label}</Button>)}
      </div>
      {target === "vscode" && <div className="space-y-1"><label htmlFor="vs-project" className="text-sm">Project name in VS Code</label>
        <Input id="vs-project" placeholder="e.g. Night session 1" value={projectName} onChange={(e) => setProjectName(e.target.value)} maxLength={60} />
        <p className="text-xs text-muted-foreground">Opens a new folder with this name in VS Code, types every file there and shows commands in its NightShift terminal. Kept in Documents\NightShift\Sessions.</p></div>}
    </div>
    {target === "app" && <KeepFiles checked={keep} onChange={setKeep} />}
    {target === "app" && <p className="text-xs text-muted-foreground">{keep ? "AI code stays in your workspace. Practice code is shown only." : "AI code is tested in a temporary folder, then discarded. Practice code stays on screen only."}</p>}
    <Button variant="signal" onClick={onStart}><Play />{resuming ? "Continue coding" : "Start session"}</Button>
  </DialogContent></Dialog>;
}

export function OptimizeDialog({ open, onOpenChange, plan, status, busy, downloads, setDownloads, onOptimize }: {
  open: boolean; onOpenChange: (v: boolean) => void; plan: OptimizePlan | null; status: string; busy: boolean;
  downloads: boolean; setDownloads: (v: boolean) => void; onOptimize: () => void;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
    <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="size-5 text-primary" />Optimize for this PC</DialogTitle>
      <DialogDescription>Recommended settings for your processor, memory, and available coding apps.</DialogDescription></DialogHeader>
    {plan && <ul className="space-y-3 text-sm">{plan.steps.filter((s) => !s.startsWith("Download and install") && !s.startsWith("Download the AI")).map((s) => <li key={s} className="flex gap-2"><Settings2 className="mt-0.5 size-4 shrink-0 text-primary" /><span>{s}</span></li>)}</ul>}
    {plan && (plan.installOllama || plan.downloadModel) && <div className="flex items-center justify-between gap-4 border-t pt-3"><label htmlFor="opt-downloads" className="text-sm">Install offline AI + model ({plan.modelSize})<span className="block text-xs text-muted-foreground">Internet required once. Optional for surface coding.</span></label><Switch id="opt-downloads" checked={downloads} onCheckedChange={setDownloads} disabled={busy} /></div>}
    {status && <p role="status" className="break-words text-sm text-muted-foreground">{status}</p>}
    <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>{busy ? "Keep coding meanwhile" : "Not now"}</Button>
      <Button variant="signal" onClick={onOptimize} disabled={!plan || busy}><Sparkles />{busy ? "Optimizing…" : "Apply optimized settings"}</Button></div>
  </DialogContent></Dialog>;
}

export function HistoryPanel({ records, openSession, onResume, onDismiss }: { records: SessionRecord[]; openSession: OpenSession | null; onResume: () => void; onDismiss: () => void }) {
  const left = openSession ? resumeLeftMs(openSession) : 0;
  return <div className="space-y-4"><div className="flex items-center gap-2 text-sm"><History className="size-4 text-primary" />Previous sessions<span className="ml-auto font-mono text-xs text-muted-foreground">{formatClock(totalCodingMs(records))}</span></div>
    {canResume(openSession) && <div className="space-y-2 border-b pb-4"><p className="text-sm">Unfinished session · {left === null ? "unlimited" : `${formatClock(left)} left`}</p><div className="flex gap-2"><Button size="sm" variant="signal" onClick={onResume}><Play />Continue</Button><Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button></div></div>}
    {!records.length && <p className="text-sm text-muted-foreground">No completed sessions yet.</p>}
    {records.map((r) => <article key={r.id} className="space-y-1 border-b pb-3"><div className="flex flex-wrap justify-between gap-2 text-sm"><time>{new Date(r.startedAt).toLocaleString()}</time><span className="font-mono text-primary">{formatClock(Math.max(0, r.endedAt - r.startedAt))}</span></div><p className="text-xs text-muted-foreground">{r.mode} · {r.engine} · {r.files} programs · {r.lines} lines</p><p className="text-xs">{r.kept ? "AI files kept" : "Files discarded"} · {r.reason}</p></article>)}
  </div>;
}