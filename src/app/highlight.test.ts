import { describe, expect, it } from "vitest";
import { tokenize } from "./highlight";

describe("code colouring", () => {
  it("keeps every character of the line", () => {
    const line = `def add(a, b): return "x" + 1  # sum`;
    expect(tokenize(line, "python").map((t) => t.v).join("")).toBe(line);
  });
  it("marks keywords, strings, numbers and comments", () => {
    const kinds = tokenize(`const n = "hi" + 42 // note`, "javascript").filter((t) => t.k !== "plain").map((t) => t.k);
    expect(kinds).toEqual(["kw", "str", "num", "com"]);
  });
});
