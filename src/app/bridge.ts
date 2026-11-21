// Contract between the UI and the desktop shell (electron/preload.cjs).
// In the browser preview a simulated bridge is used so the UI can be tried safely.
import type { Provider } from "./engine";
import type { FileEntry } from "./project";
import type { SetupReport } from "./setup";

export interface GenerateRequest {
  provider: Provider;
  model: string;
  system: string;
  prompt: string;
  ollamaUrl: string;
  nimKey: string;
}

export interface PullProgress {
  status: string;
  percent: number | null;
}

export interface RunningApp {
  pid: number;
  name: string;
  title: string;
  memory: string;
}

export interface IdeInfo {
  id: string;
  name: string;
  available: boolean;
}

export interface DesktopBridge {
  isDesktop: boolean;
  platform: string;
  launchedAtStartup: boolean;
  ai: {
    generate(req: GenerateRequest, onChunk: (text: string) => void): Promise<string>;
    cancel(): Promise<void>;
    listModels(req: { provider: Provider; ollamaUrl: string; nimKey: string }): Promise<string[]>;
    pull(req: { ollamaUrl: string; model: string }, onProgress: (p: PullProgress) => void): Promise<void>;
  };
  fs: {
    pickFolder(): Promise<string | null>;
    writeFile(root: string, rel: string, content: string): Promise<string>;
    openFolder(path: string): Promise<void>;
    list(root: string): Promise<FileEntry[]>;
    read(root: string, rel: string): Promise<string | null>;
    exists(root: string, rel: string): Promise<boolean>;
    remove(root: string, rel: string): Promise<void>;
  };
  terminal: {
    run(cmd: string, cwd: string, timeoutSec: number, onData: (text: string) => void): Promise<number | null>;
    kill(): Promise<void>;
  };
  system: {
    listApps(): Promise<RunningApp[]>;
    launch(target: string, kind: "app" | "command"): Promise<string>;
    pickApp(): Promise<string | null>;
    getStartup(): Promise<boolean>;
    setStartup(on: boolean): Promise<boolean>;
    createShortcuts(): Promise<string>;
    keepAwake(on: boolean): Promise<void>;
    openUrl(url: string): Promise<void>;
  };
  setup: {
    check(ollamaUrl: string): Promise<SetupReport>;
  };
  ide: {
    detect(): Promise<IdeInfo[]>;
    open(id: string, folder: string, file?: string): Promise<string>;
    installAddon(id: string): Promise<string>;
    live: {
      ping(): Promise<string | null>;
      begin(root: string, rel: string): Promise<void>;
      append(text: string): Promise<void>;
      end(root: string, rel: string, content: string): Promise<void>;
    };
  };
}

