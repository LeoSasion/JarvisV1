import assert from "node:assert/strict";
import test from "node:test";
import {
  getDesktopFallbackPosition,
} from "../src/desktop-layout.js";
import {
  normalizeSystemFeed,
  normalizeTraySnapshot,
} from "../src/hooks/usePlatformData.js";
import { createMockPlatform } from "../src/platform/mock-platform.js";
import { createWindowsPlatform } from "../src/platform/windows-platform.js";
import {
  partitionWindowsByPinnedApplications,
  reconcileRunningTaskbarOrder,
} from "../src/taskbar-grouping.js";

test("tray snapshots clamp Windows volume and preserve unavailable state", () => {
  const snapshot = normalizeTraySnapshot({
    audio: { available: true, volumePercent: 143, muted: true },
    network: { isAvailable: true },
    power: { batteryPresent: true, percentage: 25 },
  });
  assert.equal(snapshot.audio.volumePercent, 100);
  assert.equal(snapshot.audio.muted, true);

  const unavailable = normalizeTraySnapshot({
    audio: { available: false, volumePercent: null },
  });
  assert.equal(unavailable.audio.volumePercent, null);
});

test("system feed is bounded and derives a safe unread count", () => {
  const items = Array.from({ length: 60 }, (_, index) => ({
    id: `item-${index}`,
    title: `Event ${index}`,
    unread: index < 7,
  }));
  const snapshot = normalizeSystemFeed({ items, unreadCount: 900, capacity: 50 });
  assert.equal(snapshot.items.length, 50);
  assert.equal(snapshot.unreadCount, 50);
});

test("mock renderer faults are platform-owned, emitted, and deduplicated", async () => {
  const mock = createMockPlatform();
  const before = await mock.feed.getSnapshot();
  const emitted = [];
  const unsubscribe = mock.events.subscribe("feed.snapshot", (snapshot) => emitted.push(snapshot));
  const startedAt = Date.now();
  const fault = {
    source: " SHELL ",
    severity: " WARNING ",
    title: " Renderer could not refresh ",
    detail: " Native shell data is temporarily unavailable. ",
    actionId: " OPEN-RUNTIME-SETTINGS ",
  };

  const first = await mock.feed.reportFault(fault);
  const finishedAt = Date.now();
  const item = first.items[0];
  assert.equal(first.items.length, before.items.length + 1);
  assert.equal(first.unreadCount, before.unreadCount + 1);
  assert.match(item.id, /^mock-renderer-fault-\d+-\d+$/u);
  assert.equal(item.type, "renderer.shell.fault");
  assert.equal(item.severity, "warning");
  assert.equal(item.title, "Renderer could not refresh");
  assert.equal(item.detail, "Native shell data is temporarily unavailable.");
  assert.equal(item.actionId, "open-runtime-settings");
  assert.equal(item.unread, true);
  assert.ok(Date.parse(item.timestamp) >= startedAt);
  assert.ok(Date.parse(item.timestamp) <= finishedAt);

  const duplicate = await mock.feed.reportFault(fault);
  unsubscribe();
  assert.equal(duplicate.items.length, first.items.length);
  assert.equal(duplicate.items[0].id, item.id);
  assert.equal(emitted.length, 1);
});

test("mock renderer faults reject unsafe fields and unbounded values", async () => {
  const mock = createMockPlatform();
  const baseFault = {
    source: "shell",
    severity: "error",
    title: "Renderer fault",
  };
  const invalidFaults = [
    [{ ...baseFault, severity: "info" }, /warning or error/u],
    [{ ...baseFault, source: "untrusted" }, /source 'untrusted' is not supported/u],
    [{ ...baseFault, actionId: "retry" }, /action 'retry' is not supported/u],
    [{ ...baseFault, title: "x".repeat(161) }, /must not exceed 160/u],
    [{ ...baseFault, detail: "x".repeat(321) }, /must not exceed 320/u],
    [{ ...baseFault, detail: "line\nbreak" }, /control characters/u],
    [{ ...baseFault, command: "powershell.exe" }, /does not accept params.command/u],
    [{ ...baseFault, path: "C:\\Windows" }, /does not accept params.path/u],
    [{ ...baseFault, id: "caller-owned" }, /does not accept params.id/u],
    [{ ...baseFault, unread: false }, /does not accept params.unread/u],
    [{ ...baseFault, timestamp: "2000-01-01T00:00:00Z" }, /does not accept params.timestamp/u],
  ];

  for (const [fault, pattern] of invalidFaults) {
    await assert.rejects(() => mock.feed.reportFault(fault), pattern);
  }
});

