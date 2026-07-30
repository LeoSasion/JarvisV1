const STORAGE_KEY = "jarvis.explorer.preferences.v1";
const VIEW_MODES = new Set(["list", "grid"]);
const SORT_KEYS = new Set(["name", "type", "modified", "size"]);
const SORT_DIRECTIONS = new Set(["ascending", "descending"]);
const entryCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export const DEFAULT_EXPLORER_PREFERENCES = Object.freeze({
  version: 1,
  viewMode: "list",
  sortKey: "name",
  sortDirection: "ascending",
});

export function normalizeExplorerPreferences(value) {
  return Object.freeze({
    version: 1,
    viewMode: VIEW_MODES.has(value?.viewMode)
      ? value.viewMode
      : DEFAULT_EXPLORER_PREFERENCES.viewMode,
    sortKey: SORT_KEYS.has(value?.sortKey)
      ? value.sortKey
      : DEFAULT_EXPLORER_PREFERENCES.sortKey,
    sortDirection: SORT_DIRECTIONS.has(value?.sortDirection)
      ? value.sortDirection
      : DEFAULT_EXPLORER_PREFERENCES.sortDirection,
  });
}

export function readExplorerPreferences() {
  if (typeof window === "undefined") return DEFAULT_EXPLORER_PREFERENCES;
  try {
    return normalizeExplorerPreferences(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"),
    );
  } catch {
    return DEFAULT_EXPLORER_PREFERENCES;
  }
}

export function writeExplorerPreferences(value) {
  const preferences = normalizeExplorerPreferences(value);
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    }
  } catch {
    // Explorer preferences remain active for the current session.
  }
  return preferences;
}

export function normalizeExplorerAddress(value) {
  return String(value ?? "")
    .replaceAll("\0", "")
    .trim()
    .slice(0, 2_048);
}

export function normalizeExplorerSearchQuery(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .slice(0, 96);
}

export function segmentExplorerSearchMatch(value, query) {
  const source = String(value ?? "");
  const normalizedSource = source.normalize("NFKC").toLocaleLowerCase();
  const normalizedQuery = normalizeExplorerSearchQuery(query);
  if (!source || !normalizedQuery) return [{ text: source, match: false }];
  const index = normalizedSource.indexOf(normalizedQuery);
  if (index < 0 || normalizedSource.length !== source.length) {
    return [{ text: source, match: false }];
  }
  return [
    ...(index > 0 ? [{ text: source.slice(0, index), match: false }] : []),
    { text: source.slice(index, index + normalizedQuery.length), match: true },
    ...(index + normalizedQuery.length < source.length
      ? [{ text: source.slice(index + normalizedQuery.length), match: false }]
      : []),
  ];
}

export function getExplorerSearchSummary(totalCount, visibleCount, query) {
  const total = Math.max(0, Math.floor(Number(totalCount) || 0));
  const visible = Math.max(0, Math.min(total, Math.floor(Number(visibleCount) || 0)));
  const filtered = Boolean(normalizeExplorerSearchQuery(query));
  return Object.freeze({
    total,
    visible,
    filtered,
    noMatches: filtered && visible === 0,
    label: filtered ? `${visible} OF ${total} ITEMS` : `${total} ITEMS`,
  });
}

export function getExplorerEscapeAction(state = {}) {
  if (state.addressEditing) return "cancel-address";
  if (state.pendingTransfer) return "cancel-transfer";
  if (state.commandDialog) return "cancel-dialog";
  if (normalizeExplorerSearchQuery(state.search)) return "clear-search";
  if (Number(state.selectionCount) > 0) return "clear-selection";
  return "close";
}

function compareEntryValue(left, right, key) {
  if (key === "type") {
    return entryCollator.compare(left.typeLabel ?? "", right.typeLabel ?? "") ||
      entryCollator.compare(left.extension ?? "", right.extension ?? "");
  }
  if (key === "modified") {
    const leftTime = Date.parse(left.modified ?? "") || 0;
    const rightTime = Date.parse(right.modified ?? "") || 0;
    return leftTime - rightTime;
  }
  if (key === "size") {
    return Number(left.sizeBytes ?? -1) - Number(right.sizeBytes ?? -1);
  }
  return entryCollator.compare(left.name ?? left.label ?? "", right.name ?? right.label ?? "");
}

export function sortExplorerEntries(entries, preferences) {
  const normalized = normalizeExplorerPreferences(preferences);
  const direction = normalized.sortDirection === "descending" ? -1 : 1;
  return entries.map((entry, index) => ({ entry, index }))
    .sort((left, right) => (
      Number(Boolean(right.entry.isDirectory)) - Number(Boolean(left.entry.isDirectory)) ||
      compareEntryValue(left.entry, right.entry, normalized.sortKey) * direction ||
      entryCollator.compare(left.entry.name ?? "", right.entry.name ?? "") ||
      left.index - right.index
    ))
    .map(({ entry }) => entry);
}

export function getExplorerGridColumnCount(width, viewMode) {
  if (viewMode !== "grid") return 1;
  const available = Math.max(116, Number(width) - 24);
  return Math.max(1, Math.floor((available + 7) / 123));
}

export function getExplorerKeyboardTarget(itemCount, currentIndex, key, columns = 1) {
  if (!Number.isInteger(itemCount) || itemCount <= 0) return -1;
  const safeIndex = Number.isInteger(currentIndex) && currentIndex >= 0 &&
    currentIndex < itemCount ? currentIndex : 0;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  if (key === "ArrowLeft") return Math.max(0, safeIndex - 1);
  if (key === "ArrowRight") return Math.min(itemCount - 1, safeIndex + 1);
  const safeColumns = Math.max(1, Math.floor(Number(columns) || 1));
  if (key === "ArrowUp") return Math.max(0, safeIndex - safeColumns);
  if (key === "ArrowDown") return Math.min(itemCount - 1, safeIndex + safeColumns);
  return safeIndex;
}

export function getExplorerKeyboardCommand(eventLike) {
  if (!eventLike) return null;
  const key = String(eventLike.key ?? "").toLocaleLowerCase();
  if (eventLike.altKey && !eventLike.ctrlKey && !eventLike.metaKey) {
    if (key === "arrowleft") return "back";
    if (key === "arrowright") return "forward";
    if (key === "arrowup") return "up";
    return null;
  }
  if ((eventLike.ctrlKey || eventLike.metaKey) && !eventLike.altKey) {
    if (eventLike.shiftKey && key === "c") return "copy-path";
    if (!eventLike.shiftKey && key === "l") return "focus-address";
    if (!eventLike.shiftKey && key === "f") return "focus-search";
  }
  if (!eventLike.ctrlKey && !eventLike.metaKey && !eventLike.altKey &&
      !eventLike.shiftKey && key === "f5") return "refresh";
  return null;
}

export function formatExplorerCopyPath(paths) {
  return paths
    .filter((path) => typeof path === "string" && path.trim())
    .map((path) => `"${path.replaceAll("\"", "\"\"")}"`)
    .join("\r\n");
}
