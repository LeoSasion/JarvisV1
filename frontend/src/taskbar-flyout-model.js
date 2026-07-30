const MAX_FLYOUT_QUERY_LENGTH = 64;

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
