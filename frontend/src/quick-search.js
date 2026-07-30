const MAX_RESULTS = 9;
const SEARCH_SEPARATORS = /[^\p{L}\p{N}._:/\\-]+/gu;
const QUICK_SEARCH_SCOPE_PATTERN = /^(app|win|file|set):\s*/iu;
const QUICK_SEARCH_SCOPE_KINDS = Object.freeze({
  app: Object.freeze(["app", "installed-app"]),
  win: Object.freeze(["window"]),
  file: Object.freeze(["desktop"]),
  set: Object.freeze(["setting"]),
});

export const quickSearchScopes = Object.freeze([
  Object.freeze({ id: "all", prefix: "", label: "ALL", detail: "Everything" }),
  Object.freeze({ id: "app", prefix: "app:", label: "APPS", detail: "Installed applications" }),
  Object.freeze({ id: "win", prefix: "win:", label: "WINDOWS", detail: "Open windows" }),
  Object.freeze({ id: "file", prefix: "file:", label: "FILES", detail: "Desktop items" }),
  Object.freeze({ id: "set", prefix: "set:", label: "SETTINGS", detail: "Windows settings" }),
]);

export function isQuickSearchToggleShortcut(eventLike) {
  return Boolean(
    eventLike &&
    !eventLike.defaultPrevented &&
    (eventLike.ctrlKey || eventLike.metaKey) &&
    !eventLike.altKey &&
    !eventLike.shiftKey &&
    eventLike.code === "Space",
  );
}

export function getQuickSearchScopeShortcut(eventLike) {
  if (
    !eventLike ||
    !(eventLike.ctrlKey || eventLike.metaKey) ||
    eventLike.altKey ||
    eventLike.shiftKey
  ) {
    return null;
  }
  const index = Number.parseInt(String(eventLike.key ?? ""), 10) - 1;
  return Number.isInteger(index) && quickSearchScopes[index]
    ? quickSearchScopes[index].id
    : null;
}

export function parseQuickSearchQuery(value) {
  const source = String(value ?? "").slice(0, 160).trimStart();
  const match = source.match(QUICK_SEARCH_SCOPE_PATTERN);
  if (!match) return { scope: "all", query: source.trim() };
  return {
    scope: match[1].toLocaleLowerCase(),
    query: source.slice(match[0].length).trim(),
  };
}

export function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(SEARCH_SEPARATORS, " ")
    .trim();
}

export function segmentSearchMatch(value, query) {
  const source = String(value ?? "");
  const normalizedSource = source.normalize("NFKC").toLocaleLowerCase();
  if (!source || normalizedSource.length !== source.length) {
    return [{ text: source, match: false }];
  }

  const tokens = String(query ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .split(SEARCH_SEPARATORS)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  if (tokens.length === 0) {
    return [{ text: source, match: false }];
  }

  const ranges = [];
  for (const token of tokens) {
    let fromIndex = 0;
    while (fromIndex < normalizedSource.length && ranges.length < 32) {
      const index = normalizedSource.indexOf(token, fromIndex);
      if (index < 0) break;
      ranges.push([index, index + token.length]);
      fromIndex = index + token.length;
    }
    if (ranges.length >= 32) break;
  }
  if (ranges.length === 0) {
    return [{ text: source, match: false }];
  }

  ranges.sort((left, right) => left[0] - right[0] || right[1] - left[1]);
  const merged = [];
  ranges.forEach(([start, end]) => {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) {
      previous[1] = Math.max(previous[1], end);
    } else {
      merged.push([start, end]);
    }
  });

  const segments = [];
  let offset = 0;
  merged.forEach(([start, end]) => {
    if (start > offset) {
      segments.push({ text: source.slice(offset, start), match: false });
    }
    segments.push({ text: source.slice(start, end), match: true });
    offset = end;
  });
  if (offset < source.length) {
    segments.push({ text: source.slice(offset), match: false });
  }
  return segments;
}

function getSubsequenceScore(text, query) {
  if (!query || query.length < 2) return 0;
  let queryIndex = 0;
  let firstMatch = -1;
  let lastMatch = -1;

  for (let index = 0; index < text.length && queryIndex < query.length; index += 1) {
    if (text[index] !== query[queryIndex]) continue;
    if (firstMatch < 0) firstMatch = index;
    lastMatch = index;
    queryIndex += 1;
  }

  if (queryIndex !== query.length) return 0;
  const span = lastMatch - firstMatch + 1;
  return Math.max(20, 180 - firstMatch * 3 - (span - query.length) * 5);
}

function scoreSearchItem(item, normalizedQuery) {
  if (!normalizedQuery) return item.emptyPriority ?? item.priority;

  const label = item.normalizedLabel;
  const detail = item.normalizedDetail;
  const searchText = item.searchText;
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);

  if (label === normalizedQuery) return 1_200 + item.priority;
  if (label.startsWith(normalizedQuery)) return 1_000 + item.priority;
  if (label.includes(normalizedQuery)) return 820 + item.priority;
  if (detail.startsWith(normalizedQuery)) return 700 + item.priority;
  if (searchText.includes(normalizedQuery)) return 620 + item.priority;
  if (queryTokens.every((token) => searchText.includes(token))) {
    return 500 + queryTokens.length * 24 + item.priority;
  }

  const compactQuery = normalizedQuery.replaceAll(" ", "");
  const compactLabel = label.replaceAll(" ", "");
  const subsequenceScore = getSubsequenceScore(compactLabel, compactQuery);
  return subsequenceScore > 0 ? subsequenceScore + item.priority : 0;
}

