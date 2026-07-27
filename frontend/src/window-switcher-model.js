export const WINDOW_SWITCHER_VISIBLE_LIMIT = 7;

function read(value, camelName, pascalName, fallback = null) {
  return value?.[camelName] ?? value?.[pascalName] ?? fallback;
}

function normalizeWindow(window, index) {
  return {
    windowId: String(read(window, "windowId", "WindowId", `window-${index}`)),
    title: String(read(window, "title", "Title", "Untitled window")),
    processName: String(read(window, "processName", "ProcessName", "application")),
    pid: Number(read(window, "pid", "Pid", 0)),
    minimized: Boolean(read(window, "minimized", "Minimized", false)),
    active: Boolean(read(window, "active", "Active", false)),
    iconDataUrl: read(window, "iconDataUrl", "IconDataUrl"),
  };
}

function wrap(index, count) {
  return ((index % count) + count) % count;
}

export function normalizeWindowSwitcherState(rawState = {}) {
  const rawWindows = read(rawState, "windows", "Windows", []);
  const windows = Array.isArray(rawWindows)
    ? rawWindows.map(normalizeWindow)
    : [];
  const rawSelectedIndex = Number(read(rawState, "selectedIndex", "SelectedIndex", 0));
  const selectedIndex = windows.length === 0
    ? -1
    : wrap(Number.isFinite(rawSelectedIndex) ? Math.trunc(rawSelectedIndex) : 0, windows.length);
  return {
    windows,
    selectedIndex,
    reverse: Boolean(read(rawState, "reverse", "Reverse", false)),
  };
}

export function advanceWindowSwitcherState(state, reverse = false) {
  const normalized = normalizeWindowSwitcherState(state);
  if (normalized.windows.length === 0) return normalized;
  return {
    ...normalized,
    selectedIndex: wrap(
      normalized.selectedIndex + (reverse ? -1 : 1),
      normalized.windows.length,
    ),
    reverse,
  };
}

export function getVisibleWindowSwitcherEntries(state, limit = WINDOW_SWITCHER_VISIBLE_LIMIT) {
  const normalized = normalizeWindowSwitcherState(state);
  const count = normalized.windows.length;
  if (count === 0) return [];
  const maximum = Math.max(1, Math.min(Math.trunc(limit), WINDOW_SWITCHER_VISIBLE_LIMIT, count));
  if (count <= maximum) {
    return normalized.windows.map((window, index) => ({
      window,
      index,
      selected: index === normalized.selectedIndex,
    }));
  }

  const before = Math.floor(maximum / 2);
  return Array.from({ length: maximum }, (_, offset) => {
    const index = wrap(normalized.selectedIndex - before + offset, count);
    return {
      window: normalized.windows[index],
      index,
      selected: index === normalized.selectedIndex,
    };
  });
}

export function getWindowInitials(processName) {
  const compact = String(processName ?? "")
    .replaceAll(/[^a-z0-9]+/giu, " ")
    .trim();
  if (!compact) return "UI";
  const words = compact.split(/\s+/u);
  return words.length > 1
    ? words.slice(0, 2).map((word) => word[0]).join("").toUpperCase()
    : compact.slice(0, 2).toUpperCase();
}
