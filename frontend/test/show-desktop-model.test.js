import assert from "node:assert/strict";
import test from "node:test";
import {
  getVisibleInternalWindowIds,
  planInternalShowDesktopToggle,
} from "../src/show-desktop-model.js";

const visibleExplorer = {
  internalWindowId: "explorer",
  minimized: false,
};
const minimizedTerminal = {
  internalWindowId: "terminal",
  minimized: true,
};

test("visible internal windows are bounded to unique registered identifiers", () => {
  assert.deepEqual(getVisibleInternalWindowIds([
    visibleExplorer,
    visibleExplorer,
    minimizedTerminal,
    null,
  ]), ["explorer"]);
});

test("show desktop minimizes only currently visible internal windows", () => {
  const plan = planInternalShowDesktopToggle(
    [visibleExplorer, minimizedTerminal],
    [],
    { action: "shown", affectedWindowCount: 2, restoreAvailable: true },
  );

  assert.deepEqual(plan.commands, [{ id: "explorer", action: "minimize" }]);
  assert.deepEqual(plan.nextRestoreIds, ["explorer"]);
});

test("restore returns only windows minimized by the same session", () => {
  const plan = planInternalShowDesktopToggle(
    [
      { ...visibleExplorer, minimized: true },
      minimizedTerminal,
    ],
    ["explorer"],
    { action: "restored", affectedWindowCount: 2, restoreAvailable: false },
  );

  assert.deepEqual(plan.commands, [{ id: "explorer", action: "restore" }]);
  assert.deepEqual(plan.nextRestoreIds, []);
});

test("an internal-only session can restore when the host had no external target", () => {
  const plan = planInternalShowDesktopToggle(
    [{ ...visibleExplorer, minimized: true }],
    ["explorer"],
    { action: "shown", affectedWindowCount: 0, restoreAvailable: false },
  );

  assert.deepEqual(plan.commands, [{ id: "explorer", action: "restore" }]);
});

test("a failed native restore leaves the internal session armed", () => {
  const plan = planInternalShowDesktopToggle(
    [{ ...visibleExplorer, minimized: true }],
    ["explorer"],
    { action: "restore-failed", affectedWindowCount: 0, restoreAvailable: true },
  );

  assert.deepEqual(plan.commands, []);
  assert.deepEqual(plan.nextRestoreIds, ["explorer"]);
});
