const SESSION_ACTION_IDS = new Set([
  "lock",
  "sign-out",
  "restart",
  "shut-down",
]);

const MAX_TEXT_LENGTH = 240;

export const EXIT_TO_WINDOWS_ACTION = Object.freeze({
  id: "exit-jarvis",
  label: "EXIT TO WINDOWS",
  detail: "Close JARVIS and restore the native Windows desktop and taskbar.",
  consequence: "Windows and your open applications remain running.",
  destructive: false,
  local: true,
});

function safeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, MAX_TEXT_LENGTH) : fallback;
}

export function normalizeSessionControlState(rawState) {
  const raw = rawState && typeof rawState === "object" ? rawState : {};
  const seen = new Set();
  const actions = [];

  for (const value of Array.isArray(raw.actions) ? raw.actions : []) {
    const id = safeText(value?.id);
    if (!SESSION_ACTION_IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    actions.push({
      id,
      label: safeText(value.label, id.toUpperCase()),
      detail: safeText(value.detail, "Windows session action."),
      consequence: safeText(
        value.consequence,
        "Windows will apply its normal unsaved-work protections.",
      ),
      destructive: Boolean(value.destructive),
      local: false,
    });
  }

  const rawTimeout = Number(raw.confirmationTimeoutSeconds);
  return {
    available: Boolean(raw.available),
    confirmationTimeoutSeconds: Number.isFinite(rawTimeout)
      ? Math.min(30, Math.max(5, Math.round(rawTimeout)))
      : 15,
    actions,
  };
}

export function normalizeSessionChallenge(rawChallenge, expectedActionId) {
  const raw = rawChallenge && typeof rawChallenge === "object"
    ? rawChallenge
    : {};
  const actionId = safeText(raw.actionId);
  const token = safeText(raw.token);
  const expiresAt = new Date(raw.expiresAtUtc);

  if (
    actionId !== expectedActionId ||
    !SESSION_ACTION_IDS.has(actionId) ||
    !/^[a-f0-9]{64}$/i.test(token) ||
    Number.isNaN(expiresAt.getTime())
  ) {
    return null;
  }

  return {
    actionId,
    title: safeText(raw.title, actionId.toUpperCase()),
    detail: safeText(raw.detail, "Confirm this Windows session action."),
    token: token.toLowerCase(),
    expiresAtUtc: expiresAt.toISOString(),
    destructive: Boolean(raw.destructive),
    local: false,
  };
}

export function createExitChallenge() {
  return {
    actionId: EXIT_TO_WINDOWS_ACTION.id,
    title: EXIT_TO_WINDOWS_ACTION.label,
    detail: EXIT_TO_WINDOWS_ACTION.consequence,
    token: null,
    expiresAtUtc: null,
    destructive: false,
    local: true,
  };
}

export function isSessionChallengeExpired(challenge, now = Date.now()) {
  if (!challenge || challenge.local) return false;
  const expiresAt = new Date(challenge.expiresAtUtc).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= Number(now);
}
