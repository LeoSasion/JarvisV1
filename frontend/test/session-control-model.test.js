import assert from "node:assert/strict";
import test from "node:test";
import {
  createExitChallenge,
  EXIT_TO_WINDOWS_ACTION,
  isSessionChallengeExpired,
  normalizeSessionChallenge,
  normalizeSessionControlState,
} from "../src/session-control-model.js";

test("session state keeps only the fixed native action set", () => {
  const state = normalizeSessionControlState({
    available: true,
    confirmationTimeoutSeconds: 900,
    actions: [
      {
        id: "lock",
        label: "LOCK",
        detail: "Lock Windows",
        consequence: "Apps stay open",
      },
      { id: "shutdown.exe /s", label: "UNSAFE" },
      { id: "lock", label: "DUPLICATE" },
      { id: "restart", label: "RESTART", destructive: true },
    ],
  });

  assert.equal(state.available, true);
  assert.equal(state.confirmationTimeoutSeconds, 30);
  assert.deepEqual(state.actions.map((action) => action.id), ["lock", "restart"]);
  assert.equal(state.actions[1].destructive, true);
});

test("native challenges require a matching action and bounded hex token", () => {
  const raw = {
    actionId: "lock",
    title: "LOCK DEVICE",
    detail: "Apps stay open",
    token: "a".repeat(64),
    expiresAtUtc: "2026-07-30T08:00:15.000Z",
  };

  assert.equal(normalizeSessionChallenge(raw, "restart"), null);
  assert.equal(normalizeSessionChallenge({ ...raw, token: "not-a-token" }, "lock"), null);
  assert.equal(normalizeSessionChallenge(raw, "lock")?.token, "a".repeat(64));
});

test("challenge expiry and local Exit to Windows remain deterministic", () => {
  const challenge = normalizeSessionChallenge({
    actionId: "shut-down",
    title: "SHUT DOWN",
    detail: "Save work",
    token: "f".repeat(64),
    expiresAtUtc: "2026-07-30T08:00:15.000Z",
  }, "shut-down");

  assert.equal(isSessionChallengeExpired(challenge, Date.parse("2026-07-30T08:00:14Z")), false);
  assert.equal(isSessionChallengeExpired(challenge, Date.parse("2026-07-30T08:00:15Z")), true);
  assert.equal(isSessionChallengeExpired(challenge, Date.parse("2026-07-30T08:00:16Z")), true);
  assert.deepEqual(createExitChallenge(), {
    actionId: EXIT_TO_WINDOWS_ACTION.id,
    title: "EXIT TO WINDOWS",
    detail: "Windows and your open applications remain running.",
    token: null,
    expiresAtUtc: null,
    destructive: false,
    local: true,
  });
});
