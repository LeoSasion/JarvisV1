const MAX_RESULTS = 9;
const SEARCH_SEPARATORS = /[^\p{L}\p{N}._:/\\-]+/gu;

export function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(SEARCH_SEPARATORS, " ")
    .trim();
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
  if (!normalizedQuery) return item.priority;

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
  settingItems,
  windows,
  desktopEntries,
}) {
  const indexed = [];
  const applicationLabels = new Set();

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
    indexed.push(prepareSearchItem({
      resultId: `installed-app:${application.applicationId}`,
      kind: "installed-app",
      category: "INSTALLED APP",
      label: application.label,
      detail: `${isPackagedApplication ? "Windows app" : "Start Menu"} · ${application.category}`,
      keywords: `${application.category} ${application.source} installed application app 开始菜单 已安装 应用 ${isPackagedApplication ? "Microsoft Store UWP packaged Windows 商店" : ""}`,
      iconDataUrl: application.iconDataUrl ?? null,
      application,
      priority: 86 - Math.min(index, 48),
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
  const normalizedQuery = normalizeSearchText(query);
  const scored = [];

  index.forEach((item) => {
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