test("Windows renderer fault requests forward only the typed data contract", async () => {
  const originalWindow = globalThis.window;
  const requests = [];
  let messageListener = null;
  const webview = {
    addEventListener(eventName, listener) {
      if (eventName === "message") messageListener = listener;
    },
    postMessage(request) {
      requests.push(request);
      globalThis.queueMicrotask(() => messageListener({
        data: {
          id: request.id,
          ok: true,
          result: { items: [], unreadCount: 0, capacity: 50 },
        },
      }));
    },
  };
  globalThis.window = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };

  try {
    const platform = createWindowsPlatform(webview);
    await platform.feed.reportFault({
      source: "shell",
      severity: "error",
      title: "Renderer fault",
      command: "powershell.exe",
      path: "C:\\Windows",
      id: "caller-owned",
      unread: false,
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "feed.reportFault");
    assert.deepEqual(requests[0].params, {
      source: "shell",
      severity: "error",
      title: "Renderer fault",
      detail: null,
      actionId: null,
    });
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("mock tray rejects out-of-range volume and emits real snapshots", async () => {
  const mock = createMockPlatform();
  await assert.rejects(() => mock.tray.setVolume(101), /between 0 and 100/u);
  const changed = await mock.tray.setVolume(50);
  assert.equal(changed.audio.volumePercent, 50);
  assert.equal(changed.simulation, true);
});

test("mock Show Desktop restores only the windows from the active session", async () => {
  const mock = createMockPlatform();
  const before = await mock.taskbar.getSnapshot();
  const originallyVisibleIds = before.windows
    .filter((window) => !window.minimized)
    .map((window) => window.windowId);

  const shown = await mock.taskbar.toggleDesktop();
  assert.equal(shown.action, "shown");
  assert.equal(shown.affectedWindowCount, originallyVisibleIds.length);
  const minimized = await mock.taskbar.getSnapshot();
  assert.equal(minimized.windows
    .filter((window) => originallyVisibleIds.includes(window.windowId))
    .every((window) => window.minimized), true);

  const restored = await mock.taskbar.toggleDesktop();
  assert.equal(restored.action, "restored");
  const after = await mock.taskbar.getSnapshot();
  assert.equal(after.windows
    .filter((window) => originallyVisibleIds.includes(window.windowId))
    .every((window) => !window.minimized), true);
});

test("mock session actions require a matching single-use confirmation", async () => {
  const mock = createMockPlatform();
  const state = await mock.session.getState();
  assert.deepEqual(
    state.actions.map((action) => action.id),
    ["lock", "sign-out", "restart", "shut-down"],
  );

  const challenge = await mock.session.prepare("restart");
  const result = await mock.session.commit(challenge.actionId, challenge.token);
  assert.equal(result.accepted, true);
  assert.equal(result.mock, true);
  await assert.rejects(
    () => mock.session.commit(challenge.actionId, challenge.token),
    /confirmation expired/u,
  );
});

test("desktop icons fill down before starting the next column", () => {
  assert.deepEqual(getDesktopFallbackPosition(0, 300), { x: 18, y: 18 });
  assert.deepEqual(getDesktopFallbackPosition(4, 300), { x: 114, y: 106 });
});

test("taskbar grouping consumes pinned matches and preserves running order", () => {
  const windows = [
    { windowId: "1", processName: "notepad.exe", applicationId: null },
    { windowId: "2", processName: "msedge.exe", applicationId: "edge" },
  ];
  const applications = [
    { applicationId: "edge", processes: ["msedge"] },
    { applicationId: null, processes: ["notepad"] },
  ];
  const grouped = partitionWindowsByPinnedApplications(windows, applications);
  assert.deepEqual(grouped.matchedWindowsByApplication.map((items) => items.length), [1, 1]);
  assert.deepEqual(reconcileRunningTaskbarOrder(["old", "1"], ["1", "2"]), ["1", "2"]);
});
