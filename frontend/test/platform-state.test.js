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

test("mock tray rejects out-of-range volume and emits real snapshots", async () => {
  const mock = createMockPlatform();
  await assert.rejects(() => mock.tray.setVolume(101), /between 0 and 100/u);
  const changed = await mock.tray.setVolume(50);
  assert.equal(changed.audio.volumePercent, 50);
  assert.equal(changed.simulation, true);
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
