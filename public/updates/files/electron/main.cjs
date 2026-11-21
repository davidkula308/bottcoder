// NightShift Coder — Electron main process (Windows-first, also works on Linux/macOS).
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, powerSaveBlocker, net } = require("electron");
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
  let res;
  try {
    res = await fetch(`${base}/api/tags`);
  } catch {
    throw new Error("Ollama isn't running on this PC yet. Install it in the setup helper above, or open Ollama from the Start Menu.");
  }
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
  { id: "notepad", name: "Notepad", cmd: "notepad", winPaths: ["%WINDIR%\\System32\\notepad.exe"] },
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
  event.sender.send("ai:pullProgress", { id: req.id, text: { status: "starting Ollama…", percent: null } });
  if (!(await ensureOllama(base, 20))) {
    throw new Error("Ollama isn't installed or won't start. Install Ollama first, then try again.");
  }
  let res;
  try {
    res = await fetch(`${base}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: req.model, name: req.model, stream: true }),
    });
  } catch {
    throw new Error("Couldn't reach Ollama. Open Ollama from the Start Menu, then try again.");
  }
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
  if (failed) {
    if (/no such host|dial tcp|timeout|connection/i.test(failed)) throw new Error(`no internet connection to the model library (${failed})`);
    throw new Error(failed);
  }
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
  if (on && awakeId === null) awakeId = powerSaveBlocker.start("prevent-display-sleep");
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
  const probe = async () => {
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
  };
  await probe();
  const ollamaBin =
    firstLine(await run(`${isWin ? "where" : "which"} ollama`)) ||
    (isWin && fs.existsSync(expand("%LOCALAPPDATA%\\Programs\\Ollama\\ollama.exe")) ? "found" : null);
  if (!running && ollamaBin && isWin) {
    // Start the Ollama background service, then give it a few seconds to come up.
    const exe = ollamaBin === "found" ? expand("%LOCALAPPDATA%\\Programs\\Ollama\\ollama.exe") : ollamaBin;
    try {
      spawn(`"${exe}"`, ["serve"], { shell: true, detached: true, stdio: "ignore", windowsHide: true }).unref();
    } catch {}
    for (let i = 0; i < 8 && !running; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      await probe();
    }
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

/* ---------------- Ollama install (no winget needed) ---------------- */

const OLLAMA_SETUP_URL = "https://ollama.com/download/OllamaSetup.exe";

function ollamaDefaultExe() {
  return expand("%LOCALAPPDATA%\\Programs\\Ollama\\ollama.exe");
}

async function ollamaUp(base) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const r = await fetch(`${base}/api/version`, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

async function findOllama() {
  if (isWin && fs.existsSync(ollamaDefaultExe())) return ollamaDefaultExe();
  const w = firstLine(await run(`${isWin ? "where" : "which"} ollama`));
  return w && fs.existsSync(w) ? w : null;
}

/** Makes sure the Ollama service answers; starts it if it is installed but not running. */
async function ensureOllama(base, waitSec) {
  if (await ollamaUp(base)) return true;
  await refreshPath();
  const exe = await findOllama();
  if (!exe) return false;
  try {
    spawn(exe, ["serve"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {}
  for (let i = 0; i < waitSec; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await ollamaUp(base)) return true;
  }
  return false;
}

ipcMain.handle("setup:installOllama", async (event, { id, ollamaUrl }) => {
  const base = (ollamaUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
  const send = (status, percent) => event.sender.send("setup:progress", { id, text: { status, percent } });
  if (await ensureOllama(base, 5)) {
    send("already installed and running", 100);
    return true;
  }
  if (!isWin) throw new Error("Automatic install is for Windows. Get Ollama from ollama.com/download.");

  // 1. Download the official installer (uses the PC's normal internet settings, incl. proxy).
  const file = path.join(os.tmpdir(), "OllamaSetup.exe");
  send("downloading Ollama…", 0);
  let res;
  try {
    res = await net.fetch(OLLAMA_SETUP_URL);
  } catch (e) {
    throw new Error(`couldn't download Ollama — check the internet connection (${e.message})`);
  }
  if (!res.ok) throw new Error(`couldn't download Ollama (server said ${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const out = fs.createWriteStream(file);
  const reader = res.body.getReader();
  let got = 0;
  let lastPct = -1;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once("drain", r));
    const pct = total ? Math.floor((got / total) * 100) : null;
    if (pct !== lastPct) {
      lastPct = pct;
      send(`downloading Ollama… ${(got / 1024 ** 2).toFixed(0)} MB${total ? ` of ${(total / 1024 ** 2).toFixed(0)} MB` : ""}`, pct);
    }
  }
  await new Promise((r, j) => out.end((err) => (err ? j(err) : r())));
  if (got < 5 * 1024 ** 2) throw new Error("the Ollama download was incomplete — try again");

  // 2. Run it silently. It installs for this user only, so no admin rights are needed.
  send("installing Ollama… (about a minute)", null);
  const code = await new Promise((resolve) => {
    const p = spawn(file, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-"], { windowsHide: true });
    const timer = setTimeout(() => resolve("timeout"), 10 * 60 * 1000);
    p.on("error", (e) => {
      clearTimeout(timer);
      resolve(e.message);
    });
    p.on("close", (c) => {
      clearTimeout(timer);
      resolve(c);
    });
  });
  if (code !== 0) {
    // Fall back to the normal setup window so the user can click through it.
    send("silent install didn't finish — opening the Ollama setup window", null);
    shell.openPath(file);
    throw new Error(`the silent install stopped (${code}). Finish the Ollama setup window that just opened, then click Re-check.`);
  }

  // 3. Start it and wait until it answers.
  send("starting Ollama…", null);
  if (!(await ensureOllama(base, 30))) {
    throw new Error("Ollama installed but didn't start. Open Ollama from the Start Menu, then click Re-check.");
  }
  try {
    fs.unlinkSync(file);
  } catch {}
  send("installed and running", 100);
  return true;
});

/* ---------------- Scratch folder (code that is tested, then thrown away) ---------------- */

const SCRATCH = path.join(os.tmpdir(), "NightShift", "scratch");
try {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
} catch {}
ipcMain.handle("fs:scratchDir", () => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH, { recursive: true });
  return SCRATCH;
});
ipcMain.handle("fs:clearScratch", () => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
ipcMain.handle("fs:defaultWorkspace", () => {
  const p = path.join(app.getPath("documents"), "NightShift", "workspace");
  fs.mkdirSync(p, { recursive: true });
  return p;
});

/* ---------------- Activity apps (open an app, then close it) ---------------- */

function runPs(script, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const enc = Buffer.from(script, "utf16le").toString("base64");
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${enc}`, { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, out) =>
      resolve(err ? "" : out),
    );
  });
}

