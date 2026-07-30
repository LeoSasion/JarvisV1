import assert from "node:assert/strict";
import test from "node:test";
import {
  clearRecentApplications,
  getRecentApplicationIds,
  normalizeRecentApplicationIds,
  recordRecentApplication,
} from "../src/recent-applications.js";

test("recent application payloads are versioned, deduplicated, and bounded", () => {
  assert.deepEqual(normalizeRecentApplicationIds(null), []);
  assert.deepEqual(normalizeRecentApplicationIds({ version: 2, applicationIds: ["a"] }), []);
  assert.deepEqual(normalizeRecentApplicationIds({
    version: 1,
    applicationIds: [
      "a",
      "",
      "a",
      42,
      "x".repeat(65),
      ...Array.from({ length: 20 }, (_, index) => `app-${index}`),
    ],
  }), ["a", ...Array.from({ length: 11 }, (_, index) => `app-${index}`)]);
});

test("recent applications can be cleared without retaining launch data", () => {
  const writes = [];
  global.window = {
    localStorage: {
      setItem: (key, value) => writes.push([key, value]),
    },
  };
  recordRecentApplication("opaque-app");
  assert.deepEqual(getRecentApplicationIds(), ["opaque-app"]);
  clearRecentApplications();
  assert.deepEqual(getRecentApplicationIds(), []);
  assert.match(writes.at(-1)[1], /"applicationIds":\[\]/);
  delete global.window;
});
