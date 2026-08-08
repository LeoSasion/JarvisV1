export const SHELL_FEEDBACK_STORAGE_KEY = "jarvis.shell.feedback.v1";

const CHANNEL_VERSION = 1;
const localFeedbackEvent = "jarvis:shell-feedback";
const validSeverities = new Set(["info", "ok", "warning", "error"]);
const validSources = new Set([
  "agent", "desktop", "explorer", "notifications", "runtime", "settings",
  "shell", "system", "taskbar", "terminal", "window-appearance",
]);

function sanitizeText(value, maximumLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximumLength);
}

export function normalizeShellFeedbackPayload(value) {
  if (!value || value.version !== CHANNEL_VERSION || typeof value.nonce !== "string") return null;
  const title = sanitizeText(value.title, 160);
  if (!title) return null;
  return {
    id: sanitizeText(value.id || value.nonce, 96),
    severity: validSeverities.has(value.severity) ? value.severity : "error",
    source: validSources.has(value.source) ? value.source : "shell",
    title,
    detail: sanitizeText(value.detail, 320),
    timestamp: typeof value.timestamp === "string" ? value.timestamp : new Date().toISOString(),
    persistent: value.persistent !== false,
  };
}

export function publishShellFeedback(feedback) {
  const payload = normalizeShellFeedbackPayload({
    version: CHANNEL_VERSION,
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    id: feedback?.id,
    severity: feedback?.severity ?? "error",
    source: feedback?.source ?? "shell",
    title: feedback?.title,
    detail: feedback?.detail,
    timestamp: feedback?.timestamp ?? new Date().toISOString(),
    persistent: feedback?.persistent,
  });
  if (!payload) return false;
  const storedPayload = { ...payload, version: CHANNEL_VERSION, nonce: payload.id };
  try {
    window.localStorage.setItem(SHELL_FEEDBACK_STORAGE_KEY, JSON.stringify(storedPayload));
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent(localFeedbackEvent, { detail: storedPayload }));
  return true;
}

export function consumeStoredShellFeedback(storage) {
  try {
    const rawValue = storage?.getItem?.(SHELL_FEEDBACK_STORAGE_KEY) ?? null;
    if (rawValue === null) return null;
    const feedback = normalizeShellFeedbackPayload(JSON.parse(rawValue));
    storage.removeItem(SHELL_FEEDBACK_STORAGE_KEY);
    return feedback;
  } catch {
    try {
      storage?.removeItem?.(SHELL_FEEDBACK_STORAGE_KEY);
    } catch {
      // A blocked storage surface simply cannot provide replay.
    }
    return null;
  }
}

export function subscribeShellFeedback(listener) {
  let lastId = null;
  const deliver = (value) => {
    const feedback = normalizeShellFeedbackPayload(value);
    if (!feedback || feedback.id === lastId) return;
    lastId = feedback.id;
    listener(feedback);
  };
  const handleStorage = (event) => {
    if (event.key !== SHELL_FEEDBACK_STORAGE_KEY) return;
    try {
      deliver(JSON.parse(event.newValue ?? "null"));
      consumeStoredShellFeedback(window.localStorage);
    } catch {
      consumeStoredShellFeedback(window.localStorage);
    }
  };
  const handleLocal = (event) => {
    deliver(event.detail);
    consumeStoredShellFeedback(window.localStorage);
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(localFeedbackEvent, handleLocal);
  const storedFeedback = consumeStoredShellFeedback(window.localStorage);
  if (storedFeedback) deliver(storedFeedback);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(localFeedbackEvent, handleLocal);
  };
}
