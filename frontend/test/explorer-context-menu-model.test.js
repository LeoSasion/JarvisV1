import assert from "node:assert/strict";
import test from "node:test";
import {
  getExplorerContextMenuActions,
  getExplorerContextMenuEstimatedHeight,
  getExplorerContextMenuKeyboardTarget,
  getExplorerContextMenuPosition,
  isExplorerContextMenuTrigger,
  resolveExplorerContextSelection,
} from "../src/explorer-context-menu-model.js";

test("Explorer context selection preserves an existing multi-selection", () => {
  assert.deepEqual(
    resolveExplorerContextSelection(["C:\\a.txt", "C:\\b.txt"], "C:\\b.txt"),
    ["C:\\a.txt", "C:\\b.txt"],
  );
  assert.deepEqual(
    resolveExplorerContextSelection(["C:\\a.txt", "C:\\b.txt"], "C:\\c.txt"),
    ["C:\\c.txt"],
  );
  assert.deepEqual(resolveExplorerContextSelection(["C:\\a.txt"], null), []);
});

test("item context actions preserve single and multi-selection boundaries", () => {
  const single = getExplorerContextMenuActions({
    kind: "item",
    selectionCount: 1,
  });
  assert.equal(single.find((action) => action.id === "open").disabled, false);
  assert.equal(single.find((action) => action.id === "properties").disabled, false);

  const multiple = getExplorerContextMenuActions({
    kind: "item",
    selectionCount: 3,
    transferActive: true,
  });
  assert.equal(multiple.find((action) => action.id === "open").disabled, true);
  assert.equal(multiple.find((action) => action.id === "copy-path").disabled, false);
  assert.equal(multiple.find((action) => action.id === "recycle").disabled, true);
});

test("background context actions reflect clipboard and transfer readiness", () => {
  const actions = getExplorerContextMenuActions({
    kind: "background",
    hasCurrentPath: true,
    canPaste: false,
    transferActive: true,
  });
  assert.equal(actions.find((action) => action.id === "new-folder").disabled, true);
  assert.equal(actions.find((action) => action.id === "paste").disabled, true);
  assert.equal(actions.find((action) => action.id === "refresh").disabled, false);
  assert.equal(actions.find((action) => action.id === "open-in-windows").disabled, false);
});

test("context menu positioning remains inside the viewport", () => {
  const actions = getExplorerContextMenuActions({
    kind: "item",
    selectionCount: 1,
  });
  const height = getExplorerContextMenuEstimatedHeight(actions);
  assert.deepEqual(getExplorerContextMenuPosition({
    clientX: 2_540,
    clientY: 1_420,
    viewportWidth: 2_560,
    viewportHeight: 1_440,
    menuHeight: height,
  }), {
    x: 2_280,
    y: 1_056,
  });
  assert.deepEqual(getExplorerContextMenuPosition({
    clientX: -100,
    clientY: -40,
    viewportWidth: 1_024,
    viewportHeight: 720,
    menuHeight: height,
  }), {
    x: 8,
    y: 8,
  });
});

test("Context Menu and Shift F10 are the only keyboard triggers", () => {
  assert.equal(isExplorerContextMenuTrigger({ key: "ContextMenu" }), true);
  assert.equal(isExplorerContextMenuTrigger({ key: "F10", shiftKey: true }), true);
  assert.equal(isExplorerContextMenuTrigger({ key: "F10" }), false);
  assert.equal(isExplorerContextMenuTrigger({ key: "F10", shiftKey: true, ctrlKey: true }), false);
});

test("context menu arrows skip disabled actions and wrap", () => {
  const actions = [
    { id: "open", disabled: false },
    { id: "rename", disabled: true },
    { id: "copy", disabled: false },
  ];
  assert.equal(getExplorerContextMenuKeyboardTarget(actions, 0, "ArrowDown"), 2);
  assert.equal(getExplorerContextMenuKeyboardTarget(actions, 2, "ArrowDown"), 0);
  assert.equal(getExplorerContextMenuKeyboardTarget(actions, 0, "ArrowUp"), 2);
  assert.equal(getExplorerContextMenuKeyboardTarget(actions, 2, "Home"), 0);
  assert.equal(getExplorerContextMenuKeyboardTarget(actions, 0, "End"), 2);
});
