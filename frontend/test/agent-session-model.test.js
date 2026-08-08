import assert from "node:assert/strict";
import test from "node:test";
import {
  agentSessionReducer,
  createAgentSessionModel,
  getAgentTranscriptAnnouncement,
  normalizeAgentMessage,
} from "../src/agent-session-model.js";
import { createAgentSessionGate } from "../src/agent-session-gate.js";
import { runAgentSessionTransition } from "../src/hooks/useAgentSession.js";
import { createMockPlatform } from "../src/platform/mock-platform.js";

function reduce(model, event) {
  return agentSessionReducer(model, { type: "event", event });
}

test("merges text deltas into one plain-text assistant message", () => {
  let model = createAgentSessionModel({
    available: true,
    connected: true,
    status: "ready",
  });
  model = reduce(model, {
    kind: "message",
    runId: "run-1",
    message: {
      id: "assistant-1",
      role: "assistant",
      text: "",
      status: "streaming",
      html: "<strong>must not survive normalization</strong>",
    },
  });
  model = reduce(model, {
    kind: "text-delta",
    runId: "run-1",
    messageId: "assistant-1",
    delta: "Hello",
  });
  model = reduce(model, {
    kind: "text-delta",
    runId: "run-1",
    messageId: "assistant-1",
    delta: " world",
  });

  assert.equal(model.messages.length, 1);
  assert.equal(model.messages[0].text, "Hello world");
  assert.equal(model.messages[0].status, "streaming");
  assert.equal(model.messages[0].runId, "run-1");
  assert.equal(Object.hasOwn(model.messages[0], "html"), false);
});

test("tracks run start, message completion, and successful run end", () => {
  let model = createAgentSessionModel({ available: true, connected: true, status: "ready" });
  model = reduce(model, { kind: "run-start", runId: "run-1" });
  model = reduce(model, {
    kind: "text-delta",
    runId: "run-1",
    messageId: "assistant-1",
    delta: "Done",
  });
  model = reduce(model, {
    kind: "message-complete",
    runId: "run-1",
    messageId: "assistant-1",
    status: "complete",
  });
  model = reduce(model, { kind: "run-end", runId: "run-1", status: "complete" });

  assert.equal(model.state.status, "ready");
  assert.equal(model.state.activeRunId, null);
  assert.equal(model.messages[0].status, "complete");
  assert.equal(model.messages[0].runId, "run-1");
});

test("reset clears messages and adopts the new session state", () => {
  const populated = createAgentSessionModel(
    { available: true, connected: true, status: "ready", sessionId: "old" },
    [{ id: "message-1", role: "user", text: "hello", status: "complete" }],
  );
  const reset = agentSessionReducer(populated, {
    type: "reset",
    state: {
      available: true,
      connected: true,
      status: "ready",
      sessionId: "new",
      permissionMode: "chat-only",
    },
  });

  assert.equal(reset.state.sessionId, "new");
  assert.deepEqual(reset.messages, []);
  assert.deepEqual(reset.tools, []);
});

test("records request and run errors without retaining an active run", () => {
  let model = reduce(
    createAgentSessionModel({ available: true, connected: true, status: "ready" }),
    { kind: "run-start", runId: "run-error" },
  );
  model = reduce(model, {
    kind: "run-end",
    runId: "run-error",
    status: "failed",
    error: {
      code: "NETWORK_UNAVAILABLE",
      message: "Provider unavailable",
      retryable: true,
    },
  });
  assert.equal(model.state.status, "error");
  assert.deepEqual(model.state.error, {
    code: "NETWORK_UNAVAILABLE",
    message: "Provider unavailable",
    retryable: true,
  });
  assert.equal(model.state.activeRunId, null);

  const bridgeError = new Error("Bridge timeout");
  bridgeError.code = "BRIDGE_TIMEOUT";
  model = agentSessionReducer(model, { type: "error", error: bridgeError });
  assert.deepEqual(model.state.error, {
    code: "BRIDGE_TIMEOUT",
    message: "Bridge timeout",
    retryable: false,
  });
  assert.equal(normalizeAgentMessage({ id: "safe", text: 42 }).text, "42");
});