function parseJsonList(out) {
  try {
    const v = JSON.parse(out.trim() || "[]");
    return Array.isArray(v) ? v : v ? [v] : [];
  } catch {
    return [];
  }
}

// Small built-in apps that open fast and are safe to close.
const LIGHT_APPS = [
  { name: "Notepad", path: "%WINDIR%\\System32\\notepad.exe" },
  { name: "Paint", path: "%WINDIR%\\System32\\mspaint.exe" },
  { name: "Character Map", path: "%WINDIR%\\System32\\charmap.exe" },
  { name: "WordPad", path: "%ProgramFiles%\\Windows NT\\Accessories\\wordpad.exe" },
  { name: "Snipping Tool", path: "%WINDIR%\\System32\\SnippingTool.exe" },
];

ipcMain.handle("sys:listLaunchable", async () => {
  if (!isWin) return [];
  const light = LIGHT_APPS.map((a) => ({ ...a, path: expand(a.path), source: "light" })).filter((a) => fs.existsSync(a.path));
  const open = parseJsonList(
    await runPs(
      "Get-Process | Where-Object { $_.MainWindowTitle -and $_.Path } | Select-Object @{n='name';e={$_.ProcessName}},@{n='path';e={$_.Path}} | ConvertTo-Json -Compress",
    ),
  ).map((a) => ({ name: a.name, path: a.path, source: "open" }));
  const installed = parseJsonList(
    await runPs(
      "$sh = New-Object -ComObject WScript.Shell; $dirs = @([Environment]::GetFolderPath('CommonPrograms'), [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop')); " +
        "Get-ChildItem -Path $dirs -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object { try { $t = $sh.CreateShortcut($_.FullName).TargetPath; if ($t -and $t.ToLower().EndsWith('.exe') -and (Test-Path $t)) { [pscustomobject]@{ name = $_.BaseName; path = $t } } } catch {} } | ConvertTo-Json -Compress",
      60000,
    ),
  )
    .filter((a) => !/uninstall|setup|install|update|repair|help|readme/i.test(`${a.name} ${a.path}`))
    .map((a) => ({ name: a.name, path: a.path, source: "installed" }));
  const seen = new Set();
  const list = [];
  for (const a of [...light, ...open, ...installed]) {
    const k = String(a.path).toLowerCase();
    if (seen.has(k) || k.includes("nightshift")) continue;
    seen.add(k);
    list.push(a);
  }
  return list;
});

