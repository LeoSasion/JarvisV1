export function getTaskbarCooldownRemaining(retryAfterUtc, now = Date.now()) {
  const retryAfterTimestamp = retryAfterUtc
    ? Date.parse(retryAfterUtc)
    : Number.NaN;
  return Number.isFinite(retryAfterTimestamp)
    ? Math.max(0, Math.ceil((retryAfterTimestamp - now) / 1000))
    : 0;
}

export function canRetryTaskbarMode(state, busy, now = Date.now()) {
  if (busy ||
      state.safeMode ||
      state.requestedMode === state.effectiveMode) {
    return false;
  }

  return state.retryAllowed ||
    (state.transitionStatus === "cooldown" &&
      getTaskbarCooldownRemaining(state.retryAfterUtc, now) === 0);
}

export function getTaskbarTransitionToast(previous, current) {
  if (previous.status !== "applying" ||
      previous.generation !== current.transitionGeneration ||
      current.transitionStatus === "applying") {
    return null;
  }

  if (current.transitionStatus === "settled") {
    return `任务栏模式已切换至 ${current.effectiveMode.toUpperCase()}`;
  }

  if (current.transitionStatus === "cooldown") {
    return "任务栏已恢复至 Windows，自动接管进入冷却";
  }

  return `任务栏已安全回退至 ${current.effectiveMode.toUpperCase()}`;
}
