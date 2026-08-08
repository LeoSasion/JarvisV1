const MAX_FLYOUT_QUERY_LENGTH = 64;
const MAX_NATIVE_FLYOUT_ITEMS = 24;

function normalizeNativeFlyoutText(value, fallback, maximumLength) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return (normalized || fallback).slice(0, maximumLength);
}

function getWindowStateLabel(window) {
  return window?.active ? "ACTIVE" : window?.minimized ? "MINIMIZED" : "READY";
}

function createTaskbarOverflowItem(item) {
  const windows = Array.isArray(item?.windows) ? item.windows : [];
  const window = item?.selectedWindow ?? windows[0] ?? null;
  return {
    itemId: normalizeNativeFlyoutText(item?.id, "application", 256),
    windowId: typeof window?.windowId === "string" ? window.windowId.slice(0, 256) : null,
    label: normalizeNativeFlyoutText(item?.label, "Application", 128),
    meta: window?.internalWindowId
      ? `INTERNAL WINDOW · ${getWindowStateLabel(window)}`
      : window
        ? `${windows.length > 1 ? `${windows.length} WINDOWS · ` : ""}${getWindowStateLabel(window)}`
      : item?.isPinned ? "PINNED APPLICATION" : "APPLICATION",
  };
}

function createInternalWindowItem(item, window) {
  return {
    itemId: normalizeNativeFlyoutText(item?.id, "application", 256),
    windowId: typeof window?.windowId === "string" ? window.windowId.slice(0, 256) : null,
    label: normalizeNativeFlyoutText(window?.title ?? item?.label, "Application", 128),
    meta: `INTERNAL WINDOW · ${getWindowStateLabel(window)}`,
  };
}

export function getNativeTaskbarOverflowPayload(items = []) {
  const source = (Array.isArray(items) ? items : []).slice(0, MAX_NATIVE_FLYOUT_ITEMS);
  const seenWindowIds = new Set();
  const windowIds = [];
  for (const item of source) {
    const windows = Array.isArray(item?.windows) ? item.windows : [];
    const selectedWindow = item?.selectedWindow ?? windows[0] ?? null;
    if (selectedWindow?.internalWindowId || typeof selectedWindow?.windowId !== "string" || !selectedWindow.windowId) continue;
    if (seenWindowIds.has(selectedWindow.windowId)) continue;
    seenWindowIds.add(selectedWindow.windowId);
    windowIds.push(selectedWindow.windowId);
  }
  return {
    windowIds,
    items: source.map(createTaskbarOverflowItem),
  };
}

export function getNativeInternalWindowItems(item) {
  return (Array.isArray(item?.windows) ? item.windows : [])
    .slice(0, MAX_NATIVE_FLYOUT_ITEMS)
    .map((window) => createInternalWindowItem(item, window));
}

export function normalizeTaskbarFlyoutQuery(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .slice(0, MAX_FLYOUT_QUERY_LENGTH);
}

export function filterTaskbarFlyoutEntries(entries, query) {
  const normalizedQuery = normalizeTaskbarFlyoutQuery(query);
  const source = Array.isArray(entries) ? entries : [];
  if (!normalizedQuery) return source;
  return source.filter((entry) => String(entry?.searchText ?? `${entry?.label ?? ""} ${entry?.meta ?? ""}`)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .includes(normalizedQuery));
}

export function getTaskbarFlyoutKeyboardTarget(itemCount, currentIndex, key) {
  if (!Number.isInteger(itemCount) || itemCount <= 0) return -1;
  const safeIndex = Number.isInteger(currentIndex) &&
    currentIndex >= 0 &&
    currentIndex < itemCount
    ? currentIndex
    : 0;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  if (key === "ArrowUp") return (safeIndex - 1 + itemCount) % itemCount;
  if (key === "ArrowDown") return (safeIndex + 1) % itemCount;
  return safeIndex;
}

export function getTaskbarOverflowSummary(entries, visibleEntries = entries) {
  const source = Array.isArray(entries) ? entries : [];
  const visible = Array.isArray(visibleEntries) ? visibleEntries.length : 0;
  const running = source.filter((entry) => entry?.window || entry?.item?.windows?.length > 0).length;
  const pinned = source.filter((entry) => entry?.item?.isPinned).length;
  return Object.freeze({
    total: source.length,
    visible,
    running,
    pinned,
    label: `${visible === source.length ? visible : `${visible}/${source.length}`} APPS · ${running} RUNNING · ${pinned} PINNED`,
  });
}
