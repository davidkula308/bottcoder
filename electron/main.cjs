// NightShift Coder — Electron main process (Windows-first, also works on Linux/macOS).
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, powerSaveBlocker } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, exec } = require("child_process");

const APP_NAME = "NightShift Coder";
const launchedHidden = process.argv.includes("--hidden");
const isWin = process.platform === "win32";
let win = null;
let tray = null;
let quitting = false;
let aiController = null;
let termProc = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.setName(APP_NAME);
if (isWin) app.setAppUserModelId("com.nightshift.coder");

function iconPath() {
  return path.join(__dirname, isWin ? "icon.ico" : "icon.png");
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: "#121613",
    icon: iconPath(),
    show: !launchedHidden,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, "..", "dist-electron", "renderer", "index.html"));
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 16, height: 16 }));
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show NightShift", click: () => (win.show(), win.focus()) },
      { type: "separator" },
      { label: "Quit", click: () => ((quitting = true), app.quit()) },
    ]),
  );
  tray.on("click", () => (win.show(), win.focus()));
}

app.on("second-instance", () => {
  if (win) (win.show(), win.focus());
});
app.on("before-quit", () => (quitting = true));
app.whenReady().then(() => {
  createWindow();
  createTray();
});
app.on("window-all-closed", () => {});

/* ---------------- AI ---------------- */

async function readStream(res, onLine) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  }
  if (buf.trim()) onLine(buf.trim());
}

ipcMain.handle("ai:generate", async (event, req) => {
  aiController?.abort();
  aiController = new AbortController();
  const send = (text) => event.sender.send("ai:chunk", { id: req.id, text });
  let full = "";
  if (req.provider === "nim") {
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      signal: aiController.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${req.nimKey}` },
      body: JSON.stringify({
        model: req.model,
        stream: true,
        temperature: 0.4,
        max_tokens: 4096,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`NVIDIA NIM ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await readStream(res, (line) => {
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const t = JSON.parse(data).choices?.[0]?.delta?.content;
        if (t) (full += t), send(t);
      } catch {}
    });
  } else {
    const base = (req.ollamaUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
    const res = await fetch(`${base}/api/generate`, {
      method: "POST",
      signal: aiController.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: req.model, system: req.system, prompt: req.prompt, stream: true, options: { temperature: 0.3, num_ctx: 8192 } }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await readStream(res, (line) => {
      try {
        const t = JSON.parse(line).response;
        if (t) (full += t), send(t);
      } catch {}
    });
  }
  return full;
});

ipcMain.handle("ai:cancel", () => {
  aiController?.abort();
  aiController = null;
});

ipcMain.handle("ai:models", async (_e, req) => {
  if (req.provider === "nim") {
    const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
      headers: { Authorization: `Bearer ${req.nimKey}` },
    });
    if (!res.ok) throw new Error(`NVIDIA NIM ${res.status}`);
    const json = await res.json();
    return (json.data || []).map((m) => m.id).filter((id) => /code|coder|qwen|llama|deepseek/i.test(id));
  }
  const base = (req.ollamaUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
  const res = await fetch(`${base}/api/tags`);
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const json = await res.json();
  return (json.models || []).map((m) => m.name);
});

/* ---------------- Files ---------------- */

ipcMain.handle("fs:pickFolder", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"], title: "Choose workspace folder" });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle("fs:writeFile", async (_e, { root, rel, content }) => {
  if (!root) throw new Error("No workspace folder chosen");
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, rel);
  if (!target.startsWith(rootAbs + path.sep)) throw new Error("Refusing to write outside the workspace");
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, content, "utf8");
  return target;
});

ipcMain.handle("fs:openFolder", (_e, p) => shell.openPath(p));

/* ---------------- Terminal ---------------- */

function killTerm() {
  if (!termProc) return;
  try {
    if (isWin) exec(`taskkill /pid ${termProc.pid} /T /F`);
    else termProc.kill("SIGKILL");
  } catch {}
  termProc = null;
}

