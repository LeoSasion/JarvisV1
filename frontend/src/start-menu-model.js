import { normalizeSearchText } from "./quick-search.js";

const applicationNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const latinInitialPattern = /^[A-Z]$/;
const digitInitialPattern = /^\d$/;
const eastAsianInitialPattern = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;

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
  return {
    ...application,
    group: getApplicationGroupLabel(application.label),
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
  return applications.filter((application) => (
    queryTokens.every((token) => application.searchText.includes(token))
  ));
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
