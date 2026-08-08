const VALID_SEVERITIES = new Set(["info", "ok", "warning", "error"]);
const VALID_SOURCES = new Set([
  "agent",
  "desktop",
  "explorer",
  "notifications",
  "runtime",
  "settings",
  "shell",
  "system",
  "taskbar",
  "terminal",
  "window-appearance",
]);
const MAX_FEEDBACK_HISTORY = 20;
let feedbackSequence = 0;

function normalizeText(value, fallback, maximumLength) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return (normalized || fallback).slice(0, maximumLength);
}

function inferLegacySeverity(message) {
  const actionableMessage = message.replace(/\b(?:0|no)\s+fail(?:ed|ures?)\b/giu, "");
  return /\b(?:unable|failed|failure|failures|cannot|could not|error|unavailable)\b|(?:无法|失败|不可用|错误|未能)/iu.test(actionableMessage)
    ? "error"
    : "info";
}

export function createShellFeedback(input, options = {}) {
  const source = typeof input === "string" ? { title: input } : (input ?? {});
  const title = normalizeText(source.title ?? source.message, "JARVIS status updated", 160);
  const requestedSeverity = source.severity ?? inferLegacySeverity(title);
  const severity = VALID_SEVERITIES.has(requestedSeverity) ? requestedSeverity : "info";
  const requestedSource = normalizeText(source.source, "shell", 32).toLocaleLowerCase();
  const feedbackSource = VALID_SOURCES.has(requestedSource) ? requestedSource : "shell";
  const persistent = source.persistent ?? (severity === "warning" || severity === "error");
  const timestamp = source.timestamp ?? options.timestamp ?? new Date().toISOString();
  feedbackSequence += 1;

  return {
    id: normalizeText(source.id, `feedback-${Date.now()}-${feedbackSequence}`, 96),
    severity,
    source: feedbackSource,
    title,
    detail: normalizeText(source.detail, "", 320),
    timestamp,
    persistent: Boolean(persistent),
    timeoutMs: persistent ? null : Math.max(1_200, Math.min(8_000, Number(source.timeoutMs) || 2_600)),
    actions: Array.isArray(source.actions)
      ? source.actions
        .filter((action) => typeof action?.onInvoke === "function")
        .slice(0, 2)
        .map((action) => ({
          label: normalizeText(action.label, "RETRY", 32),
          onInvoke: action.onInvoke,
        }))
      : [],
  };
}

export function toSystemFeedEvent(feedback) {
  return {
    id: `local:${feedback.id}`,
    type: "shell.feedback",
    severity: feedback.severity,
    title: feedback.title,
    detail: feedback.detail,
    timestamp: feedback.timestamp,
    unread: true,
    actionId: null,
    source: feedback.source,
    local: true,
  };
}

export function appendFeedbackEvent(events, feedback, limit = MAX_FEEDBACK_HISTORY) {
  const next = toSystemFeedEvent(feedback);
  return [next, ...events.filter((event) => event.id !== next.id)].slice(0, limit);
}

export function selectFeedbackNotice(current, incoming) {
  if (current?.persistent && !incoming?.persistent) return current;
  return incoming ?? null;
}

export function mergeSystemFeedEvents(localEvents = [], remoteEvents = [], limit = MAX_FEEDBACK_HISTORY) {
  const seenIds = new Set();
  const recentFaults = new Map();
  return [...localEvents, ...remoteEvents]
    .sort((left, right) => Date.parse(right.timestamp ?? 0) - Date.parse(left.timestamp ?? 0))
    .filter((event) => {
      if (!event?.id || seenIds.has(event.id)) return false;
      seenIds.add(event.id);
      const isRendererFault = event.local || String(event.type ?? "").startsWith("renderer.");
      if (!isRendererFault) return true;
      const timestamp = Date.parse(event.timestamp ?? 0);
      const rendererSource = event.source
        ?? String(event.type ?? "").match(/^renderer\.([^.]+)\.fault$/u)?.[1]
        ?? "shell";
      const key = [rendererSource, event.severity, event.title, event.detail, event.actionId ?? ""].join("\u001f");
      const previous = recentFaults.get(key);
      if (previous != null && Math.abs(previous - timestamp) < 30_000) return false;
      recentFaults.set(key, timestamp);
      return true;
    })
    .slice(0, limit);
}
