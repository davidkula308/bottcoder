import { useEffect, useRef, useState } from "react";
import { TerminalSquare, CornerDownLeft, Square } from "lucide-react";
import type { BotStatus } from "./use-coding-session";
import { tokenize, type TokenKind } from "./highlight";

const TOKEN_CLASS: Record<TokenKind, string> = {
  kw: "text-syn-kw font-semibold",
  str: "text-syn-str",
  com: "text-syn-com italic",
  num: "text-syn-num",
  fn: "text-syn-fn",
  plain: "text-syn-plain",
};

export function CodeSurface({
  code,
  file,
  status,
  big = false,
}: {
  code: string;
  file: { name: string; language: string } | null;
  status: BotStatus;
  big?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [code]);
  const lines = code ? code.replace(/\n$/, "").split("\n") : [];
  const typing = status === "writing" || status === "thinking";

  return (
    <section className={`flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface ${big ? "flex-1" : "rounded-lg border"}`}>
      <header className={`flex items-center gap-3 border-b bg-card ${big ? "px-6" : "px-3"}`}>
        <div className="-mb-px flex min-w-0 items-center gap-2 border-b-2 border-primary py-2 font-mono text-xs text-foreground">
          <span className="size-2 rounded-full bg-signal" />
          <span className="truncate">{file?.name ?? "waiting-for-next-file"}</span>
        </div>
        <span className="label-caps ml-auto">{file?.language ?? "—"}</span>
      </header>
      <div ref={ref} className={`scanlines min-w-0 flex-1 overflow-auto py-3 font-mono ${big ? "min-h-0 text-[15px] leading-7" : "min-h-[240px] text-[13px] leading-6 lg:min-h-0"}`}>
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <span className="font-mono text-sm">
              {status === "thinking" ? "thinking" : "idle"}
              <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-caret bg-primary" />
            </span>
            <span className="label-caps">code appears here as it is written</span>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i}>
                  <td className="w-12 select-none pr-4 text-right align-top text-gutter">{i + 1}</td>
                  <td className="whitespace-pre pr-6 text-syn-plain">
                    {line
                      ? tokenize(line, file?.language ?? "").map((t, j) => (
                          <span key={j} className={TOKEN_CLASS[t.k]}>
                            {t.v}
                          </span>
                        ))
                      : " "}
                    {typing && i === lines.length - 1 && (
                      <span className="ml-px inline-block h-4 w-2 translate-y-0.5 animate-caret bg-primary" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export function TerminalPanel({
  output,
  onRun,
  onKill,
  cwd,
}: {
  output: string;
  onRun: (cmd: string) => void;
  onKill: () => void;
  cwd: string;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const [cmd, setCmd] = useState("");
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-terminal">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <TerminalSquare className="size-4 text-primary" />
        <span className="label-caps">terminal</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{cwd}</span>
        <button
          onClick={onKill}
          className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-destructive"
        >
          <Square className="size-3" /> kill
        </button>
      </header>
      <pre
        ref={ref}
        className="min-h-[160px] flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[12px] leading-5 text-terminal-foreground"
      >
        {output || "Terminal connected. Output from every run lands here.\n"}
      </pre>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!cmd.trim()) return;
          onRun(cmd);
          setCmd("");
        }}
        className="flex items-center gap-2 border-t px-3 py-1.5"
      >
        <span className="font-mono text-sm text-primary">&gt;</span>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder="type a command, e.g. python --version"
          className="flex-1 bg-transparent font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        <CornerDownLeft className="size-3.5 text-muted-foreground" />
      </form>
    </section>
  );
}