function prepareSearchItem(item) {
  const normalizedLabel = normalizeSearchText(item.label);
  const normalizedDetail = normalizeSearchText(item.detail);
  return {
    ...item,
    normalizedLabel,
    normalizedDetail,
    searchText: normalizeSearchText(`${item.label} ${item.detail} ${item.keywords ?? ""}`),
  };
}

export function createQuickSearchIndex({
  launchItems,
  installedApplications = [],
  recentApplicationIds = [],
  settingItems,
  windows,
  desktopEntries,
}) {
  const indexed = [];
  const applicationLabels = new Set();
  const recentApplicationRanks = new Map();

  for (const applicationId of Array.isArray(recentApplicationIds) ? recentApplicationIds : []) {
    if (recentApplicationRanks.size >= 12) break;
    if (typeof applicationId !== "string" ||
        !applicationId ||
        applicationId.length > 64 ||
        recentApplicationRanks.has(applicationId)) continue;
    recentApplicationRanks.set(applicationId, recentApplicationRanks.size);
  }

  launchItems.forEach((item) => {
    applicationLabels.add(normalizeSearchText(item.label));
    indexed.push(prepareSearchItem({
      ...item,
      resultId: `app:${item.id}`,
      kind: "app",
      category: "APPLICATION",
      detail: item.id === "explorer" ? "Browse files and folders" : `Launch ${item.label}`,
    }));
  });

  installedApplications.forEach((application, index) => {
    const normalizedLabel = normalizeSearchText(application.label);
    if (!normalizedLabel || applicationLabels.has(normalizedLabel)) return;
    applicationLabels.add(normalizedLabel);
    const isPackagedApplication = application.source === "packaged";
    const priority = 86 - Math.min(index, 48);
    const recentRank = recentApplicationRanks.get(application.applicationId);
    indexed.push(prepareSearchItem({
      resultId: `installed-app:${application.applicationId}`,
      kind: "installed-app",
      category: "INSTALLED APP",
      label: application.label,
      detail: `${isPackagedApplication ? "Windows app" : "Start Menu"} · ${application.category}`,
      keywords: `${application.category} ${application.source} installed application app 开始菜单 已安装 应用 ${isPackagedApplication ? "Microsoft Store UWP packaged Windows 商店" : ""}`,
      iconDataUrl: application.iconDataUrl ?? null,
      application,
      priority,
      emptyPriority: recentRank === undefined
        ? priority
        : 180 - Math.min(recentRank, 11) * 6,
    }));
  });

  windows.forEach((window, index) => {
    const title = String(window.title ?? "").trim();
    const processName = String(window.processName ?? "Application").replace(/\.exe$/i, "");
    indexed.push(prepareSearchItem({
      resultId: `window:${window.windowId}`,
      kind: "window",
      category: "OPEN WINDOW",
      label: title || processName,
      detail: `${processName}${window.minimized ? " · minimized" : window.active ? " · active" : " · running"}`,
      keywords: `switch activate window 切换 窗口 ${processName}`,
      iconDataUrl: window.iconDataUrl ?? null,
      window,
      priority: 88 - Math.min(index, 24) + (window.active ? 8 : 0),
    }));
  });

  desktopEntries.forEach((entry, index) => {
    const label = String(entry.label ?? entry.name ?? "Desktop item");
    indexed.push(prepareSearchItem({
      resultId: `desktop:${entry.id ?? entry.path ?? index}`,
      kind: "desktop",
      category: entry.kind === "directory" ? "DESKTOP FOLDER" : "DESKTOP ITEM",
      label,
      detail: entry.path ?? entry.target ?? "Windows desktop",
      keywords: `${entry.kind ?? "item"} desktop file folder 桌面 文件 文件夹`,
      entry,
      priority: 78 - Math.min(index, 32),
    }));
  });

  settingItems.forEach((item) => {
    indexed.push(prepareSearchItem({
      ...item,
      resultId: `setting:${item.id}`,
      kind: "setting",
      category: "WINDOWS SETTING",
      label: item.searchLabel ?? item.label,
      detail: item.target,
    }));
  });

  return indexed;
}

export function searchQuickIndex(index, query, limit = MAX_RESULTS) {
  const parsed = parseQuickSearchQuery(query);
  const normalizedQuery = normalizeSearchText(parsed.query);
  const allowedKinds = QUICK_SEARCH_SCOPE_KINDS[parsed.scope] ?? null;
  const scored = [];

  index.forEach((item) => {
    if (allowedKinds && !allowedKinds.includes(item.kind)) return;
    const score = scoreSearchItem(item, normalizedQuery);
    if (score <= 0) return;
    scored.push({ item, score });
  });

  scored.sort((left, right) => (
    right.score - left.score ||
    left.item.label.localeCompare(right.item.label, undefined, { sensitivity: "base" })
  ));

  return scored.slice(0, limit).map(({ item }) => item);
}
