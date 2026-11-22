import { act, fireEvent, render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("nightshift:optimizationPromptSeen", "true");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); Reflect.deleteProperty(document.documentElement, "requestFullscreen"); });

it("focus view never requests native fullscreen, preserving the Windows taskbar", async () => {
  const requestFullscreen = vi.fn(async () => {});
  Object.defineProperty(document.documentElement, "requestFullscreen", { value: requestFullscreen, configurable: true });
  const app = render(<Dashboard />);
  await act(async () => { fireEvent.click(app.getByRole("button", { name: "Show only code and output" })); });
  expect(requestFullscreen).not.toHaveBeenCalled();
  await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
  await act(async () => { fireEvent.click(app.getByRole("button", { name: "Show only code and output" })); });
  expect(requestFullscreen).not.toHaveBeenCalled();
});