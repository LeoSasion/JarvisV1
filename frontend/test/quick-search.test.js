import assert from "node:assert/strict";
import test from "node:test";
import { getGlobalQuickSearchAction } from "../src/global-quick-search-model.js";
import { createQuickSearchIndex, normalizeSearchText, searchQuickIndex } from "../src/quick-search.js";

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

test("quick search spans installed apps, windows, desktop entries, and settings", () => {
  const index = createQuickSearchIndex(catalog);

  assert.equal(searchQuickIndex(index, "utilities")[0].kind, "installed-app");
  assert.equal(searchQuickIndex(index, "release notes")[0].kind, "window");
  assert.equal(searchQuickIndex(index, "设计资料")[0].kind, "desktop");
  assert.equal(searchQuickIndex(index, "network settings")[0].kind, "setting");
});

test("global actions preserve opaque capabilities and JARVIS-owned panels", () => {
  assert.deepEqual(getGlobalQuickSearchAction({
    kind: "installed-app",
    application: { applicationId: "opaque-application" },
  }), {
    type: "open-application",
    applicationId: "opaque-application",
  });
  assert.deepEqual(getGlobalQuickSearchAction({
    kind: "window",
    window: { windowId: "0x42", active: false, minimized: true },
  }), {
    type: "activate-window",
    windowId: "0x42",
  });
  assert.deepEqual(getGlobalQuickSearchAction({
    kind: "desktop",
    entry: { kind: "directory", path: "C:\\Users\\Pilot\\Desktop\\Projects" },
  }), {
    type: "show-desktop",
    panel: "explorer",
  });
  assert.deepEqual(getGlobalQuickSearchAction({
    kind: "app",
    target: "jarvis-terminal:",
  }), {
    type: "show-desktop",
    panel: "terminal",
  });
});

test("an already-active window dismisses back to the captured foreground app", () => {
  assert.deepEqual(getGlobalQuickSearchAction({
    kind: "window",
    window: { windowId: "0x42", active: true, minimized: false },
  }), {
    type: "dismiss",
    restoreForeground: true,
  });
  assert.equal(getGlobalQuickSearchAction({ kind: "installed-app", application: {} }), null);
});
