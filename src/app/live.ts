// Live output of code while it is being written: into VS Code via the add-on, or as real keystrokes.
import type { DesktopBridge } from "./bridge";
import { currentStreamingBlock } from "./project";

export type LiveMode = "off" | "addon" | "keyboard";

export interface LiveSink {
  /** Feed the full streamed reply so far. */
  onText(full: string): void;
  /** Called once per finished file, before it is written to disk. Waits for typing to catch up. */
  finish(rel: string, content: string): Promise<void>;
  /** True when the sink already opened the file in an editor. */
  opensEditor: boolean;
}

/** Editor settings that stop auto-indent, auto-closing brackets and suggestions from changing typed code. */
export const TYPING_SAFE_SETTINGS: Record<string, unknown> = {
  "editor.autoIndent": "none",
  "editor.autoClosingBrackets": "never",
  "editor.autoClosingQuotes": "never",
  "editor.autoClosingOvertype": "never",
  "editor.autoSurround": "never",
  "editor.formatOnType": false,
  "editor.formatOnPaste": false,
  "editor.acceptSuggestionOnEnter": "off",
  "editor.quickSuggestions": { other: false, comments: false, strings: false },
  "editor.suggestOnTriggerCharacters": false,
  "editor.wordBasedSuggestions": "off",
  "editor.inlineSuggest.enabled": false,
  "editor.parameterHints.enabled": false,
  "editor.tabCompletion": "off",
  "editor.insertSpaces": true,
  "editor.detectIndentation": false,
  "html.autoClosingTags": false,
  "javascript.autoClosingTags": false,
  "typescript.autoClosingTags": false,
  "github.copilot.enable": { "*": false },
};

export function mergeSettings(existing: string | null): string {
  let base: Record<string, unknown> = {};
  if (existing) {
    try {
      base = JSON.parse(existing) as Record<string, unknown>;
    } catch {
      base = {};
    }
  }
  return JSON.stringify({ ...base, ...TYPING_SAFE_SETTINGS }, null, 2) + "\n";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function baseName(rel: string) {
  return rel.split("/").pop() ?? rel;
}

/** Tracks the FILE block being streamed and emits only the newly arrived characters. */
function createDeltaTracker(onBegin: (rel: string) => void, onDelta: (text: string) => void) {
  let path: string | null = null;
  let sent = "";
  return (full: string) => {
    const b = currentStreamingBlock(full);
    if (!b) return;
    if (b.path !== path) {
      path = b.path;
      sent = "";
      onBegin(b.path);
    }
    if (b.code.length > sent.length && b.code.startsWith(sent)) {
      const d = b.code.slice(sent.length);
      sent = b.code;
      onDelta(d);
    }
  };
}

export function createAddonSink(bridge: DesktopBridge, root: string): LiveSink {
  const track = createDeltaTracker(
    (rel) => void bridge.ide.live.begin(root, rel).catch(() => {}),
    (d) => void bridge.ide.live.append(d).catch(() => {}),
  );
  return {
    opensEditor: true,
    onText: track,
    async finish(rel, content) {
      await bridge.ide.live.end(root, rel, content).catch(() => {});
    },
  };
}

export function createKeyboardSink(
  bridge: DesktopBridge,
  opts: { root: string; editor: string; cps: number; onNote: (msg: string) => void },
): LiveSink {
  let chain: Promise<unknown> = Promise.resolve();
  const blocked = new Set<string>();
  const begun = new Set<string>();
  let current = "";
  const enqueue = (fn: () => Promise<unknown>) => {
    chain = chain.then(fn).catch(() => {});
  };

  const track = createDeltaTracker(
    (rel) => {
      current = rel;
      begun.add(rel);
      enqueue(async () => {
        const abs = await bridge.fs.writeFile(opts.root, rel, "");
        await bridge.ide.open(opts.editor, opts.root, abs);
        await sleep(1800); // let the editor open and take focus
      });
    },
    (d) => {
      const rel = current;
      enqueue(async () => {
        if (blocked.has(rel)) return;
        const r = await bridge.keyboard.type(d, baseName(rel), opts.cps);
        if (r !== "ok") {
          blocked.add(rel);
          opts.onNote(
            r === "unsupported"
              ? "Real keyboard typing only works in the Windows app."
              : `Typing paused for ${baseName(rel)}: the editor window is not in front. The file is still saved.`,
          );
        }
      });
    },
  );

  return {
    opensEditor: true,
    onText: track,
    async finish(rel) {
      if (!begun.has(rel)) return;
      enqueue(async () => {
        if (!blocked.has(rel)) {
          await bridge.keyboard.save(baseName(rel));
          await sleep(500);
        }
      });
      await chain;
    },
  };
}
