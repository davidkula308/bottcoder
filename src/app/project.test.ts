import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  addTasks,
  applyEdits,
  currentStreamingBlock,
  newProject,
  nextTask,
  parseChecklist,
  parseProjectResponse,
  pickContextFiles,
  recordResult,
  verifyCommand,
} from "./project";
import { buildPrompt, DEFAULT_SESSION } from "./engine";

const F = "```";

describe("project plan", () => {
  it("reads a markdown checklist into tasks", () => {
    expect(parseChecklist("Plan:\n- [ ] Set up structure\n- [x] Add **parser**\n1. Write docs\nrandom text")).toEqual([
      "Set up structure",
      "Add parser",
      "Write docs",
    ]);
  });

  it("works on tasks in order", () => {
    const s = addTasks(newProject("g", "python-cli", 0), ["one", "two"], 1);
    expect(nextTask(s)?.title).toBe("one");
  });
});

describe("three-strike rule", () => {
  it("allows 3 attempts per task", () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });
  it("retries after a failure, skips after the third failure", () => {
    let s = addTasks(newProject("g", "python-cli", 0), ["one", "two"], 1);
    let r = recordResult(s, 1, false, "err", 2);
    expect(r.action).toBe("retry");
    r = recordResult(r.state, 1, false, "err", 3);
    expect(r.action).toBe("retry");
    r = recordResult(r.state, 1, false, "err", 4);
    expect(r.action).toBe("skip");
    s = r.state;
    expect(nextTask(s)?.title).toBe("two");
  });
  it("a passing task is committed and marked done", () => {
    const s = addTasks(newProject("g", "python-cli", 0), ["one"], 1);
    const r = recordResult(s, 1, true, "ok", 2);
    expect(r.action).toBe("commit");
    expect(r.state.tasks[0]?.status).toBe("done");
  });
});

describe("multi-file replies", () => {
  it("reads several FILE and EDIT blocks", () => {
    const text = `FILE: app/core.py\n${F}python\ndef add(a, b):\n    return a + b\n${F}\n\nEDIT: main.py\n${F}\n<<<<<<< SEARCH\nprint("hi")\n=======\nprint("hello")\n>>>>>>> REPLACE\n${F}\nSUMMARY: added add()`;
    const r = parseProjectResponse(text);
    expect(r.summary).toBe("added add()");
    expect(r.ops).toEqual([
      { kind: "write", path: "app/core.py", content: "def add(a, b):\n    return a + b\n" },
      { kind: "edit", path: "main.py", edits: [{ search: 'print("hi")', replace: 'print("hello")' }] },
    ]);
  });
  it("refuses to touch .git or .nightshift", () => {
    const r = parseProjectResponse(`FILE: .git/config\n${F}\nx\n${F}`);
    expect(r.ops).toEqual([]);
  });
});

describe("partial edits", () => {
  it("replaces exact text", () => {
    expect(applyEdits("a\nb\nc\n", [{ search: "b", replace: "B" }])).toEqual({ ok: true, content: "a\nB\nc\n" });
  });
  it("tolerates indentation drift", () => {
    const r = applyEdits("def f():\n    return 1\n", [{ search: "def f():\nreturn 1", replace: "def f():\n    return 2" }]);
    expect(r).toEqual({ ok: true, content: "def f():\n    return 2\n" });
  });
  it("reports when the text is not found", () => {
    expect(applyEdits("a\n", [{ search: "zzz", replace: "y" }]).ok).toBe(false);
  });
});

describe("live typing", () => {
  it("follows the file currently being written and holds back a half-arrived fence", () => {
    expect(currentStreamingBlock(`FILE: a.py\n${F}python\nprint(1)\n${F}\nFILE: b.py\n${F}python\nx = 1\n\``)).toEqual({
      path: "b.py",
      code: "x = 1",
    });
  });
});

describe("verification", () => {
  it("runs tests and the entry point when both exist", () => {
    expect(verifyCommand("python-cli", ["main.py", "tests/test_core.py"])).toBe(
      "python -m unittest discover -s tests -t . -v && python main.py",
    );
  });
  it("uses node's test runner for websites", () => {
    expect(verifyCommand("web", ["index.html", "tests/logic.test.mjs"])).toBe("node --test");
  });
  it("has nothing to run for an empty folder", () => {
    expect(verifyCommand("python-cli", [])).toBeNull();
  });
});

describe("reading its own code", () => {
  it("puts files named in the task first and stays within the size budget", () => {
    const files = [
      { path: "app/big.py", size: 9000, mtime: 3 },
      { path: "app/parser.py", size: 800, mtime: 1 },
      { path: "main.py", size: 300, mtime: 2 },
    ];
    const picked = pickContextFiles(files, "Fix bug in parser.py", 2000);
    expect(picked[0]).toBe("app/parser.py");
    expect(picked).not.toContain("app/big.py");
  });
});

describe("strategic stuck guard", () => {
  it("tells the bot to move on from a file that keeps failing", () => {
    const { prompt } = buildPrompt(
      { ...DEFAULT_SESSION, mode: "strategic" },
      { iteration: 5, files: ["a.py"], stuckFile: "a.py", rand: () => 0 },
    );
    expect(prompt).toContain("a.py has failed 3 times");
  });
});
