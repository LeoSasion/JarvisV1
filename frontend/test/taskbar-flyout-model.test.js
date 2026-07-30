import assert from "node:assert/strict";
import test from "node:test";
import {
  filterTaskbarFlyoutEntries,
  getTaskbarFlyoutKeyboardTarget,
  getTaskbarOverflowSummary,
  normalizeTaskbarFlyoutQuery,
} from "../src/taskbar-flyout-model.js";

const entries = [
  {
    key: "edge",
    label: "Microsoft Edge",
    meta: "Research",
    searchText: "Microsoft Edge Research msedge",
    window: { windowId: "1" },
    item: { isPinned: true, windows: [{ windowId: "1" }] },
  },
  {
    key: "notes",
    label: "Notepad",
    meta: "PINNED APPLICATION",
    item: { isPinned: true, windows: [] },
  },
  {
    key: "paint",
    label: "Paint",
    meta: "RUNNING APPLICATION",
    window: { windowId: "2" },
    item: { isPinned: false, windows: [{ windowId: "2" }] },
  },
];

test("taskbar overflow queries are normalized and bounded", () => {
  assert.equal(normalizeTaskbarFlyoutQuery("  ＥＤＧＥ  "), "edge");
  assert.equal(normalizeTaskbarFlyoutQuery("x".repeat(90)).length, 64);
  assert.equal(filterTaskbarFlyoutEntries(entries, "research")[0].key, "edge");
  assert.deepEqual(filterTaskbarFlyoutEntries(entries, "missing"), []);
  assert.equal(filterTaskbarFlyoutEntries(entries, "").length, 3);
});

test("taskbar flyout keyboard navigation wraps and supports boundaries", () => {
  assert.equal(getTaskbarFlyoutKeyboardTarget(4, 0, "ArrowUp"), 3);
  assert.equal(getTaskbarFlyoutKeyboardTarget(4, 3, "ArrowDown"), 0);
  assert.equal(getTaskbarFlyoutKeyboardTarget(4, 2, "Home"), 0);
  assert.equal(getTaskbarFlyoutKeyboardTarget(4, 1, "End"), 3);
  assert.equal(getTaskbarFlyoutKeyboardTarget(0, 0, "ArrowDown"), -1);
});

test("taskbar overflow summary separates visible, running, and pinned counts", () => {
  assert.deepEqual(getTaskbarOverflowSummary(entries, entries.slice(0, 1)), {
    total: 3,
    visible: 1,
    running: 2,
    pinned: 2,
    label: "1/3 APPS · 2 RUNNING · 2 PINNED",
  });
});
