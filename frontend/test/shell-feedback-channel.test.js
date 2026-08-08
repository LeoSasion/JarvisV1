import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeStoredShellFeedback,
  normalizeShellFeedbackPayload,
  SHELL_FEEDBACK_STORAGE_KEY,
} from "../src/shell-feedback-channel.js";

test("cross-surface feedback accepts only the versioned bounded shape", () => {
  assert.deepEqual(normalizeShellFeedbackPayload({
    version: 1,
    nonce: "fault-1",
    source: "taskbar",
    severity: "error",
    title: "Unable to toggle desktop",
    detail: "Native operation failed",
    timestamp: "2026-08-08T00:00:00.000Z",
  }), {
    id: "fault-1",
    source: "taskbar",
    severity: "error",
    title: "Unable to toggle desktop",
    detail: "Native operation failed",
    timestamp: "2026-08-08T00:00:00.000Z",
    persistent: true,
  });
  assert.equal(normalizeShellFeedbackPayload({ version: 2, nonce: "fault", title: "Wrong version" }), null);
  assert.equal(normalizeShellFeedbackPayload({ version: 1, nonce: "fault", title: "" }), null);
});

test("stored cross-surface feedback is replayed once and acknowledged", () => {
  const values = new Map([[SHELL_FEEDBACK_STORAGE_KEY, JSON.stringify({
    version: 1,
    nonce: "fault-before-mount",
    source: "taskbar",
    severity: "error",
    title: "Unable to toggle desktop",
  })]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
  };

  assert.equal(consumeStoredShellFeedback(storage)?.id, "fault-before-mount");
  assert.equal(values.has(SHELL_FEEDBACK_STORAGE_KEY), false);
  assert.equal(consumeStoredShellFeedback(storage), null);
});
