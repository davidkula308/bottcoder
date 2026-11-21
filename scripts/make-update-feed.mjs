// Writes the in-app update feed (public/updates) from the staged desktop app, so publishing the site ships the update.
// Usage: node scripts/make-update-feed.mjs <stageDir> <version> "<notes>"
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [stage, version, notes = ""] = process.argv.slice(2);
if (!stage || !version) throw new Error("usage: make-update-feed.mjs <stageDir> <version> [notes]");
const out = path.resolve("public/updates");
fs.rmSync(out, { recursive: true, force: true });

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs);
    else {
      const rel = path.relative(stage, abs).split(path.sep).join("/");
      const buf = fs.readFileSync(abs);
      files.push({ path: rel, size: buf.length, sha256: createHash("sha256").update(buf).digest("hex") });
      const dest = path.join(out, "files", rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
    }
  }
};
walk(stage);
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ version, notes, files }, null, 2) + "\n");
console.log(`update feed ${version}: ${files.length} files`);
