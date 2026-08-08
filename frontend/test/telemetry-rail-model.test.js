import assert from "node:assert/strict";
import test from "node:test";
import {
  getCompactTelemetrySummary,
  getTelemetryPriorityPresentation,
  getTelemetryRailMode,
} from "../src/telemetry-rail-model.js";

test("compact telemetry is reserved for a truthful nominal state", () => {
  const nominal = getTelemetryPriorityPresentation({ events: [] });
  assert.equal(nominal.kind, "nominal");
  assert.equal(getTelemetryRailMode({ compact: true, priorityKind: nominal.kind }), "compact-nominal");

  for (const state of [
    getTelemetryPriorityPresentation({ feedLoading: true }),
    getTelemetryPriorityPresentation({ feedError: new Error("offline") }),
    getTelemetryPriorityPresentation({ events: [{ severity: "warning", title: "Check" }] }),
    getTelemetryPriorityPresentation({ events: [{ severity: "error", title: "Failed" }] }),
  ]) {
    assert.equal(getTelemetryRailMode({ compact: true, priorityKind: state.kind }), "full");
  }
});

test("compact telemetry exposes CPU and memory in its accessible summary", () => {
  const summary = getCompactTelemetrySummary([
    { id: "cpu", value: "18%" },
    { id: "memory", value: "42%" },
  ]);
  assert.equal(summary.cpu, "18%");
  assert.equal(summary.memory, "42%");
  assert.match(summary.label, /CPU 18%\. Memory 42%/u);
});
