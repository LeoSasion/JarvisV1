import { normalizeSearchText, parseQuickSearchQuery } from "./quick-search.js";

const STORAGE_KEY = "jarvis.quick-search.history.v1";
const MAX_HISTORY = 8;
const EMPTY_HISTORY = Object.freeze([]);
const listeners = new Set();
let storageListenerActive = false;

export function normalizeQuickSearchHistory(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.queries)) {
    return EMPTY_HISTORY;
  }
  const normalizedSeen = new Set();
  const queries = [];
  for (const candidate of value.queries) {
    if (typeof candidate !== "string") continue;
    const query = candidate.normalize("NFKC").trim().slice(0, 160);
    const parsed = parseQuickSearchQuery(query);
    const normalized = normalizeSearchText(parsed.query);
    if (!normalized || normalizedSeen.has(`${parsed.scope}:${normalized}`)) continue;
    normalizedSeen.add(`${parsed.scope}:${normalized}`);
    queries.push(query);
    if (queries.length >= MAX_HISTORY) break;
  }
  return queries.length > 0 ? Object.freeze(queries) : EMPTY_HISTORY;
}

function readHistory() {
  if (typeof window === "undefined") return EMPTY_HISTORY;
  try {
    return normalizeQuickSearchHistory(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"),
    );
  } catch {
    return EMPTY_HISTORY;
  }
}

let history = readHistory();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function persistHistory() {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        queries: history,
      }));
    }
  } catch {
    // Query history remains available for the current session.
  }
  emitChange();
}

function handleStorageChange(event) {
  if (event.key !== STORAGE_KEY) return;
  history = readHistory();
  emitChange();
}

export function getQuickSearchHistory() {
  return history;
}

export function subscribeQuickSearchHistory(listener) {
  listeners.add(listener);
  if (typeof window !== "undefined" && !storageListenerActive) {
    window.addEventListener("storage", handleStorageChange);
    storageListenerActive = true;
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined" && listeners.size === 0 && storageListenerActive) {
      window.removeEventListener("storage", handleStorageChange);
      storageListenerActive = false;
    }
  };
}

export function recordQuickSearchQuery(value) {
  const query = String(value ?? "").normalize("NFKC").trim().slice(0, 160);
  const parsed = parseQuickSearchQuery(query);
  const normalized = normalizeSearchText(parsed.query);
  if (!normalized) return;
  const key = `${parsed.scope}:${normalized}`;
  history = Object.freeze([
    query,
    ...history.filter((candidate) => {
      const current = parseQuickSearchQuery(candidate);
      return `${current.scope}:${normalizeSearchText(current.query)}` !== key;
    }),
  ].slice(0, MAX_HISTORY));
  persistHistory();
}

export function clearQuickSearchHistory() {
  if (history.length === 0) return false;
  history = EMPTY_HISTORY;
  persistHistory();
  return true;
}
