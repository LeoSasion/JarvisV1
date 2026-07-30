import assert from "node:assert/strict";
import test from "node:test";
import {
  clearQuickSearchHistory,
  getQuickSearchHistory,
  normalizeQuickSearchHistory,
  recordQuickSearchQuery,
} from "../src/quick-search-history.js";

test("Quick Search history rejects corrupt, empty, duplicate, and oversized entries", () => {
  assert.deepEqual(normalizeQuickSearchHistory(null), []);
  assert.deepEqual(normalizeQuickSearchHistory({
    version: 1,
    queries: [
      "app: Edge",
      " APP: edge ",
      "win: Release notes",
      "",
      42,
      ...Array.from({ length: 20 }, (_, index) => `query ${index}`),
    ],
  }), [
    "app: Edge",
    "win: Release notes",
    ...Array.from({ length: 6 }, (_, index) => `query ${index}`),
  ]);
});

test("recording query history is most-recent-first and versioned", () => {
  const writes = [];
  global.window = {
    localStorage: {
      setItem: (key, value) => writes.push([key, value]),
    },
  };
  recordQuickSearchQuery("set: Network");
  recordQuickSearchQuery("app: Edge");
  recordQuickSearchQuery("SET: network");
  recordQuickSearchQuery("win:");

  assert.deepEqual(getQuickSearchHistory().slice(0, 2), [
    "SET: network",
    "app: Edge",
  ]);
  assert.match(writes.at(-1)[1], /"version":1/);
  assert.equal(clearQuickSearchHistory(), true);
  assert.deepEqual(getQuickSearchHistory(), []);
  assert.equal(clearQuickSearchHistory(), false);
  assert.match(writes.at(-1)[1], /"queries":\[\]/);
  delete global.window;
});