test("preserves structured host errors and clears context on provider reset", () => {
  let model = createAgentSessionModel(
    {
      available: true,
      configured: true,
      connected: true,
      status: "ready",
      sessionId: "pi-session-1",
      error: {
        code: "AUTH_REQUIRED",
        message: "Pi Agent authentication is required.",
        retryable: false,
      },
    },
    [{ id: "old-context", role: "user", text: "remember me", status: "complete" }],
  );

  assert.equal(model.state.configured, true);
  assert.equal(model.state.error.code, "AUTH_REQUIRED");
  model = reduce(model, { kind: "session-reset" });
  assert.equal(model.state.connected, false);
  assert.equal(model.state.sessionId, null);
  assert.deepEqual(model.messages, []);
  assert.deepEqual(model.tools, []);
});

test("records a history-only hydration failure without hiding runtime state", () => {
  let model = createAgentSessionModel({
    available: true,
    configured: true,
    status: "ready",
  });
  model = agentSessionReducer(model, {
    type: "history-error",
    error: new Error("Message history timed out"),
  });

  assert.equal(model.state.available, true);
  assert.equal(model.state.status, "ready");
  assert.equal(model.historyError, "Message history timed out");
});

test("late hydration merges history without overwriting newer state or messages", () => {
  let model = createAgentSessionModel();
  const gate = createAgentSessionGate((action) => {
    model = agentSessionReducer(model, action);
  });
  const hydration = gate.captureHydration();

  gate.stateChanged({
    available: true,
    connected: true,
    status: "running",
    sessionId: "session-1",
    activeRunId: "run-1",
  });
  gate.event({
    kind: "message",
    message: {
      id: "live-message",
      role: "assistant",
      text: "newer live text",
      status: "streaming",
    },
  });
  gate.hydrate(
    hydration,
    {
      available: true,
      connected: true,
      status: "ready",
      sessionId: "session-1",
    },
    [
      { id: "history", role: "user", text: "earlier", status: "complete" },
      { id: "live-message", role: "assistant", text: "stale", status: "streaming" },
    ],
  );

  assert.equal(model.state.status, "running");
  assert.equal(model.state.activeRunId, "run-1");
  assert.deepEqual(model.messages.map((message) => message.id), ["history", "live-message"]);
  assert.equal(model.messages[1].text, "newer live text");
});

test("late hydration cannot restore messages from a replaced session", () => {
  let model = createAgentSessionModel();
  const gate = createAgentSessionGate((action) => {
    model = agentSessionReducer(model, action);
  });
  const hydration = gate.captureHydration();

  gate.stateChanged({
    available: true,
    connected: true,
    status: "ready",
    sessionId: "new-session",
  });
  gate.event({
    kind: "message",
    message: {
      id: "new-message",
      role: "assistant",
      text: "new context",
      status: "complete",
    },
  });
  gate.hydrate(
    hydration,
    {
      available: true,
      connected: true,
      status: "ready",
      sessionId: "old-session",
    },
    [{ id: "old-message", role: "user", text: "old context", status: "complete" }],
  );

  assert.equal(model.state.sessionId, "new-session");
  assert.deepEqual(model.messages.map((message) => message.id), ["new-message"]);
});

test("session reset invalidates stale hydration history without losing the live reset", () => {
  let model = createAgentSessionModel({
    available: true,
    connected: true,
    status: "ready",
    sessionId: "old-session",
  });
  const gate = createAgentSessionGate((action) => {
    model = agentSessionReducer(model, action);
  });
  const hydration = gate.captureHydration();

  gate.event({ kind: "session-reset" });
  gate.hydrate(
    hydration,
    {
      available: true,
      connected: true,
      status: "ready",
      sessionId: "old-session",
    },
    [{ id: "old-message", role: "user", text: "old context", status: "complete" }],
  );

  assert.equal(model.state.connected, false);
  assert.equal(model.state.sessionId, null);
  assert.deepEqual(model.messages, []);
});