ipcMain.handle("term:run", (event, { id, cmd, cwd, timeoutSec }) => {
  killTerm();
  return new Promise((resolve) => {
    const send = (text) => event.sender.send("term:data", { id, text });
    const p = spawn(cmd, { cwd: cwd || os.homedir(), shell: true, windowsHide: true, env: process.env });
    termProc = p;
    const timer = setTimeout(() => {
      send(`\n[stopped after ${timeoutSec}s]\n`);
      killTerm();
      resolve(null);
    }, (timeoutSec || 60) * 1000);
    p.stdout.on("data", (d) => send(d.toString()));
    p.stderr.on("data", (d) => send(d.toString()));
    p.on("error", (err) => send(`${err.message}\n`));
    p.on("close", (code) => {
      clearTimeout(timer);
      if (termProc === p) termProc = null;
      resolve(code);
    });
  });
});

ipcMain.handle("term:kill", () => killTerm());

/* ---------------- System ---------------- */

function run(cmd) {
  return new Promise((resolve) => exec(cmd, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err ? "" : out)));
}

ipcMain.handle("sys:listApps", async () => {
  if (isWin) {
    const out = await run("tasklist /v /fo csv /nh");
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.replace(/^"|"$/g, "").split('","'))
      .filter((c) => c.length >= 9 && c[8] && c[8] !== "N/A")
      .map((c) => ({ name: c[0], pid: Number(c[1]), memory: c[4], title: c[8] }));
  }
  const out = await run("ps -eo pid,rss,comm --sort=-rss | head -40");
  return out
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((l) => l.trim().split(/\s+/))
    .map(([pid, rss, ...name]) => ({ pid: Number(pid), memory: `${Math.round(Number(rss) / 1024)} MB`, name: name.join(" "), title: "" }));
});

ipcMain.handle("sys:launch", async (_e, { target, kind }) => {
  if (kind === "app") {
    const err = await shell.openPath(target);
    if (!err) return `opened ${target}`;
  }
  const p = spawn(target, { shell: true, detached: true, stdio: "ignore", windowsHide: false });
  p.unref();
  return `started ${target}`;
});

