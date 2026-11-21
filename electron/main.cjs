// NightShift Coder — Electron main process (Windows-first, also works on Linux/macOS).
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } = require("electron");
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
  return path.join(__dirname, "icon.png");
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
  tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 }));
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
        max_tokens: 2048,
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
      body: JSON.stringify({ model: req.model, system: req.system, prompt: req.prompt, stream: true, options: { temperature: 0.4 } }),
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