declare global {
  interface Window {
    nightshift?: DesktopBridge;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SAMPLES = [
  `FILE: utils/primes.py
\`\`\`python
"""Sieve of Eratosthenes with a tiny benchmark."""
import time


def sieve(limit: int) -> list[int]:
    flags = [True] * (limit + 1)
    flags[0:2] = [False, False]
    for n in range(2, int(limit ** 0.5) + 1):
        if flags[n]:
            flags[n * n :: n] = [False] * len(flags[n * n :: n])
    return [i for i, ok in enumerate(flags) if ok]


if __name__ == "__main__":
    start = time.perf_counter()
    primes = sieve(1_000_000)
    took = (time.perf_counter() - start) * 1000
    print(f"Found {len(primes):,} primes below 1,000,000 in {took:.1f} ms")
    print("Last five:", primes[-5:])
\`\`\``,
  `FILE: utils/maze.js
\`\`\`javascript
// Random maze generator using depth-first search, printed as ASCII.
const W = 12, H = 8;
const grid = Array.from({ length: H * 2 + 1 }, () => Array(W * 2 + 1).fill("█"));

function carve(x, y) {
  grid[y * 2 + 1][x * 2 + 1] = " ";
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => Math.random() - 0.5);
  for (const [dx, dy] of dirs) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < W && ny < H && grid[ny * 2 + 1][nx * 2 + 1] === "█") {
      grid[y * 2 + 1 + dy][x * 2 + 1 + dx] = " ";
      carve(nx, ny);
    }
  }
}

carve(0, 0);
console.log(grid.map((row) => row.join("")).join("\\n"));
console.log(\`Maze \${W}x\${H} generated.\`);
\`\`\``,
  `FILE: utils/wordcount.py
\`\`\`python
"""Count the most common words in a block of text."""
from collections import Counter
import re

TEXT = """
NightShift keeps coding while you sleep. It writes a file, runs it,
reads the output, and decides what to build next. Then it keeps coding.
"""


def top_words(text: str, n: int = 5) -> list[tuple[str, int]]:
    words = re.findall(r"[a-z']+", text.lower())
    return Counter(words).most_common(n)


if __name__ == "__main__":
    for word, count in top_words(TEXT):
        print(f"{word:>10} | {'#' * count} {count}")
\`\`\``,
];

const DEMO_PLAN = `- [ ] Create the app package, main.py and a first passing test
- [ ] Add a word counter for text files
- [ ] Add a command to find duplicate lines
- [ ] Add a JSON pretty-printer command
- [ ] Add argparse sub-commands for every tool
- [ ] Write a README with usage examples`;

function demoTaskReply(id: number, title: string): string {
  const F = "\`\`\`";
  return `FILE: app/tool${id}.py
${F}python
"""${title}"""


def run(text: str) -> dict:
    words = text.split()
    return {"words": len(words), "unique": len(set(words))}
${F}

FILE: tests/test_tool${id}.py
${F}python
import unittest

from app.tool${id} import run


class Tool${id}Test(unittest.TestCase):
    def test_counts_words(self):
        self.assertEqual(run("a b a")["words"], 3)

    def test_counts_unique(self):
        self.assertEqual(run("a b a")["unique"], 2)


if __name__ == "__main__":
    unittest.main()
${F}

SUMMARY: ${title}.`;
}

const DEMO_OUTPUT: Record<string, string> = {
  "utils/primes.py": "Found 78,498 primes below 1,000,000 in 61.4 ms\nLast five: [999953, 999959, 999961, 999979, 999983]\n",
  "utils/maze.js": "█████████████\n█   █       █\n█ █ █ █████ █\n█ █   █   █ █\n█ █████ █ █ █\n█       █   █\n█████████████\nMaze 12x8 generated.\n",
  "utils/wordcount.py": "  it | ### 3\n  keeps | ## 2\n  coding | ## 2\n  the | ## 2\n  nightshift | # 1\n",
};

const demoModels = ["qwen2.5-coder:1.5b"];
const demoFiles: Record<string, string> = {};
let demoCancelled = false;
let demoIndex = 0;

export const demoBridge: DesktopBridge = {
  isDesktop: false,
  platform: "preview",
  launchedAtStartup: false,
  ai: {
    async generate(req, onChunk) {
      demoCancelled = false;
      const task = /CURRENT TASK #(\d+): (.+)/.exec(req.prompt);
      const text = req.prompt.includes("markdown checklist")
        ? DEMO_PLAN
        : task
          ? demoTaskReply(Number(task[1]), task[2] ?? "")
          : (SAMPLES[demoIndex++ % SAMPLES.length] ?? "");
      await sleep(900);
      for (let i = 0; i < text.length; i += 3) {
        if (demoCancelled) throw new Error("cancelled");
        onChunk(text.slice(i, i + 3));
        await sleep(14);
      }
      return text;
    },
    async cancel() {
      demoCancelled = true;
    },
    async listModels() {
      return [...demoModels];
    },
    async pull(req, onProgress) {
      for (let p = 0; p <= 100; p += 10) {
        onProgress({ status: p < 100 ? "downloading" : "success", percent: p });
        await sleep(200);
      }
      if (!demoModels.includes(req.model)) demoModels.push(req.model);
    },
  },
  fs: {
    async pickFolder() {
      return "C:\\Users\\you\\NightShift\\workspace";
    },
    async writeFile(root, rel, content) {
      demoFiles[rel] = content;
      return `${root}\\${rel.replace(/\//g, "\\")}`;
    },
    async openFolder() {},
    async list() {
      return Object.keys(demoFiles).map((path, i) => ({ path, size: demoFiles[path]?.length ?? 0, mtime: i }));
    },
    async read(_root, rel) {
      return demoFiles[rel] ?? null;
    },
    async exists(_root, rel) {
      return rel === ".git" ? demoFiles["PLAN.md"] !== undefined : demoFiles[rel] !== undefined;
    },
    async remove(_root, rel) {
      for (const k of Object.keys(demoFiles)) if (k === rel || k.startsWith(`${rel}/`)) delete demoFiles[k];
    },
  },
  terminal: {
    async run(cmd, _cwd, _t, onData) {
      await sleep(500);
      const file = /"([^"]+)"/.exec(cmd)?.[1] ?? "";
      const out = cmd.includes("unittest")
        ? "test_counts_unique ... ok\ntest_counts_words ... ok\n\nRan 2 tests in 0.001s\n\nOK\n"
        : cmd.startsWith("git")
          ? ""
          : (DEMO_OUTPUT[file] ?? `(preview) ran: ${cmd}\n`);
      for (const line of out.split("\n")) {
        onData(line + "\n");
        await sleep(90);
      }
      return 0;
    },
    async kill() {},
  },
  system: {
    async listApps() {
      return [
        { pid: 4120, name: "Code.exe", title: "engine.ts - nightshift - Visual Studio Code", memory: "412,300 K" },
        { pid: 9384, name: "chrome.exe", title: "NVIDIA Developer - Google Chrome", memory: "388,104 K" },
        { pid: 2204, name: "WindowsTerminal.exe", title: "PowerShell", memory: "96,220 K" },
        { pid: 7781, name: "ollama.exe", title: "Ollama", memory: "5,812,440 K" },
        { pid: 1180, name: "explorer.exe", title: "workspace", memory: "120,560 K" },
      ];
    },
    async launch(target) {
      return `(preview) would open ${target}`;
    },
    async pickApp() {
      return "C:\\Program Files\\Notepad++\\notepad++.exe";
    },
    async getStartup() {
      return false;
    },
    async setStartup(on) {
      return on;
    },
    async createShortcuts() {
      return "(preview) Start Menu and Desktop shortcuts are created in the desktop app.";
    },
    async keepAwake() {},
    async openUrl(url) {
      window.open(url, "_blank", "noopener");
    },
  },
  setup: {
    async check() {
      await sleep(400);
      return {
        ollama: { installed: true, running: true, version: "0.6.2" },
        models: [...demoModels],
        python: "Python 3.12.4",
        node: "v20.15.0",
        git: null,
        winget: true,
        ramGB: 8,
        cpu: "Intel(R) Core(TM) i5-8250U",
        cores: 8,
      };
    },
  },
  ide: {
    async detect() {
      return [
        { id: "vscode", name: "VS Code", available: true },
        { id: "cursor", name: "Cursor", available: false },
        { id: "windsurf", name: "Windsurf", available: false },
        { id: "vs", name: "Visual Studio", available: true },
        { id: "idea", name: "IntelliJ IDEA", available: false },
        { id: "pycharm", name: "PyCharm", available: false },
        { id: "zed", name: "Zed", available: false },
        { id: "sublime", name: "Sublime Text", available: false },
        { id: "notepadpp", name: "Notepad++", available: true },
      ];
    },
    async open(id) {
      return `(preview) would open workspace in ${id}`;
    },
    async installAddon(id) {
      return `(preview) would install the live-typing add-on into ${id}`;
    },
    live: {
      async ping() {
        return null;
      },
      async begin() {},
      async append() {},
      async end() {},
    },
  },
};

export function getBridge(): DesktopBridge {
  if (typeof window !== "undefined" && window.nightshift) return window.nightshift;
  return demoBridge;
}
