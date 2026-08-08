const RULE_ACTIONS = new Set(["allow", "deny"]);
const COMPATIBILITY_DECISIONS = new Set([
  "allowed",
  "automatic",
  "denied",
  "protected",
  "limited",
]);

const compatibilityReasonLabels = {
  "automatic": "Automatic compatibility",
  "user-allow": "Allowed by user",
  "user-deny": "Disabled by user",
  "system-protected": "Windows protected process",
  "jarvis-host": "JARVIS host",
  "integrity-or-access": "Integrity or access boundary",
  "non-application-window": "Non-standard application window",
  "no-standard-caption": "No standard caption",
  "system-window-class": "Windows system window",
  "window-cloaked": "Window is currently cloaked",
  "fullscreen": "Fullscreen window skipped",
  "no-compatible-window": "No compatible window available",
};

export function normalizeWindowAppearanceProcessName(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\.exe$/iu, "");
  if (!trimmed || trimmed.length > 64 || trimmed === "." || trimmed === "..") return "";
  const forbidden = "\\/:*?\"<>|";
  return [...trimmed].some((character) => {
    const codePoint = character.codePointAt(0);
    return forbidden.includes(character) || codePoint < 32 || codePoint === 127;
  }) ? "" : trimmed;
}

export function normalizeWindowAppearanceRules(rawRules) {
  if (!Array.isArray(rawRules)) return [];
  const byProcess = new Map();
  for (const rawRule of rawRules.slice(0, 64)) {
    const processName = normalizeWindowAppearanceProcessName(
      rawRule?.processName ?? rawRule?.ProcessName,
    );
    const action = String(rawRule?.action ?? rawRule?.Action ?? "").toLowerCase();
    if (processName && RULE_ACTIONS.has(action)) {
      byProcess.set(processName.toLowerCase(), { processName, action });
    }
  }
  return [...byProcess.values()].sort((left, right) =>
    left.processName.localeCompare(right.processName, undefined, { sensitivity: "base" }));
}

export function normalizeWindowCompatibilityMatrix(rawMatrix) {
  if (!Array.isArray(rawMatrix)) return [];
  return rawMatrix.slice(0, 64).flatMap((rawEntry) => {
    const processName = normalizeWindowAppearanceProcessName(
      rawEntry?.processName ?? rawEntry?.ProcessName,
    );
    if (!processName) return [];
    const requestedDecision = String(
      rawEntry?.decision ?? rawEntry?.Decision ?? "limited",
    ).toLowerCase();
    const decision = COMPATIBILITY_DECISIONS.has(requestedDecision)
      ? requestedDecision
      : "limited";
    const count = (key) => {
      const value = Number(rawEntry?.[key] ?? rawEntry?.[
        `${key[0].toUpperCase()}${key.slice(1)}`
      ] ?? 0);
      return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
    };
    return [{
      processName,
      windowCount: count("windowCount"),
      eligibleWindowCount: count("eligibleWindowCount"),
      styledWindowCount: count("styledWindowCount"),
      decision,
      reasonCode: String(rawEntry?.reasonCode ?? rawEntry?.ReasonCode ?? "no-compatible-window"),
    }];
  });
}

export function getWindowCompatibilityReasonLabel(reasonCode) {
  return compatibilityReasonLabels[reasonCode] ?? "This window is not eligible for takeover";
}
