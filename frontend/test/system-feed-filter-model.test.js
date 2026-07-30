import assert from "node:assert/strict";
import test from "node:test";
import {
  filterSystemFeed,
  getSystemFeedFilterShortcut,
  getSystemFeedFilterSummary,
  normalizeSystemFeedFilter,
} from "../src/system-feed-filter-model.js";

const items = [
  { id: "1", severity: "ok", title: "Runtime ready", detail: "All systems nominal", unread: false },
  { id: "2", severity: "warning", title: "Network offline", detail: "Adapter unavailable", unread: true },
  { id: "3", severity: "error", title: "Audio failed", detail: "Device missing", unread: true },
  { id: "4", severity: "info", title: "Window opened", detail: "Editor", unread: false },
];

test("System Feed severity filters separate attention from status events", () => {
  assert.equal(normalizeSystemFeedFilter("unknown"), "all");
  assert.deepEqual(
    filterSystemFeed(items, { filter: "attention" }).map((item) => item.id),
    ["2", "3"],
  );
  assert.deepEqual(
    filterSystemFeed(items, { filter: "status" }).map((item) => item.id),
    ["1", "4"],
  );
  assert.deepEqual(
    filterSystemFeed(items, { filter: "unread" }).map((item) => item.id),
    ["2", "3"],
  );
});

test("System Feed filter shortcuts accept only bounded Ctrl or Command digits", () => {
  assert.equal(getSystemFeedFilterShortcut({ key: "1", ctrlKey: true }), "all");
  assert.equal(getSystemFeedFilterShortcut({ key: "2", metaKey: true }), "unread");
  assert.equal(getSystemFeedFilterShortcut({ key: "4", ctrlKey: true }), "status");
  assert.equal(getSystemFeedFilterShortcut({ key: "5", ctrlKey: true }), null);
  assert.equal(getSystemFeedFilterShortcut({ key: "3", ctrlKey: true, shiftKey: true }), null);
  assert.equal(getSystemFeedFilterShortcut({ key: "2" }), null);
});

test("System Feed text search is normalized, bounded, and combines with severity", () => {
  assert.deepEqual(
    filterSystemFeed(items, { filter: "attention", query: " ＮＥＴＷＯＲＫ " })
      .map((item) => item.id),
    ["2"],
  );
  assert.deepEqual(filterSystemFeed(items, { query: "missing" }).map((item) => item.id), ["3"]);
});

test("System Feed summaries report filtered and visible-unread counts truthfully", () => {
  assert.deepEqual(getSystemFeedFilterSummary(items, items.slice(1, 3)), {
    total: 4,
    visible: 2,
    visibleUnread: 2,
    label: "2 OF 4 EVENTS",
  });
});
