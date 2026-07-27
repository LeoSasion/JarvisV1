const RULE_ACTIONS = new Set(["allow", "deny"]);
const COMPATIBILITY_DECISIONS = new Set([
  "allowed",
  "automatic",
  "denied",
  "protected",
  "limited",
]);

const compatibilityReasonLabels = {
  "automatic": "自动兼容",
  "user-allow": "用户允许",
  "user-deny": "用户禁用",
  "system-protected": "Windows 保护进程",
  "jarvis-host": "JARVIS 主程序",
  "integrity-or-access": "权限级别不可安全接管",
  "non-application-window": "非标准应用窗口",
  "no-standard-caption": "无标准标题栏",
  "system-window-class": "Windows 系统窗口",
  "window-cloaked": "窗口当前被系统隐藏",
  "fullscreen": "全屏窗口自动跳过",
  "no-compatible-window": "当前没有合格窗口",
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
  return compatibilityReasonLabels[reasonCode] ?? "当前窗口不满足接管条件";
}
