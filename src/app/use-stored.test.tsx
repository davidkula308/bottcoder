import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { useStored } from "./use-stored";

beforeEach(() => localStorage.clear());

it("restores previous session preferences without overwriting them with defaults", () => {
  localStorage.setItem("nightshift:prefs", JSON.stringify({ saveFiles: false, typingCps: 7 }));
  const hook = renderHook(() => useStored("prefs", { saveFiles: true, typingCps: 30, theme: "night" }));
  expect(hook.result.current[0]).toEqual({ saveFiles: false, typingCps: 7, theme: "night" });
  act(() => hook.result.current[1]({ saveFiles: false, typingCps: 25, theme: "day" }));
  hook.unmount();
  const reopened = renderHook(() => useStored("prefs", { saveFiles: true, typingCps: 30, theme: "night" }));
  expect(reopened.result.current[0]).toEqual({ saveFiles: false, typingCps: 25, theme: "day" });
  reopened.unmount();
});