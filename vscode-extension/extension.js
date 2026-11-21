// NightShift Live Typing — receives code from NightShift Coder on 127.0.0.1:47615 and types it into the editor.
const vscode = require("vscode");
const http = require("http");

const PORT = 47615;
let server = null;
let status = null;
let current = null; // vscode.Uri being typed
let queue = Promise.resolve();

function enqueue(fn) {
  queue = queue.then(fn).catch((e) => console.error("[nightshift]", e));
}

async function editorFor(uri, focus) {
  const doc = await vscode.workspace.openTextDocument(uri);
  return vscode.window.showTextDocument(doc, { preview: false, preserveFocus: !focus });
}

async function ensureFile(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    await vscode.workspace.fs.writeFile(uri, new Uint8Array());
  }
}

async function begin(file) {
  const uri = vscode.Uri.file(file);
  await ensureFile(uri);
  const editor = await editorFor(uri, false);
  const doc = editor.document;
  const all = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
  await editor.edit((b) => b.delete(all), { undoStopBefore: true, undoStopAfter: false });
  current = uri;
  setStatus("typing " + file.split(/[\\/]/).pop());
}

async function append(text) {
  if (!current) return;
  let editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === current.toString());
  if (!editor) editor = await editorFor(current, false);
  const doc = editor.document;
  const end = doc.positionAt(doc.getText().length);
  await editor.edit((b) => b.insert(end, text), { undoStopBefore: false, undoStopAfter: false });
  const after = doc.positionAt(doc.getText().length);
  editor.selection = new vscode.Selection(after, after);
  editor.revealRange(new vscode.Range(after, after), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

async function end(file, content) {
  const uri = vscode.Uri.file(file);
  await ensureFile(uri);
  const editor = await editorFor(uri, false);
  const doc = editor.document;
  if (doc.getText() !== content) {
    const all = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
    await editor.edit((b) => b.replace(all, content), { undoStopBefore: false, undoStopAfter: true });
  }
  await doc.save();
  if (current && current.toString() === uri.toString()) current = null;
  setStatus("connected");
}

function setStatus(text) {
  if (status) status.text = `$(pulse) NightShift: ${text}`;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function activate(context) {
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "nightshift.live.status";
  setStatus("waiting");
  status.show();
  context.subscriptions.push(status);
  context.subscriptions.push(
    vscode.commands.registerCommand("nightshift.live.status", () =>
      vscode.window.showInformationMessage(server ? "NightShift live typing is listening." : "Another editor window is already receiving NightShift code."),
    ),
  );

  server = http.createServer(async (req, res) => {
    const reply = (code, obj) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.method === "GET" && req.url === "/ping") {
      setStatus(current ? "typing" : "connected");
      return reply(200, { ok: true, app: vscode.env.appName });
    }
    if (req.method !== "POST") return reply(404, { ok: false });
    const body = await readBody(req);
    if (req.url === "/begin" && body.file) enqueue(() => begin(body.file));
    else if (req.url === "/append" && typeof body.text === "string") enqueue(() => append(body.text));
    else if (req.url === "/end" && body.file) enqueue(() => end(body.file, String(body.content ?? "")));
    else return reply(400, { ok: false });
    reply(200, { ok: true });
  });
  server.on("error", () => {
    server = null;
    setStatus("another window is connected");
  });
  server.listen(PORT, "127.0.0.1");
  context.subscriptions.push({ dispose: () => server && server.close() });
}

function deactivate() {
  if (server) server.close();
}

module.exports = { activate, deactivate };
