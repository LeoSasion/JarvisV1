import assert from "node:assert/strict";
import test from "node:test";
import {
  filterTaskbarFlyoutEntries,
  getNativeInternalWindowItems,
  getNativeTaskbarOverflowPayload,
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

test("native overflow preserves grouped taskbar order across host and renderer items", () => {
  const payload = getNativeTaskbarOverflowPayload([
    {
      id: "external",
      label: "External",
      windows: [{ windowId: "native:1" }, { windowId: "native:1" }],
    },
    {
      id: "pinned",
      label: "Pinned\u0000 Tool",
      isPinned: true,
      windows: [],
    },
    {
      id: "internal",
      label: "Agent",
      selectedWindow: { windowId: "internal:agent", internalWindowId: "agent", active: true },
      windows: [{ windowId: "internal:agent", internalWindowId: "agent", active: true }],
    },
  ]);

  assert.deepEqual(payload.windowIds, ["native:1"]);
  assert.deepEqual(payload.items.map((item) => item.itemId), ["external", "pinned", "internal"]);
  assert.equal(payload.items[0].windowId, "native:1");
  assert.equal(payload.items[0].label, "External");
  assert.equal(payload.items[1].label, "Pinned Tool");
  assert.equal(payload.items[1].meta, "PINNED APPLICATION");
  assert.equal(payload.items[2].windowId, "internal:agent");
});

test("native internal groups preserve the selected renderer window identifier", () => {
  const items = getNativeInternalWindowItems({
    id: "agent",
    label: "Agent",
    windows: [
      { windowId: "internal:1", title: "Session 1", internalWindowId: "agent", active: true },
      { windowId: "internal:2", title: "Session 2", internalWindowId: "agent", minimized: true },
    ],
  });

  assert.deepEqual(items.map((item) => item.windowId), ["internal:1", "internal:2"]);
  assert.match(items[1].meta, /MINIMIZED/u);
});
