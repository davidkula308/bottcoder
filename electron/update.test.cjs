const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

function updaterFixture(corrupt = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-update-test-"));
  fs.mkdirSync(path.join(root, "electron"));
  const original = '{"version":"1.3.0"}';
  const next = Buffer.from('{"version":"1.3.1"}');
  fs.writeFileSync(path.join(root, "package.json"), original);
  const handlers = new Map();
  const urls = [];
  const manifest = { version: "1.3.1", notes: "Fetch updates", files: [{ path: "package.json", size: next.length, sha256: crypto.createHash("sha256").update(next).digest("hex") }] };
  const context = {
    fs, path, Buffer, require, __dirname: path.join(root, "electron"), quitting: false,
    app: { isPackaged: true, getVersion: () => "1.3.0", relaunch() {}, exit() {} },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    net: { fetch: async (url) => { urls.push(url); return { ok: true, json: async () => manifest, arrayBuffer: async () => corrupt ? Buffer.from("damaged") : next }; } },
    setTimeout() {}, Date,
  };
  const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8").split("/* ---------------- In-app updates ---------------- */")[1]?.split("/* ---------------- Live typing")[0];
  assert.ok(source, "The real updater source must be present");
  vm.runInNewContext(source, context);
  return { root, original, handlers, urls };
}

test("desktop Fetch updates checks the published link and installs its verified files", async () => {
  const f = updaterFixture();
  try {
    const info = await f.handlers.get("update:check")();
    assert.equal(info.available, true);
    const applied = await f.handlers.get("update:apply")({ sender: { send() {} } }, { id: "test" });
    assert.equal(applied, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, "package.json"), "utf8")).version, "1.3.1");
    assert.ok(f.urls.some((u) => u.startsWith("https://bottcoder.lovable.app/updates/manifest.json?")));
    assert.ok(f.urls.includes("https://bottcoder.lovable.app/updates/files/package.json?v=1.3.1"));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("a damaged published update file never replaces the installed file", async () => {
  const f = updaterFixture(true);
  try {
    await assert.rejects(f.handlers.get("update:apply")({ sender: { send() {} } }, { id: "test" }), /didn't download correctly/);
    assert.equal(fs.readFileSync(path.join(f.root, "package.json"), "utf8"), f.original);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});