import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeStoredShellFeedback,
  normalizeShellFeedbackPayload,
  SHELL_FEEDBACK_STORAGE_KEY,
  subscribeShellFeedback,
} from "../src/shell-feedback-channel.js";

function createWindowHarness(initialRaw = null) {
  const values = new Map();
  if (initialRaw !== null) values.set(SHELL_FEEDBACK_STORAGE_KEY, initialRaw);
  const listeners = new Map();
  const window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => values.delete(key),
    },
    addEventListener(eventName, listener) {
      const eventListeners = listeners.get(eventName) ?? new Set();
      eventListeners.add(listener);
      listeners.set(eventName, eventListeners);
    },
    removeEventListener(eventName, listener) {
      listeners.get(eventName)?.delete(listener);
    },
  };
  return {
    values,
    window,
    emit(eventName, event) {
      listeners.get(eventName)?.forEach((listener) => listener(event));
    },
  };
}

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

test("subscription replays a pre-mount fault once and acknowledges it", () => {
  const storedRaw = JSON.stringify({
    version: 1,
    nonce: "fault-before-mount",
    source: "taskbar",
    severity: "error",
    title: "Unable to toggle desktop",
  });
  const harness = createWindowHarness(storedRaw);
  const originalWindow = globalThis.window;
  const received = [];
  globalThis.window = harness.window;

  try {
    const unsubscribe = subscribeShellFeedback((feedback) => received.push(feedback.id));
    assert.deepEqual(received, ["fault-before-mount"]);
    assert.equal(harness.values.has(SHELL_FEEDBACK_STORAGE_KEY), false);

    harness.emit("storage", { key: SHELL_FEEDBACK_STORAGE_KEY, newValue: storedRaw });
    assert.deepEqual(received, ["fault-before-mount"]);
    unsubscribe();
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("acknowledging an older storage event does not delete a newer fault", () => {
  const olderRaw = JSON.stringify({
    version: 1,
    nonce: "older-fault",
    source: "taskbar",
    severity: "error",
    title: "Unable to show preview",
  });
  const newerRaw = JSON.stringify({
    version: 1,
    nonce: "newer-fault",
    source: "taskbar",
    severity: "error",
    title: "Unable to toggle desktop",
  });
  const harness = createWindowHarness();
  const originalWindow = globalThis.window;
  const received = [];
  globalThis.window = harness.window;

  try {
    const unsubscribe = subscribeShellFeedback((feedback) => received.push(feedback.id));
    harness.values.set(SHELL_FEEDBACK_STORAGE_KEY, newerRaw);
    harness.emit("storage", { key: SHELL_FEEDBACK_STORAGE_KEY, newValue: olderRaw });
    assert.equal(harness.values.get(SHELL_FEEDBACK_STORAGE_KEY), newerRaw);

    harness.emit("storage", { key: SHELL_FEEDBACK_STORAGE_KEY, newValue: newerRaw });
    assert.deepEqual(received, ["older-fault", "newer-fault"]);
    assert.equal(harness.values.has(SHELL_FEEDBACK_STORAGE_KEY), false);

    harness.emit("storage", { key: SHELL_FEEDBACK_STORAGE_KEY, newValue: olderRaw });
    assert.deepEqual(received, ["older-fault", "newer-fault"]);
    unsubscribe();
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
