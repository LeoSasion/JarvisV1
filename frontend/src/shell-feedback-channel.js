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

function readStoredShellFeedback(storage) {
  let raw;
  try {
    raw = storage?.getItem?.(SHELL_FEEDBACK_STORAGE_KEY) ?? null;
  } catch {
    return { raw: null, feedback: null };
  }
  if (raw === null) return { raw, feedback: null };
  try {
    return { raw, feedback: normalizeShellFeedbackPayload(JSON.parse(raw)) };
  } catch {
    return { raw, feedback: null };
  }
}

function acknowledgeStoredShellFeedback(storage, { expectedId = null, expectedRaw = null } = {}) {
  try {
    const currentRaw = storage?.getItem?.(SHELL_FEEDBACK_STORAGE_KEY) ?? null;
    if (currentRaw === null || (expectedRaw !== null && currentRaw !== expectedRaw)) return false;
    if (expectedId !== null) {
      const current = normalizeShellFeedbackPayload(JSON.parse(currentRaw));
      if (current?.id !== expectedId) return false;
    }
    storage.removeItem(SHELL_FEEDBACK_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function consumeStoredShellFeedback(storage) {
  const stored = readStoredShellFeedback(storage);
  if (stored.raw === null) return null;
  acknowledgeStoredShellFeedback(storage, {
    expectedId: stored.feedback?.id ?? null,
    expectedRaw: stored.raw,
  });
  return stored.feedback;
}

export function subscribeShellFeedback(listener) {
  const deliveredIds = new Set();
  const deliver = (feedback) => {
    if (deliveredIds.has(feedback.id)) return;
    listener(feedback);
    deliveredIds.add(feedback.id);
    if (deliveredIds.size > 32) {
      deliveredIds.delete(deliveredIds.values().next().value);
    }
  };
  const handleStorage = (event) => {
    if (event.key !== SHELL_FEEDBACK_STORAGE_KEY || event.newValue == null) return;
    let feedback = null;
    try {
      feedback = normalizeShellFeedbackPayload(JSON.parse(event.newValue));
    } catch {
      // The bounded payload validator below treats malformed JSON as invalid.
    }
    if (feedback) deliver(feedback);
    acknowledgeStoredShellFeedback(window.localStorage, {
      expectedId: feedback?.id ?? null,
      expectedRaw: event.newValue,
    });
  };
  const handleLocal = (event) => {
    const feedback = normalizeShellFeedbackPayload(event.detail);
    if (!feedback) return;
    deliver(feedback);
    acknowledgeStoredShellFeedback(window.localStorage, { expectedId: feedback.id });
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(localFeedbackEvent, handleLocal);
  const stored = readStoredShellFeedback(window.localStorage);
  if (stored.feedback) deliver(stored.feedback);
  if (stored.raw !== null) {
    acknowledgeStoredShellFeedback(window.localStorage, {
      expectedId: stored.feedback?.id ?? null,
      expectedRaw: stored.raw,
    });
  }
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(localFeedbackEvent, handleLocal);
  };
}
