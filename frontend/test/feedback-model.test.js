import assert from "node:assert/strict";
import test from "node:test";
import {
  appendFeedbackEvent,
  createShellFeedback,
  mergeSystemFeedEvents,
  selectFeedbackNotice,
} from "../src/feedback-model.js";

test("serious feedback persists and keeps only real actions", () => {
  const retry = () => {};
  const feedback = createShellFeedback({
    source: "taskbar",
    severity: "error",
    title: "Unable to switch window",
    detail: "Native activation failed",
    actions: [
      { label: "RETRY", onInvoke: retry },
      { label: "INVALID" },
    ],
  }, { timestamp: "2026-08-08T00:00:00.000Z" });

  assert.equal(feedback.persistent, true);
  assert.equal(feedback.timeoutMs, null);
  assert.equal(feedback.source, "taskbar");
  assert.deepEqual(feedback.actions, [{ label: "RETRY", onInvoke: retry }]);
});

test("legacy English and Chinese failures are promoted while confirmations remain transient", () => {
  assert.equal(createShellFeedback("Unable to open application").severity, "error");
  assert.equal(createShellFeedback("Windows 剪贴板暂时不可用").severity, "error");
  assert.equal(createShellFeedback("1 completed · 1 failed").severity, "error");
  assert.equal(createShellFeedback("1 completed · 0 failed").severity, "info");
  const confirmation = createShellFeedback("Path copied");
  assert.equal(confirmation.severity, "info");
  assert.equal(confirmation.persistent, false);
  assert.equal(confirmation.timeoutMs, 2600);
});

test("transient confirmations cannot displace an unresolved serious notice", () => {
  const serious = createShellFeedback({ severity: "error", title: "Native activation failed" });
  const confirmation = createShellFeedback("Path copied");

  assert.equal(selectFeedbackNotice(serious, confirmation), serious);
  assert.equal(selectFeedbackNotice(null, confirmation), confirmation);
});

test("host-mirrored renderer faults replace equivalent local feed entries", () => {
  const feedback = createShellFeedback({
    source: "shell",
    severity: "warning",
    title: "Renderer degraded",
    detail: "Host data delayed",
  }, { timestamp: "2026-08-08T00:00:00.000Z" });
  const local = appendFeedbackEvent([], feedback);
  const remote = [{
    id: "host-fault",
    type: "renderer.shell.fault",
    severity: "warning",
    title: feedback.title,
    detail: feedback.detail,
    timestamp: "2026-08-08T00:00:00.100Z",
    unread: true,
    actionId: null,
  }];

  const merged = mergeSystemFeedEvents(local, remote);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "host-fault");
});

test("renderer faults from different surfaces remain distinct", () => {
  const local = appendFeedbackEvent([], createShellFeedback({
    source: "taskbar",
    severity: "error",
    title: "Native activation failed",
  }, { timestamp: "2026-08-08T00:00:00.000Z" }));
  const remote = [{
    id: "host-explorer-fault",
    type: "renderer.explorer.fault",
    severity: "error",
    title: "Native activation failed",
    detail: "",
    timestamp: "2026-08-08T00:00:00.100Z",
    unread: true,
    actionId: null,
  }];

  assert.equal(mergeSystemFeedEvents(local, remote).length, 2);
});
