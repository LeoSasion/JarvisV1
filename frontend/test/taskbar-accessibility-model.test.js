import assert from "node:assert/strict";
import test from "node:test";
import {
  getTaskbarAccessibleLabel,
  getTaskbarKeyboardTarget,
} from "../src/taskbar-accessibility-model.js";

test("taskbar keyboard navigation wraps and supports boundaries", () => {
  assert.equal(getTaskbarKeyboardTarget(5, 0, "ArrowLeft"), 4);
  assert.equal(getTaskbarKeyboardTarget(5, 4, "ArrowRight"), 0);
  assert.equal(getTaskbarKeyboardTarget(5, 2, "Home"), 0);
  assert.equal(getTaskbarKeyboardTarget(5, 2, "End"), 4);
  assert.equal(getTaskbarKeyboardTarget(0, 0, "Home"), -1);
});

test("taskbar accessible labels expose active, running, minimized, and pinned state", () => {
  assert.equal(getTaskbarAccessibleLabel({
    label: "Editor",
    windows: [{ minimized: true }, {}],
    selectedWindow: { minimized: true },
  }, true), "Editor, active, minimized, 2 open windows");
  assert.equal(getTaskbarAccessibleLabel({
    label: "Files",
    windows: [],
    isPinned: true,
  }), "Files, pinned");
});
