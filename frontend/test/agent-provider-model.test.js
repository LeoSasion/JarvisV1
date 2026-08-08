import assert from "node:assert/strict";
import test from "node:test";
import {
  getCommandBusPresentation,
  getAgentLauncherStatus,
  getAgentProviderLabel,
} from "../src/agent-provider-model.js";

test("agent provider is secondary, bounded, and provider-neutral", () => {
  assert.equal(getAgentProviderLabel({ available: false, provider: "pi" }), "NO PROVIDER");
  assert.equal(getAgentProviderLabel({ available: true, provider: "pi" }), "PI");
  assert.equal(getAgentProviderLabel({ available: true, provider: "browser-preview" }), "PREVIEW");
  assert.equal(getAgentProviderLabel({ available: true, provider: "Claude Desktop Adapter" }), "CLAUDE DESKTOP ADAPTER");
});

test("agent launcher status follows runtime and window truth", () => {
  assert.equal(getAgentLauncherStatus({ available: false }), "OFFLINE");
  assert.equal(getAgentLauncherStatus({ available: true, error: { code: "FAULT" } }), "ATTENTION");
  assert.equal(getAgentLauncherStatus({ available: true, status: "running" }), "PROCESSING");
  assert.equal(getAgentLauncherStatus({ available: true }, { active: true }), "ACTIVE");
  assert.equal(getAgentLauncherStatus({ available: true }, { open: true }), "READY");
  assert.equal(getAgentLauncherStatus({ available: true }), "OPEN");
});

test("local command readiness is independent from Agent provider state", () => {
  const offline = getCommandBusPresentation({ available: false, status: "unavailable" });
  assert.equal(offline.localCommandLabel, "LOCAL COMMANDS READY");
  assert.equal(offline.agentProviderStatus, "AGENT OFFLINE");

  const running = getCommandBusPresentation({ available: true, status: "running" });
  assert.equal(running.localCommandLabel, "LOCAL COMMANDS READY");
  assert.equal(running.agentProviderStatus, "AGENT ACTIVE");
});
