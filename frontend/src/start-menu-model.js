import { normalizeSearchText } from "./quick-search.js";

const applicationNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const latinInitialPattern = /^[A-Z]$/;
const digitInitialPattern = /^\d$/;
const eastAsianInitialPattern = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;
const wordBoundaryPattern = /[\s._\-()[\]{}]+/;
export const START_MENU_GROUP_ROW_HEIGHT = 34;
export const START_MENU_APPLICATION_ROW_HEIGHT = 57;

function getApplicationGroupLabel(label) {
  const initial = String(label ?? "").normalize("NFKC").trim().charAt(0).toUpperCase();
  if (latinInitialPattern.test(initial)) return initial;
  if (digitInitialPattern.test(initial)) return "0–9";
  if (eastAsianInitialPattern.test(initial)) return "中";
  return "#";
}

function getGroupOrder(label) {
  if (latinInitialPattern.test(label)) return label.charCodeAt(0);
  if (label === "0–9") return 1_000;
  if (label === "中") return 1_001;
  return 1_002;
}

function prepareMenuApplication(application) {
  const normalizedLabel = normalizeSearchText(application.label);
  return {
    ...application,
    group: getApplicationGroupLabel(application.label),
    normalizedLabel,
    searchText: normalizeSearchText([
      application.label,
      application.category,
      application.source,
      application.keywords,
      application.source === "packaged" ? "Microsoft Store UWP Windows app 商店 应用" : "Start Menu 开始菜单",
    ].join(" ")),
  };
}

export function buildStartMenuApplications(pinnedApplications, installedApplications) {
  const seenLabels = new Set();
  const applications = [];

  pinnedApplications.forEach((application) => {
    const normalizedLabel = normalizeSearchText(application.label);
    if (!normalizedLabel || seenLabels.has(normalizedLabel)) return;
    seenLabels.add(normalizedLabel);
    applications.push(prepareMenuApplication({
      menuId: `pinned:${application.id}`,
      kind: "pinned",
      label: application.label,
      category: "Pinned",
      source: "pinned",
      keywords: application.keywords,
      pinnedApplication: application,
      iconDataUrl: null,
    }));
  });

  installedApplications.forEach((application) => {
    const normalizedLabel = normalizeSearchText(application.label);
    if (!normalizedLabel || seenLabels.has(normalizedLabel)) return;
    seenLabels.add(normalizedLabel);
    applications.push(prepareMenuApplication({
      menuId: `installed:${application.applicationId}`,
      kind: "installed",
      applicationId: application.applicationId,
      label: application.label,
      category: application.category,
      source: application.source,
      processes: application.processNames ?? [],
      application,
      iconDataUrl: application.iconDataUrl ?? null,
    }));
  });

  return [...applications].sort((left, right) => (
    applicationNameCollator.compare(left.label, right.label) ||
    left.menuId.localeCompare(right.menuId)
  ));
}

export function filterStartMenuApplications(applications, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return applications;
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  const ranked = [];

  applications.forEach((application) => {
    if (!queryTokens.every((token) => application.searchText.includes(token))) return;
    const label = application.normalizedLabel;
    const labelWords = label.split(wordBoundaryPattern).filter(Boolean);
    let score = label === normalizedQuery
      ? 0
      : label.startsWith(normalizedQuery)
        ? 10
        : 30;

    queryTokens.forEach((token) => {
      const labelIndex = label.indexOf(token);
      if (labelIndex === 0) {
        score -= 4;
      } else if (labelWords.some((word) => word.startsWith(token))) {
        score -= 2;
      } else if (labelIndex >= 0) {
        score += Math.min(labelIndex, 20);
      } else {
        score += 40;
      }
    });
    ranked.push({ application, score });
  });

  ranked.sort((left, right) => (
    left.score - right.score ||
    applicationNameCollator.compare(left.application.label, right.application.label) ||
    left.application.menuId.localeCompare(right.application.menuId)
  ));
  return ranked.map(({ application }) => application);
}

export function groupStartMenuApplications(applications) {
  const groups = new Map();
  applications.forEach((application) => {
    if (!groups.has(application.group)) groups.set(application.group, []);
    groups.get(application.group).push(application);
  });

  return Array.from(groups, ([label, items]) => ({ label, items }))
    .sort((left, right) => getGroupOrder(left.label) - getGroupOrder(right.label));
}

export function createStartMenuVirtualRows(groups, columns = 2) {
  const safeColumns = Math.max(1, Math.floor(columns));
  const rows = [];
  let top = 0;

  groups.forEach((group) => {
    rows.push({
      key: `group:${group.label}`,
      kind: "group",
      label: group.label,
      top,
      height: START_MENU_GROUP_ROW_HEIGHT,
    });
    top += START_MENU_GROUP_ROW_HEIGHT;

    for (let index = 0; index < group.items.length; index += safeColumns) {
      const items = group.items.slice(index, index + safeColumns);
      rows.push({
        key: `apps:${group.label}:${index}`,
        kind: "applications",
        items,
        top,
        height: START_MENU_APPLICATION_ROW_HEIGHT,
      });
      top += START_MENU_APPLICATION_ROW_HEIGHT;
    }
  });

  return { rows, totalHeight: top };
}

export function getStartMenuVirtualWindow(
  rows,
  scrollTop,
  viewportHeight,
  overscanRows = 3,
) {
  if (rows.length === 0) return [];
  const safeScrollTop = Math.max(0, Number(scrollTop) || 0);
  const safeViewportHeight = Math.max(1, Number(viewportHeight) || 1);
  const firstVisible = rows.findIndex((row) => row.top + row.height > safeScrollTop);
  if (firstVisible < 0) return rows.slice(-Math.max(1, overscanRows));

  let lastVisible = firstVisible;
  const visibleBottom = safeScrollTop + safeViewportHeight;
  while (lastVisible < rows.length && rows[lastVisible].top < visibleBottom) {
    lastVisible += 1;
  }

  const start = Math.max(0, firstVisible - overscanRows);
  const end = Math.min(rows.length, lastVisible + overscanRows);
  return rows.slice(start, end);
}