async function pidsOf(image) {
  const out = await run(`tasklist /FI "IMAGENAME eq ${image}" /FO CSV /NH`);
  return new Set(
    out
      .split(/\r?\n/)
      .map((l) => l.split('","')[1])
      .filter(Boolean)
      .map((p) => Number(p.replace(/"/g, ""))),
  );
}

let blinking = false;
ipcMain.handle("sys:blink", async (_e, { path: target, seconds, minimized }) => {
  if (!isWin) return "only on Windows";
  if (blinking) return "another app is still open";
  if (!target || !fs.existsSync(target) || !/\.exe$/i.test(target)) return "app not found";
  blinking = true;
  try {
    const image = path.basename(target);
    const before = await pidsOf(image);
    const style = minimized ? "Minimized" : "Normal";
    const started = (await runPs(`(Start-Process -FilePath '${target.replace(/'/g, "''")}' -WindowStyle ${style} -PassThru).Id`)).trim();
    await new Promise((r) => setTimeout(r, 2500));
    const after = await pidsOf(image);
    const mine = [...after].filter((p) => !before.has(p));
    if (started && !before.has(Number(started)) && after.has(Number(started)) && !mine.includes(Number(started))) mine.push(Number(started));
    await new Promise((r) => setTimeout(r, Math.max(3, Math.min(600, seconds || 20)) * 1000));
    if (!mine.length) return `opened ${image} (it handed over to another window, so it was left open)`;
    // Ask nicely first (like clicking X), then make sure it is gone. Never touches copies that were already open.
    await run(`taskkill ${mine.map((p) => `/PID ${p}`).join(" ")}`);
    await new Promise((r) => setTimeout(r, 4000));
    const still = [...(await pidsOf(image))].filter((p) => mine.includes(p));
    if (still.length) await run(`taskkill /F ${still.map((p) => `/PID ${p}`).join(" ")}`);
    return `opened and closed ${image}`;
  } finally {
    blinking = false;
  }
});

/* ---------------- In-app updates ---------------- */

const UPDATE_BASE = "https://bottcoder.lovable.app/updates";
const APP_ROOT = path.join(__dirname, "..");

// Same rule as src/app/update.ts isSafeUpdatePath.
function safeUpdatePath(p) {
  if (!p || p.includes("..") || p.includes("\\") || p.startsWith("/") || /^[a-z]:/i.test(p)) return false;
  return p === "package.json" || p.startsWith("electron/") || p.startsWith("dist-electron/renderer/");
}

function newer(a, b) {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

function sha256(buf) {
  return require("crypto").createHash("sha256").update(buf).digest("hex");
}

async function fetchManifest() {
  const res = await net.fetch(`${UPDATE_BASE}/manifest.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`update server said ${res.status}`);
  const m = await res.json();
  if (!m || typeof m.version !== "string" || !Array.isArray(m.files)) throw new Error("update info is damaged");
  return m;
}

ipcMain.handle("update:check", async () => {
  const current = app.getVersion();
  try {
    const m = await fetchManifest();
    return { current, latest: m.version, available: newer(m.version, current), notes: m.notes || "" };
  } catch (e) {
    return { current, latest: null, available: false, notes: "", error: e.message };
  }
});

ipcMain.handle("update:apply", async (event, { id }) => {
  const send = (status, percent) => event.sender.send("update:progress", { id, text: { status, percent } });
  if (!app.isPackaged) throw new Error("updates only work in the installed app");
  const m = await fetchManifest();
  if (!newer(m.version, app.getVersion())) return false;
  const stage = path.join(APP_ROOT, ".update");
  fs.rmSync(stage, { recursive: true, force: true });
  const todo = [];
  for (const f of m.files) {
    if (!safeUpdatePath(f.path) || typeof f.sha256 !== "string") throw new Error(`update contains a file it may not change: ${f.path}`);
    const local = path.join(APP_ROOT, f.path);
    if (fs.existsSync(local) && sha256(fs.readFileSync(local)) === f.sha256) continue;
    todo.push(f);
  }
  // 1. Download only the changed files and check every byte.
  let i = 0;
  for (const f of todo) {
    send(`downloading ${f.path.split("/").pop()} (${++i} of ${todo.length})`, Math.round((i / Math.max(1, todo.length)) * 90));
    const res = await net.fetch(`${UPDATE_BASE}/files/${f.path}?v=${m.version}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`couldn't download ${f.path} (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha256(buf) !== f.sha256) throw new Error(`${f.path} didn't download correctly — try again`);
    const dest = path.join(stage, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
  // 2. Swap them in, then drop old screen files the new version doesn't use.
  send("installing update…", 95);
  for (const f of todo) {
    const dest = path.join(APP_ROOT, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(stage, f.path), dest);
  }
  const keep = new Set(m.files.map((f) => f.path));
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (!keep.has(r)) fs.rmSync(path.join(dir, e.name), { force: true });
    }
  };
  try {
    walk(path.join(APP_ROOT, "dist-electron", "renderer"), "dist-electron/renderer");
  } catch {}
  fs.rmSync(stage, { recursive: true, force: true });
  send(`updated to ${m.version} — restarting`, 100);
  setTimeout(() => {
    quitting = true;
    app.relaunch();
    app.exit(0);
  }, 1200);
  return true;
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
ipcMain.handle("live:term", (_e, text) => livePost("/term", { text: String(text).slice(0, 20000) }));

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

/* ---------------- Real keyboard typing (Windows) ---------------- */

let typer = null;
let typerWaiting = [];
let typerBuf = "";

function startTyper() {
  if (typer || !isWin) return typer;
  typer = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "typer.ps1")], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  typer.stdout.on("data", (d) => {
    typerBuf += d.toString();
    let i;
    while ((i = typerBuf.indexOf("\n")) >= 0) {
      const line = typerBuf.slice(0, i).trim();
      typerBuf = typerBuf.slice(i + 1);
      const next = typerWaiting.shift();
      if (next) next(line === "OK" ? "ok" : line === "BLOCKED" ? "blocked" : "blocked");
    }
  });
  typer.on("exit", () => {
    typer = null;
    typerWaiting.splice(0).forEach((r) => r("blocked"));
  });
  return typer;
}

function typerSend(line) {
  if (!isWin) return Promise.resolve("unsupported");
  const p = startTyper();
  if (!p) return Promise.resolve("unsupported");
  return new Promise((resolve) => {
    typerWaiting.push(resolve);
    p.stdin.write(line + "\n");
  });
}

const b64 = (s) => Buffer.from(String(s || ""), "utf8").toString("base64");

ipcMain.handle("kb:type", (_e, { text, mustContain, cps }) => {
  const delay = Math.max(5, Math.round(1000 / Math.max(5, Math.min(120, cps || 30))));
  return typerSend(`T|${b64(text)}|${b64(mustContain)}|${delay}`);
});
ipcMain.handle("kb:save", (_e, { mustContain }) => typerSend(`S|${b64(mustContain)}`));
app.on("will-quit", () => {
  try {
    typer?.kill();
  } catch {}
});
