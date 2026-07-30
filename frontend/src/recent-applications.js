const STORAGE_KEY = "jarvis.recent-applications.v1";
const MAX_RECENT_APPLICATIONS = 12;
const EMPTY_RECENT_APPLICATIONS = Object.freeze([]);

const listeners = new Set();
let storageListenerActive = false;

export function normalizeRecentApplicationIds(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.applicationIds)) {
    return EMPTY_RECENT_APPLICATIONS;
  }

  const seen = new Set();
  const applicationIds = [];
  for (const applicationId of value.applicationIds) {
    if (typeof applicationId !== "string" ||
        !applicationId ||
        applicationId.length > 64 ||
        seen.has(applicationId)) continue;
    seen.add(applicationId);
    applicationIds.push(applicationId);
    if (applicationIds.length >= MAX_RECENT_APPLICATIONS) break;
  }
  return applicationIds.length > 0
    ? Object.freeze(applicationIds)
    : EMPTY_RECENT_APPLICATIONS;
}

function readRecentApplicationIds() {
  if (typeof window === "undefined") return EMPTY_RECENT_APPLICATIONS;
  try {
    return normalizeRecentApplicationIds(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"),
    );
  } catch {
    return EMPTY_RECENT_APPLICATIONS;
  }
}

let recentApplicationIds = readRecentApplicationIds();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function handleStorageChange(event) {
  if (event.key !== STORAGE_KEY) return;
  recentApplicationIds = readRecentApplicationIds();
  emitChange();
}

export function getRecentApplicationIds() {
  return recentApplicationIds;
}

export function subscribeToRecentApplications(listener) {
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

export function recordRecentApplication(applicationId) {
  if (typeof applicationId !== "string" || !applicationId || applicationId.length > 64) return;
  const nextIds = Object.freeze([
    applicationId,
    ...recentApplicationIds.filter((currentId) => currentId !== applicationId),
  ].slice(0, MAX_RECENT_APPLICATIONS));
  recentApplicationIds = nextIds;

  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        applicationIds: nextIds,
      }));
    }
  } catch {
    // Recency remains available for this session when browser storage is disabled.
  }

  emitChange();
}

export function clearRecentApplications() {
  if (recentApplicationIds.length === 0) return;
  recentApplicationIds = EMPTY_RECENT_APPLICATIONS;
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        applicationIds: [],
      }));
    }
  } catch {
    // The current session still clears immediately.
  }
  emitChange();
}
