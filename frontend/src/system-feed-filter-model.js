const FEED_FILTERS = new Set(["all", "unread", "attention", "status"]);
const FEED_FILTER_ORDER = Object.freeze(["all", "unread", "attention", "status"]);

export function normalizeSystemFeedFilter(value) {
  return FEED_FILTERS.has(value) ? value : "all";
}

export function getSystemFeedFilterShortcut(eventLike) {
  if (
    !eventLike ||
    !(eventLike.ctrlKey || eventLike.metaKey) ||
    eventLike.altKey ||
    eventLike.shiftKey
  ) {
    return null;
  }
  const index = Number.parseInt(String(eventLike.key ?? ""), 10) - 1;
  return Number.isInteger(index) ? FEED_FILTER_ORDER[index] ?? null : null;
}

export function filterSystemFeed(items, options = {}) {
  const filter = normalizeSystemFeedFilter(options.filter);
  const query = String(options.query ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .slice(0, 96);
  return (Array.isArray(items) ? items : []).filter((item) => {
    const severity = String(item?.severity ?? "info").toLocaleLowerCase();
    if (filter === "unread" && !item?.unread) return false;
    if (filter === "attention" && !["warning", "error"].includes(severity)) return false;
    if (filter === "status" && !["ok", "info"].includes(severity)) return false;
    if (!query) return true;
    return `${item?.title ?? ""} ${item?.detail ?? ""}`
      .normalize("NFKC")
      .toLocaleLowerCase()
      .includes(query);
  });
}

export function getSystemFeedFilterSummary(items, visibleItems) {
  const total = Array.isArray(items) ? items.length : 0;
  const visible = Array.isArray(visibleItems) ? visibleItems.length : 0;
  const visibleUnread = (Array.isArray(visibleItems) ? visibleItems : [])
    .filter((item) => item?.unread)
    .length;
  return {
    total,
    visible,
    visibleUnread,
    label: visible === total ? `${total} EVENTS` : `${visible} OF ${total} EVENTS`,
  };
}
