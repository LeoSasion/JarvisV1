export function getTelemetryPriorityPresentation({ events = [], feedError = null, feedLoading = false } = {}) {
  const connecting = Boolean(feedLoading);
  const priorityEvent = events.find((item) => item.severity === "error" || item.severity === "warning")
    ?? events[0]
    ?? null;
  const hasWarning = Boolean(feedError)
    || events.some((item) => item.severity === "warning" || item.severity === "error");

  if (feedError) {
    return {
      kind: "warning",
      className: "has-warning",
      title: "TELEMETRY DISCONNECTED",
      detail: "System feed unavailable",
      meta: feedError?.message ?? String(feedError),
    };
  }
  if (connecting) {
    return {
      kind: "connecting",
      className: "is-connecting",
      title: "STATUS SYNCHRONIZING",
      detail: "System feed connecting",
      meta: events.length > 0
        ? `${events.length} cached session events retained`
        : "Waiting for the first host snapshot",
    };
  }
  return {
    kind: hasWarning ? "warning" : "nominal",
    className: hasWarning ? "has-warning" : "is-nominal",
    title: hasWarning ? "ATTENTION REQUIRED" : "SYSTEM NOMINAL",
    detail: priorityEvent?.title ?? "No critical session events",
    meta: priorityEvent?.detail || `${events.length} session events available`,
  };
}

export function getTelemetryRailMode({ compact = false, priorityKind = "nominal" } = {}) {
  return compact && priorityKind === "nominal" ? "compact-nominal" : "full";
}

export function getCompactTelemetrySummary(resources = []) {
  const findValue = (id, fallback) => resources.find((resource) => resource.id === id)?.value ?? fallback;
  return {
    cpu: findValue("cpu", "—"),
    memory: findValue("memory", "—"),
    label: `System nominal. CPU ${findValue("cpu", "unavailable")}. Memory ${findValue("memory", "unavailable")}. Open System Health.`,
  };
}
