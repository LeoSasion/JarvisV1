import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWorkspaceRuntime } from "../src/workspace-runtime-channel.js";

test("workspace runtime channel accepts only registered windows and bounded fields", () => {
  const windows = normalizeWorkspaceRuntime({
    version: 1,
    windows: [
      {
        internalWindowId: "explorer",
        taskbarItemId: "builtin:explorer",
        title: `Explorer\u0000${"x".repeat(200)}`,
        processName: "jarvis-explorer<script>",
        active: true,
        minimized: false,
      },
      {
        internalWindowId: "unknown",
        title: "Untrusted",
      },
      {
        internalWindowId: "explorer",
        title: "Duplicate",
      },
    ],
  });

  assert.equal(windows.length, 1);
  assert.equal(windows[0].windowId, "jarvis:explorer");
  assert.equal(windows[0].active, true);
  assert.equal(windows[0].title.includes("\u0000"), false);
  assert.ok(windows[0].title.length <= 128);
  assert.equal(windows[0].processName.includes("<"), false);
});

test("workspace runtime channel rejects stale schemas", () => {
  assert.deepEqual(normalizeWorkspaceRuntime(null), []);
  assert.deepEqual(normalizeWorkspaceRuntime({ version: 2, windows: [] }), []);
  assert.deepEqual(normalizeWorkspaceRuntime({ version: 1, windows: {} }), []);
});
