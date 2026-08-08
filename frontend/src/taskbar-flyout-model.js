const MAX_FLYOUT_QUERY_LENGTH = 64;
const MAX_NATIVE_FLYOUT_ITEMS = 24;

function normalizeNativeFlyoutText(value, fallback, maximumLength) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return (normalized || fallback).slice(0, maximumLength);
}

function createRendererOwnedOverflowItem(
  item,
  window = item?.selectedWindow?.internalWindowId ? item.selectedWindow : null,
) {
  return {
    itemId: normalizeNativeFlyoutText(item?.id, "application", 256),
    windowId: typeof window?.windowId === "string" ? window.windowId.slice(0, 256) : null,
    label: normalizeNativeFlyoutText(window?.title ?? item?.label, "Application", 128),
    meta: window
      ? `INTERNAL WINDOW · ${window.active ? "ACTIVE" : window.minimized ? "MINIMIZED" : "READY"}`
      : item?.isPinned ? "PINNED APPLICATION" : "APPLICATION",
  };
}

export function getNativeTaskbarOverflowPayload(items = []) {
  const source = Array.isArray(items) ? items : [];
  const rendererItems = source.filter((item) =>
    !Array.isArray(item?.windows) || item.windows.length === 0 || item.windows.some((window) => window?.internalWindowId));
  const rendererItemIds = new Set(rendererItems.map((item) => item.id));
  const seenWindowIds = new Set();
  const windowIds = [];
  for (const item of source) {
    if (rendererItemIds.has(item?.id)) continue;
    for (const window of item?.windows ?? []) {
      if (typeof window?.windowId !== "string" || !window.windowId || seenWindowIds.has(window.windowId)) continue;
      seenWindowIds.add(window.windowId);
      windowIds.push(window.windowId);
      if (windowIds.length === MAX_NATIVE_FLYOUT_ITEMS) break;
    }
    if (windowIds.length === MAX_NATIVE_FLYOUT_ITEMS) break;
  }
  return {
    windowIds,
    items: rendererItems.slice(0, MAX_NATIVE_FLYOUT_ITEMS).map((item) =>
      createRendererOwnedOverflowItem(item)),
  };
}

export function getNativeInternalWindowItems(item) {
  return (Array.isArray(item?.windows) ? item.windows : [])
    .slice(0, MAX_NATIVE_FLYOUT_ITEMS)
    .map((window) => createRendererOwnedOverflowItem(item, window));
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