ipcMain.handle("sys:pickApp", async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: isWin ? [{ name: "Programs", extensions: ["exe", "lnk", "bat", "cmd"] }] : [],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle("sys:getStartup", () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle("sys:setStartup", (_e, on) => {
  app.setLoginItemSettings({ openAtLogin: on, args: ["--hidden"], path: process.execPath });
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle("sys:createShortcuts", () => {
  if (isWin) {
    const opts = { target: process.execPath, description: APP_NAME, icon: process.execPath, iconIndex: 0 };
    const startMenu = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", `${APP_NAME}.lnk`);
    const desktop = path.join(app.getPath("desktop"), `${APP_NAME}.lnk`);
    const a = shell.writeShortcutLink(startMenu, "create", opts);
    const b = shell.writeShortcutLink(desktop, "create", opts);
    return a && b
      ? "Shortcuts added. Open Start, right-click NightShift Coder → Pin to Start."
      : "Could not create every shortcut — try running the app once as your normal user.";
  }
  if (process.platform === "linux") {
    const file = path.join(os.homedir(), ".local", "share", "applications", "nightshift-coder.desktop");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `[Desktop Entry]\nName=${APP_NAME}\nExec="${process.execPath}"\nIcon=${iconPath()}\nType=Application\nCategories=Development;\n`);
    return "Added to your applications menu.";
  }
  return "On macOS, drag the app to your Dock to pin it.";
});

/* ---------------- Editors ---------------- */

const IDES = [
  { id: "vscode", name: "VS Code", cmd: "code", reuse: true, winPaths: ["%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\bin\\code.cmd"] },
  { id: "cursor", name: "Cursor", cmd: "cursor", reuse: true, winPaths: ["%LOCALAPPDATA%\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd"] },
  { id: "windsurf", name: "Windsurf", cmd: "windsurf", reuse: true, winPaths: ["%LOCALAPPDATA%\\Programs\\Windsurf\\bin\\windsurf.cmd"] },
  { id: "vs", name: "Visual Studio", cmd: "devenv", winPaths: ["%ProgramFiles%\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\devenv.exe"] },
  { id: "idea", name: "IntelliJ IDEA", cmd: "idea64", winPaths: [] },
  { id: "pycharm", name: "PyCharm", cmd: "pycharm64", winPaths: [] },
  { id: "zed", name: "Zed", cmd: "zed", winPaths: [] },
  { id: "sublime", name: "Sublime Text", cmd: "subl", winPaths: ["%ProgramFiles%\\Sublime Text\\subl.exe"] },
  { id: "notepadpp", name: "Notepad++", cmd: "notepad++", winPaths: ["%ProgramFiles%\\Notepad++\\notepad++.exe"] },
];
const resolvedIde = {};

function expand(p) {
  return p.replace(/%([^%]+)%/g, (_, k) => process.env[k] || "");
}

async function resolveIde(ide) {
  if (resolvedIde[ide.id] !== undefined) return resolvedIde[ide.id];
  let found = null;
  const where = (await run(`${isWin ? "where" : "which"} ${ide.cmd}`)).split(/\r?\n/)[0]?.trim();
  if (where) found = where;
  if (!found && isWin) found = ide.winPaths.map(expand).find((p) => p && fs.existsSync(p)) || null;
  resolvedIde[ide.id] = found;
  return found;
}

ipcMain.handle("ide:detect", async () =>
  Promise.all(IDES.map(async (i) => ({ id: i.id, name: i.name, available: !!(await resolveIde(i)) }))),
);

ipcMain.handle("ide:open", async (_e, { id, folder, file }) => {
  const ide = IDES.find((i) => i.id === id);
  const bin = ide && (await resolveIde(ide));
  if (!bin) return `${ide ? ide.name : id} not found`;
  const args = ide.reuse ? ["-r", folder].concat(file ? [file] : []) : [file || folder];
  const p = spawn(`"${bin}"`, args.map((a) => `"${a}"`), { shell: true, detached: true, stdio: "ignore" });
  p.unref();
  return `opened in ${ide.name}`;
});

ipcMain.handle("app:flags", () => ({ launchedAtStartup: launchedHidden }));

/* ---------------- Model download ---------------- */

ipcMain.handle("ai:pull", async (event, req) => {
  const base = (req.ollamaUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
  const res = await fetch(`${base}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: req.model, name: req.model, stream: true }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  let failed = null;
  await readStream(res, (line) => {
    try {
      const j = JSON.parse(line);
      if (j.error) failed = j.error;
      const percent = j.total ? Math.round((j.completed || 0) / j.total * 100) : null;
      event.sender.send("ai:pullProgress", { id: req.id, text: { status: j.status || j.error || "", percent } });
    } catch {}
  });
  if (failed) throw new Error(failed);
});

/* ---------------- Project files ---------------- */

const SKIP_DIRS = new Set([".git", ".nightshift", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", ".idea", ".vscode"]);

function insideRoot(root, rel) {
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, rel);
  if (target !== rootAbs && !target.startsWith(rootAbs + path.sep)) throw new Error("Outside the workspace");
  return target;
}

ipcMain.handle("fs:list", async (_e, root) => {
  const out = [];
  const rootAbs = path.resolve(root);
  async function walk(dir, depth) {
    if (depth > 8 || out.length >= 400) return;
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= 400) return;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) await walk(abs, depth + 1);
      } else if (ent.isFile()) {
        const st = await fs.promises.stat(abs);
        out.push({ path: path.relative(rootAbs, abs).split(path.sep).join("/"), size: st.size, mtime: st.mtimeMs });
      }
    }
  }
  await walk(rootAbs, 0);
  return out;
});

ipcMain.handle("fs:read", async (_e, { root, rel }) => {
  try {
    const target = insideRoot(root, rel);
    const st = await fs.promises.stat(target);
    if (st.size > 200 * 1024) return null;
    return await fs.promises.readFile(target, "utf8");
  } catch {
    return null;
  }
});

ipcMain.handle("fs:exists", async (_e, { root, rel }) => {
  try {
    await fs.promises.access(insideRoot(root, rel));
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("fs:remove", async (_e, { root, rel }) => {
  const target = insideRoot(root, rel);
  if (target === path.resolve(root)) throw new Error("Refusing to delete the workspace itself");
  await fs.promises.rm(target, { recursive: true, force: true });
});

/* ---------------- Stay awake ---------------- */

let awakeId = null;
ipcMain.handle("sys:keepAwake", (_e, on) => {
  if (on && awakeId === null) awakeId = powerSaveBlocker.start("prevent-app-suspension");
  if (!on && awakeId !== null) {
    powerSaveBlocker.stop(awakeId);
    awakeId = null;
  }
});

ipcMain.handle("sys:openUrl", (_e, url) => {
  if (/^https:\/\//.test(url)) return shell.openExternal(url);
});

/* ---------------- Setup check ---------------- */

async function refreshPath() {
  if (!isWin) return;
  const out = await run(
    `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`,
  );
  const fresh = out.trim();
  if (fresh) process.env.PATH = fresh;
}

function firstLine(s) {
  return (s || "").split(/\r?\n/).find((l) => l.trim())?.trim() || null;
}

ipcMain.handle("setup:check", async (_e, ollamaUrl) => {
  await refreshPath();
  Object.keys(resolvedIde).forEach((k) => delete resolvedIde[k]);
  const base = (ollamaUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
  let running = false;
  let version = null;
  let models = [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const v = await fetch(`${base}/api/version`, { signal: ctrl.signal });
    clearTimeout(t);
    if (v.ok) {
      running = true;
      version = (await v.json()).version || null;
      const tags = await fetch(`${base}/api/tags`);
      if (tags.ok) models = ((await tags.json()).models || []).map((m) => m.name);
    }
  } catch {}
  const ollamaBin =
    firstLine(await run(`${isWin ? "where" : "which"} ollama`)) ||
    (isWin && fs.existsSync(expand("%LOCALAPPDATA%\\Programs\\Ollama\\ollama.exe")) ? "found" : null);
  if (!running && ollamaBin && isWin) {
    // Try to start the Ollama background service once.
    const exe = ollamaBin === "found" ? expand("%LOCALAPPDATA%\\Programs\\Ollama\\ollama.exe") : ollamaBin;
    try {
      spawn(`"${exe}"`, ["serve"], { shell: true, detached: true, stdio: "ignore", windowsHide: true }).unref();
    } catch {}
  }
  const pyCmd = isWin ? "python --version" : "python3 --version || python --version";
  let python = firstLine(await run(pyCmd));
  if (python && /Microsoft Store|was not found/i.test(python)) python = null;
  const node = firstLine(await run("node --version"));
  const git = firstLine(await run("git --version"));
  const winget = isWin ? !!firstLine(await run("winget --version")) : false;
  return {
    ollama: { installed: !!ollamaBin || running, running, version },
    models,
    python,
    node,
    git,
    winget,
    ramGB: Math.round(os.totalmem() / 1024 ** 3),
    cpu: os.cpus()[0]?.model || "unknown",
    cores: os.cpus().length,
  };
});

/* ---------------- Live typing (VS Code add-on) ---------------- */

const LIVE_URL = "http://127.0.0.1:47615";
let liveQueue = Promise.resolve();
function livePost(route, body) {
  liveQueue = liveQueue
    .then(() =>
      fetch(`${LIVE_URL}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    )
    .catch(() => {});
  return liveQueue.then(() => undefined);
}

ipcMain.handle("live:ping", async () => {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 800);
    const r = await fetch(`${LIVE_URL}/ping`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return (await r.json()).app || "VS Code";
  } catch {
    return null;
  }
});
ipcMain.handle("live:begin", (_e, { root, rel }) => livePost("/begin", { file: insideRoot(root, rel) }));
ipcMain.handle("live:append", (_e, text) => livePost("/append", { text }));
ipcMain.handle("live:end", (_e, { root, rel, content }) => livePost("/end", { file: insideRoot(root, rel), content }));

ipcMain.handle("ide:installAddon", async (_e, id) => {
  const ide = IDES.find((i) => i.id === id);
  const bin = ide && (await resolveIde(ide));
  if (!bin) return "Editor not found";
  const vsix = path.join(__dirname, "nightshift-live.vsix");
  if (!fs.existsSync(vsix)) return "Add-on file missing from this build";
  const out = await new Promise((resolve) =>
    exec(`"${bin}" --install-extension "${vsix}" --force`, { windowsHide: true }, (err, so, se) =>
      resolve(err ? `Install failed: ${(se || err.message).slice(0, 200)}` : "Add-on installed. Restart or reload the editor once."),
    ),
  );
  return out;
});
