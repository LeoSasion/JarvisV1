export function createVolumeCommitScheduler(
  commit,
  delay = 160,
  timers = globalThis,
) {
  let timerId = null;
  let pendingValue = null;
  let lastCommittedValue = null;

  const cancel = () => {
    if (timerId !== null) timers.clearTimeout(timerId);
    timerId = null;
    pendingValue = null;
  };

  const flush = (value = pendingValue) => {
    if (timerId !== null) timers.clearTimeout(timerId);
    timerId = null;
    pendingValue = null;
    const normalized = Math.min(100, Math.max(0, Math.round(Number(value))));
    if (!Number.isFinite(normalized) || normalized === lastCommittedValue) return false;
    lastCommittedValue = normalized;
    void commit(normalized);
    return true;
  };

  const schedule = (value) => {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) return;
    pendingValue = normalized;
    if (timerId !== null) timers.clearTimeout(timerId);
    timerId = timers.setTimeout(() => flush(), Math.max(0, delay));
  };

  return Object.freeze({ cancel, flush, schedule });
}