test("new-session await gap replays new run events after clearing old context", async () => {
  let model = createAgentSessionModel(
    {
      available: true,
      connected: true,
      status: "ready",
      sessionId: "old-session",
    },
    [{ id: "old-message", role: "user", text: "old context", status: "complete" }],
  );
  const gate = createAgentSessionGate((action) => {
    model = agentSessionReducer(model, action);
  });
  let resolveGetState;
  const getStatePending = new Promise((resolve) => {
    resolveGetState = resolve;
  });
  const agent = {
    async newSession() {
      return { success: true };
    },
    async getState() {
      return getStatePending;
    },
  };

  const switching = runAgentSessionTransition(agent, gate);
  await Promise.resolve();
  assert.equal(gate.isTransitioning(), true);
  assert.equal(model.sessionTransitioning, true);

  gate.event({
    kind: "message",
    message: {
      id: "new-message",
      role: "assistant",
      text: "new context",
      status: "streaming",
    },
  });
  gate.event({ kind: "run-start", runId: "new-run" });
  resolveGetState({
    available: true,
    connected: true,
    status: "ready",
    sessionId: "new-session",
  });

  const result = await switching;
  assert.equal(result.applied, true);
  assert.equal(gate.isTransitioning(), false);
  assert.equal(model.sessionTransitioning, false);
  assert.equal(model.state.status, "running");
  assert.equal(model.state.activeRunId, "new-run");
  assert.deepEqual(model.messages.map((message) => message.id), ["new-message"]);
});

test("transcript announcement fires once on assistant completion, not per delta", () => {
  let statuses = new Map();
  let result = getAgentTranscriptAnnouncement(statuses, [
    { id: "assistant-1", role: "assistant", text: "Hel", status: "streaming" },
  ]);
  statuses = result.nextStatuses;
  assert.equal(result.announcement, null);

  result = getAgentTranscriptAnnouncement(statuses, [
    { id: "assistant-1", role: "assistant", text: "Hello", status: "streaming" },
  ]);
  statuses = result.nextStatuses;
  assert.equal(result.announcement, null);

  result = getAgentTranscriptAnnouncement(statuses, [
    { id: "assistant-1", role: "assistant", text: "Hello", status: "complete" },
  ]);
  statuses = result.nextStatuses;
  assert.deepEqual(result.announcement, {
    id: "assistant-1",
    text: "Agent response complete.",
  });

  result = getAgentTranscriptAnnouncement(statuses, [
    { id: "assistant-1", role: "assistant", text: "Hello", status: "complete" },
  ]);
  assert.equal(result.announcement, null);
});

test("mock Agent streams an explicitly local browser-preview response", async () => {
  const mock = createMockPlatform();
  const events = [];
  const completed = new Promise((resolve) => {
    const unsubscribe = mock.events.subscribe("agent.event", (event) => {
      events.push(event);
      if (event.kind === "run-end") {
        unsubscribe();
        resolve(event);
      }
    });
  });

  const accepted = await mock.agent.prompt("What can you do?", "client-1");
  assert.equal(accepted.accepted, true);
  await completed;

  const state = await mock.agent.getState();
  const messages = await mock.agent.getMessages();
  assert.equal(state.status, "ready");
  assert.equal(messages.length, 2);
  assert.equal(messages[0].runId, accepted.runId);
  assert.equal(messages[1].runId, accepted.runId);
  assert.match(messages[1].text, /^BROWSER PREVIEW/u);
  assert.match(messages[1].text, /did not inspect, change, or execute anything/u);
  assert.equal(events.filter((event) => event.kind === "text-delta").length, 3);
  assert.equal(
    events.filter((event) => event.kind === "text-delta")
      .every((event) => event.runId === accepted.runId),
    true,
  );
});

test("mock Agent aborts an active stream and newSession clears history", async () => {
  const mock = createMockPlatform();
  await mock.agent.prompt("Keep this local", "client-2");
  const aborted = await mock.agent.abort();
  assert.equal(aborted.aborted, true);
  assert.equal((await mock.agent.getMessages())[1].status, "aborted");

  const previousSessionId = (await mock.agent.getState()).sessionId;
  const nextState = await mock.agent.newSession();
  assert.notEqual(nextState.sessionId, previousSessionId);
  assert.equal(nextState.permissionMode, "chat-only");
  assert.deepEqual(await mock.agent.getMessages(), []);
});
