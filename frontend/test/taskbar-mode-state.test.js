import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTaskbarModeState,
  shouldAcceptTaskbarModeState,
} from "../src/hooks/usePlatformData.js";
import { createMockPlatform } from "../src/platform/mock-platform.js";
import {
  canRetryTaskbarMode,
  getTaskbarCooldownRemaining,
  getTaskbarTransitionToast,
} from "../src/taskbar-mode-model.js";

test("taskbar mode normalization preserves an applying transaction", () => {
  const state = normalizeTaskbarModeState({
    requestedMode: "full",
    effectiveMode: "native",
    transitionStatus: "applying",
    transitionGeneration: 17,
    transitionReason: "manual-retry",
    recoveryFailureCount: 2,
  });

  assert.equal(state.requestedMode, "full");
  assert.equal(state.effectiveMode, "native");
  assert.equal(state.transitionStatus, "applying");
  assert.equal(state.transitionGeneration, 17);
  assert.equal(state.transitionReason, "manual-retry");
  assert.equal(state.recoveryFailureCount, 2);
});

test("taskbar mode normalization fails closed for malformed wire values", () => {
  const state = normalizeTaskbarModeState({
    requestedMode: "immersive",
    effectiveMode: "invalid",
    transitionStatus: "unknown",
    transitionGeneration: -4,
    recoveryFailureCount: -1,
    retryAfterUtc: "not-a-date",
  });

  assert.equal(state.requestedMode, "native");
  assert.equal(state.effectiveMode, "native");
  assert.equal(state.transitionStatus, "settled");
  assert.equal(state.transitionGeneration, 0);
  assert.equal(state.recoveryFailureCount, 0);
  assert.equal(state.retryAfterUtc, null);
});

test("taskbar cooldown state keeps retry timing and failure budget", () => {
  const retryAfterUtc = "2026-07-29T12:01:00.000Z";
  const state = normalizeTaskbarModeState({
    requestedMode: "full",
    effectiveMode: "native",
    transitionStatus: "cooldown",
    transitionGeneration: 9,
    retryAllowed: false,
    recoveryFailureCount: 3,
    retryAfterUtc,
  });

  assert.equal(state.transitionStatus, "cooldown");
  assert.equal(state.retryAllowed, false);
  assert.equal(state.recoveryFailureCount, 3);
  assert.equal(state.retryAfterUtc, retryAfterUtc);
});

test("mock taskbar mode reports applying before its settled outcome", async () => {
  const mock = createMockPlatform();
  const events = [];
  const unsubscribe = mock.events.subscribe(
    "taskbarMode.changed",
    (state) => events.push(state),
  );

  const applying = await mock.taskbarMode.setMode("full");
  assert.equal(applying.requestedMode, "full");
  assert.equal(applying.transitionStatus, "applying");
  assert.notEqual(applying.effectiveMode, "full");

  await new Promise((resolve) => globalThis.setTimeout(resolve, 160));
  unsubscribe();

  assert.equal(events.at(-1).transitionStatus, "settled");
  assert.equal(events.at(-1).effectiveMode, "full");
  assert.equal(
    events.at(-1).transitionGeneration,
    applying.transitionGeneration,
  );
});

test("mock retry rejects an already settled requested mode", async () => {
  const mock = createMockPlatform();

  await assert.rejects(
    () => mock.taskbarMode.retry(),
    /already active/u,
  );
});

test("taskbar state ordering rejects older generations and terminal regression", () => {
  const settled = normalizeTaskbarModeState({
    requestedMode: "full",
    effectiveMode: "full",
    transitionStatus: "settled",
    transitionGeneration: 12,
  });
  const stale = normalizeTaskbarModeState({
    requestedMode: "full",
    effectiveMode: "native",
    transitionStatus: "fallback",
    transitionGeneration: 11,
  });
  const lateApplying = normalizeTaskbarModeState({
    requestedMode: "full",
    effectiveMode: "native",
    transitionStatus: "applying",
    transitionGeneration: 12,
  });
  const newer = normalizeTaskbarModeState({
    requestedMode: "native",
    effectiveMode: "full",
    transitionStatus: "applying",
    transitionGeneration: 13,
  });

  assert.equal(shouldAcceptTaskbarModeState(settled, stale), false);
  assert.equal(shouldAcceptTaskbarModeState(settled, lateApplying), false);
  assert.equal(shouldAcceptTaskbarModeState(settled, newer), true);
});

test("taskbar transition feedback waits for the owned terminal outcome", () => {
  const previous = { status: "applying", generation: 4 };
  const applying = normalizeTaskbarModeState({
    requestedMode: "full",
    effectiveMode: "native",
    transitionStatus: "applying",
    transitionGeneration: 4,
  });
  const settled = normalizeTaskbarModeState({
    requestedMode: "full",
    effectiveMode: "full",
    transitionStatus: "settled",
    transitionGeneration: 4,
  });
  const staleFallback = normalizeTaskbarModeState({
    requestedMode: "full",
    effectiveMode: "native",
    transitionStatus: "fallback",
    transitionGeneration: 3,
  });

  assert.equal(getTaskbarTransitionToast(previous, applying), null);
  assert.equal(getTaskbarTransitionToast(previous, staleFallback), null);
  assert.match(getTaskbarTransitionToast(previous, settled), /FULL/u);
});

test("taskbar retry becomes eligible when local cooldown reaches zero", () => {
  const now = Date.parse("2026-07-29T12:00:00.000Z");
  const state = normalizeTaskbarModeState({
    requestedMode: "full",
    effectiveMode: "native",
    transitionStatus: "cooldown",
    transitionGeneration: 8,
    retryAllowed: false,
    retryAfterUtc: "2026-07-29T12:00:05.000Z",
  });

  assert.equal(getTaskbarCooldownRemaining(state.retryAfterUtc, now), 5);
  assert.equal(canRetryTaskbarMode(state, false, now), false);
  assert.equal(canRetryTaskbarMode(state, false, now + 5_000), true);
  assert.equal(canRetryTaskbarMode(state, true, now + 5_000), false);
});
