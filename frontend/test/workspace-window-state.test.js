import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKSPACE_LAYOUT_VERSION,
  constrainWindowBounds,
  createWorkspaceWindowState,
  getWorkspaceTaskbarWindows,
  serializeWorkspaceLayout,
  workspaceWindowReducer,
} from "../src/workspace-window-state.js";

const viewport = {
  width: 1920,
  height: 1080,
  top: 78,
  right: 12,
  bottom: 86,
  left: 12,
};

function reduce(state, type, id, extra = {}) {
  return workspaceWindowReducer(state, { type, id, ...extra });
}

test("opening windows activates them and advances the shared z-order", () => {
  let state = createWorkspaceWindowState(viewport);
  state = reduce(state, "OPEN", "explorer");
  const explorerZ = state.windows.explorer.zIndex;
  state = reduce(state, "OPEN", "terminal");

  assert.equal(state.activeId, "terminal");
  assert.equal(state.windows.terminal.open, true);
  assert.ok(state.windows.terminal.zIndex > explorerZ);

  state = reduce(state, "ACTIVATE", "explorer");
  assert.equal(state.activeId, "explorer");
  assert.ok(state.windows.explorer.zIndex > state.windows.terminal.zIndex);
});

test("minimizing or closing the active window activates the highest visible window", () => {
  let state = createWorkspaceWindowState(viewport);
  state = reduce(state, "OPEN", "explorer");
  state = reduce(state, "OPEN", "terminal");
  state = reduce(state, "OPEN", "inspector");

  state = reduce(state, "MINIMIZE", "inspector");
  assert.equal(state.activeId, "terminal");
  assert.equal(state.windows.inspector.open, true);
  assert.equal(state.windows.inspector.minimized, true);

  state = reduce(state, "CLOSE", "terminal");
  assert.equal(state.activeId, "explorer");
  assert.equal(state.windows.terminal.open, false);
});

test("taskbar toggle follows Windows restore and minimize behavior", () => {
  let state = createWorkspaceWindowState(viewport);
  state = reduce(state, "TASKBAR_TOGGLE", "explorer");
  assert.equal(state.windows.explorer.open, true);
  assert.equal(state.windows.explorer.minimized, false);

  state = reduce(state, "TASKBAR_TOGGLE", "explorer");
  assert.equal(state.windows.explorer.minimized, true);
  assert.equal(state.activeId, null);

  state = reduce(state, "TASKBAR_TOGGLE", "explorer");
  assert.equal(state.windows.explorer.minimized, false);
  assert.equal(state.activeId, "explorer");
});

test("maximize preserves a restorable bound and reflow constrains both layouts", () => {
  let state = createWorkspaceWindowState(viewport);
  state = reduce(state, "OPEN", "terminal");
  const original = state.windows.terminal.bounds;
  state = reduce(state, "TOGGLE_MAXIMIZE", "terminal");

  assert.equal(state.windows.terminal.maximized, true);
  assert.deepEqual(state.windows.terminal.restoreBounds, original);

  state = workspaceWindowReducer(state, {
    type: "REFLOW",
    viewport: { ...viewport, width: 1366, height: 768 },
  });
  state = reduce(state, "TOGGLE_MAXIMIZE", "terminal");

  assert.equal(state.windows.terminal.maximized, false);
  assert.ok(state.windows.terminal.bounds.x >= 12);
  assert.ok(state.windows.terminal.bounds.y >= 78);
  assert.ok(state.windows.terminal.bounds.x + state.windows.terminal.bounds.width <= 1354);
  assert.ok(state.windows.terminal.bounds.y + state.windows.terminal.bounds.height <= 682);
});

test("bounds reject non-finite and off-screen persisted values", () => {
  const bounds = constrainWindowBounds("inspector", {
    x: -99999,
    y: Number.NaN,
    width: Number.POSITIVE_INFINITY,
    height: 10,
  }, viewport);

  assert.equal(bounds.x, 12);
  assert.ok(bounds.y >= 78);
  assert.ok(bounds.width >= 600);
  assert.ok(bounds.height >= 420);
  assert.ok(bounds.x + bounds.width <= 1908);
});

test("layout persistence excludes open state and rejects stale versions", () => {
  let state = createWorkspaceWindowState(viewport);
  state = reduce(state, "OPEN", "explorer");
  state = reduce(state, "TOGGLE_MAXIMIZE", "explorer");
  const serialized = serializeWorkspaceLayout(state);

  assert.equal(serialized.version, WORKSPACE_LAYOUT_VERSION);
  assert.equal("open" in serialized.windows.explorer, false);
  assert.equal("minimized" in serialized.windows.explorer, false);

  const restored = createWorkspaceWindowState(viewport, serialized);
  assert.equal(restored.windows.explorer.open, false);
  assert.equal(restored.windows.explorer.maximized, true);

  const stale = createWorkspaceWindowState(viewport, {
    ...serialized,
    version: WORKSPACE_LAYOUT_VERSION + 1,
    windows: {
      explorer: {
        bounds: { x: 9999, y: 9999, width: 1, height: 1 },
        maximized: true,
      },
    },
  });
  assert.equal(stale.windows.explorer.maximized, false);
});

test("taskbar snapshots expose only open internal windows", () => {
  let state = createWorkspaceWindowState(viewport);
  state = reduce(state, "OPEN", "explorer");
  state = reduce(state, "OPEN", "inspector");
  state = reduce(state, "MINIMIZE", "inspector");
  const windows = getWorkspaceTaskbarWindows(state);

  assert.deepEqual(windows.map((windowState) => windowState.internalWindowId), [
    "explorer",
    "inspector",
  ]);
  assert.equal(windows[0].active, true);
  assert.equal(windows[1].minimized, true);
});
