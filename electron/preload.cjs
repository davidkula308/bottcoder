// Exposes a small, safe API to the UI. No Node access leaks into the page.
const { contextBridge, ipcRenderer } = require("electron");

let n = 0;
function stream(channel, event, payload, onData) {
  const id = `${Date.now()}-${++n}`;
  const listener = (_e, msg) => {
    if (msg.id === id) onData(msg.text);
  };
  ipcRenderer.on(event, listener);
  return ipcRenderer.invoke(channel, { ...payload, id }).finally(() => ipcRenderer.removeListener(event, listener));
}

const launchedAtStartup = process.argv.includes("--hidden");

contextBridge.exposeInMainWorld("nightshift", {
  isDesktop: true,
  platform: process.platform,
  launchedAtStartup,
  ai: {
    generate: (req, onChunk) => stream("ai:generate", "ai:chunk", req, onChunk),
    cancel: () => ipcRenderer.invoke("ai:cancel"),
    listModels: (req) => ipcRenderer.invoke("ai:models", req),
  },
  fs: {
    pickFolder: () => ipcRenderer.invoke("fs:pickFolder"),
    writeFile: (root, rel, content) => ipcRenderer.invoke("fs:writeFile", { root, rel, content }),
    openFolder: (p) => ipcRenderer.invoke("fs:openFolder", p),
  },
  terminal: {
    run: (cmd, cwd, timeoutSec, onData) => stream("term:run", "term:data", { cmd, cwd, timeoutSec }, onData),
    kill: () => ipcRenderer.invoke("term:kill"),
  },
  system: {
    listApps: () => ipcRenderer.invoke("sys:listApps"),
    launch: (target, kind) => ipcRenderer.invoke("sys:launch", { target, kind }),
    pickApp: () => ipcRenderer.invoke("sys:pickApp"),
    getStartup: () => ipcRenderer.invoke("sys:getStartup"),
    setStartup: (on) => ipcRenderer.invoke("sys:setStartup", on),
    createShortcuts: () => ipcRenderer.invoke("sys:createShortcuts"),
  },
  ide: {
    detect: () => ipcRenderer.invoke("ide:detect"),
    open: (id, folder, file) => ipcRenderer.invoke("ide:open", { id, folder, file }),
  },
});
