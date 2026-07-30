import assert from "node:assert/strict";
import test from "node:test";
import {
  createQuickSearchIndex,
  getQuickSearchScopeShortcut,
  isQuickSearchToggleShortcut,
  normalizeSearchText,
  parseQuickSearchQuery,
  searchQuickIndex,
  segmentSearchMatch,
} from "../src/quick-search.js";

const catalog = {
  launchItems: [
    { id: "notepad", label: "Notepad", target: "notepad.exe", priority: 80 },
    { id: "explorer", label: "File Explorer", target: "explorer.exe", priority: 100 },
  ],
  installedApplications: [{
    applicationId: "opaque-power-tools",
    label: "Power Tools",
    category: "Utilities",
    source: "start-menu",
  }],
  settingItems: [{
    id: "network",
    label: "Network",
    searchLabel: "Network settings",
    target: "ms-settings:network-status",
    priority: 70,
  }],
  windows: [{
    windowId: "0x42",
    title: "Release notes",
    processName: "notepad",
    active: false,
    minimized: true,
  }],
  desktopEntries: [{
    id: "design",
    label: "设计资料",
    kind: "directory",
    path: "C:\\Users\\Pilot\\Desktop\\设计资料",
  }],
};

test("quick search normalizes full-width text and keeps every result set bounded", () => {
  const index = createQuickSearchIndex(catalog);
  const results = searchQuickIndex([
    ...index,
    ...Array.from({ length: 30 }, (_, indexValue) => ({
      ...index[0],
      resultId: `extra:${indexValue}`,
      label: `Notepad ${indexValue}`,
    })),
  ], "ｎｏｔｅ");

  assert.equal(normalizeSearchText(" ＮＥＴＷＯＲＫ　设置 "), "network 设置");
  assert.equal(results.length, 9);
  assert.equal(results[0].label, "Notepad");
});

test("search match segments preserve labels and merge overlapping query tokens", () => {
  assert.deepEqual(segmentSearchMatch("Microsoft Edge", "edge micro"), [
    { text: "Micro", match: true },
    { text: "soft ", match: false },
    { text: "Edge", match: true },
  ]);
  assert.deepEqual(segmentSearchMatch("设计资料", "资料"), [
    { text: "设计", match: false },
    { text: "资料", match: true },
  ]);
  assert.deepEqual(segmentSearchMatch("Power Tools", "missing"), [
    { text: "Power Tools", match: false },
  ]);
});

test("quick search spans installed apps, windows, desktop entries, and settings", () => {
  const index = createQuickSearchIndex(catalog);

  assert.equal(searchQuickIndex(index, "utilities")[0].kind, "installed-app");
  assert.equal(searchQuickIndex(index, "release notes")[0].kind, "window");
  assert.equal(searchQuickIndex(index, "设计资料")[0].kind, "desktop");
  assert.equal(searchQuickIndex(index, "network settings")[0].kind, "setting");
});

test("empty Quick Access prioritizes bounded recent applications without changing explicit matches", () => {
  const index = createQuickSearchIndex({
    ...catalog,
    installedApplications: [
      catalog.installedApplications[0],
      {
        applicationId: "opaque-edge",
        label: "Microsoft Edge",
        category: "Applications",
        source: "packaged",
      },
    ],
    recentApplicationIds: [
      "",
      "x".repeat(65),
      "opaque-edge",
      "opaque-edge",
      ...Array.from({ length: 20 }, (_, index) => `overflow-${index}`),
    ],
  });

  assert.equal(searchQuickIndex(index, "")[0].application.applicationId, "opaque-edge");
  assert.equal(searchQuickIndex(index, "file explorer")[0].label, "File Explorer");
});

test("Quick Search scopes parse bounded prefixes and filter result kinds", () => {
  const index = createQuickSearchIndex(catalog);

  assert.deepEqual(parseQuickSearchQuery(" APP:  power "), {
    scope: "app",
    query: "power",
  });
  assert.deepEqual(parseQuickSearchQuery("unknown: power"), {
    scope: "all",
    query: "unknown: power",
  });
  assert.deepEqual(searchQuickIndex(index, "app: power").map((item) => item.kind), [
    "installed-app",
  ]);
  assert.deepEqual(searchQuickIndex(index, "win: release").map((item) => item.kind), [
    "window",
  ]);
  assert.deepEqual(searchQuickIndex(index, "file: 设计").map((item) => item.kind), [
    "desktop",
  ]);
  assert.deepEqual(searchQuickIndex(index, "set: network").map((item) => item.kind), [
    "setting",
  ]);
});

test("an empty scope returns only bounded quick-access results from that scope", () => {
  const index = createQuickSearchIndex(catalog);
  const windows = searchQuickIndex(index, "win:");

  assert.ok(windows.length > 0);
  assert.ok(windows.every((item) => item.kind === "window"));
});

test("Quick Search scope shortcuts accept only unmodified Ctrl or Command digits", () => {
  assert.equal(getQuickSearchScopeShortcut({ key: "1", ctrlKey: true }), "all");
  assert.equal(getQuickSearchScopeShortcut({ key: "5", metaKey: true }), "set");
  assert.equal(getQuickSearchScopeShortcut({ key: "6", ctrlKey: true }), null);
  assert.equal(getQuickSearchScopeShortcut({ key: "2", ctrlKey: true, shiftKey: true }), null);
  assert.equal(getQuickSearchScopeShortcut({ key: "3", altKey: true, ctrlKey: true }), null);
  assert.equal(getQuickSearchScopeShortcut({ key: "4" }), null);
});

test("Quick Search toggle yields to active controls and rejects modified variants", () => {
  assert.equal(isQuickSearchToggleShortcut({
    code: "Space",
    ctrlKey: true,
  }), true);
  assert.equal(isQuickSearchToggleShortcut({
    code: "Space",
    metaKey: true,
  }), true);
  assert.equal(isQuickSearchToggleShortcut({
    code: "Space",
    ctrlKey: true,
    defaultPrevented: true,
  }), false);
  assert.equal(isQuickSearchToggleShortcut({
    code: "Space",
    ctrlKey: true,
    shiftKey: true,
  }), false);
  assert.equal(isQuickSearchToggleShortcut({
    code: "Space",
    ctrlKey: true,
    altKey: true,
  }), false);
});
