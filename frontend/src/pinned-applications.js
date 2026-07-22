const STORAGE_KEY = "jarvis.pinned-applications.v1";
const LEGACY_ORDER_KEY = "jarvis.taskbar.pinned-order.v1";
const MAX_PINNED_APPLICATIONS = 16;
const unsafeIdentifierCharacterPattern = /[\s\u0000-\u001f\u007f"'\\/]/u;

const DEFAULT_PINNED_APPLICATIONS = Object.freeze([
  Object.freeze({ kind: "builtin", id: "explorer" }),
  Object.freeze({ kind: "builtin", id: "code" }),
  Object.freeze({ kind: "builtin", id: "terminal" }),
  Object.freeze({ kind: "builtin", id: "jarvis-settings" }),
]);

const listeners = new Set();
let browserListenersActive = false;

function isSafeIdentifier(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    Array.from(value).every((character) =>
      !charIsUnsafe(character));
}

function charIsUnsafe(character) {
  return unsafeIdentifierCharacterPattern.test(character);
}

function normalizeReference(value) {
  if (!value || typeof value !== "object") return null;
  if (value.kind === "builtin" && isSafeIdentifier(value.id)) {
    return Object.freeze({ kind: "builtin", id: value.id });
  }
  if (value.kind === "installed" && isSafeIdentifier(value.applicationId)) {
    return Object.freeze({ kind: "installed", applicationId: value.applicationId });
  }
  return null;
}

export function getPinnedApplicationKey(reference) {
  if (reference?.kind === "builtin") return `builtin:${reference.id}`;
  if (reference?.kind === "installed") return `installed:${reference.applicationId}`;
  return null;
}

function normalizeReferences(values) {
  if (!Array.isArray(values)) return null;
  const references = [];
  const seen = new Set();
  for (const value of values) {
    const reference = normalizeReference(value);
    const key = getPinnedApplicationKey(reference);
    if (!reference || !key || seen.has(key)) continue;
    seen.add(key);
    references.push(reference);
    if (references.length >= MAX_PINNED_APPLICATIONS) break;
  }
  return Object.freeze(references);
}

function readLegacyPinnedApplications() {
  try {
    const order = JSON.parse(window.localStorage.getItem(LEGACY_ORDER_KEY) ?? "null");
    if (!Array.isArray(order)) return DEFAULT_PINNED_APPLICATIONS;
    const references = normalizeReferences(order.map((id) => ({
      kind: "builtin",
      id: id === "settings" ? "jarvis-settings" : id,
    })));
    return references?.length ? references : DEFAULT_PINNED_APPLICATIONS;
  } catch {
    return DEFAULT_PINNED_APPLICATIONS;
  }
}

function readPinnedApplications() {
  if (typeof window === "undefined") return DEFAULT_PINNED_APPLICATIONS;
  try {
    const serialized = window.localStorage.getItem(STORAGE_KEY);
    if (serialized === null) return readLegacyPinnedApplications();
    const parsed = JSON.parse(serialized);
    if (!parsed || parsed.version !== 1) return DEFAULT_PINNED_APPLICATIONS;
    return normalizeReferences(parsed.applications) ?? DEFAULT_PINNED_APPLICATIONS;
  } catch {
    return DEFAULT_PINNED_APPLICATIONS;
  }
}

let pinnedApplications = readPinnedApplications();

function referencesEqual(left, right) {
  return left.length === right.length && left.every((reference, index) =>
    getPinnedApplicationKey(reference) === getPinnedApplicationKey(right[index]));
}

function emitChange() {
  listeners.forEach((listener) => listener());
}

function refreshFromStorage() {
  const nextApplications = readPinnedApplications();
  if (referencesEqual(pinnedApplications, nextApplications)) return;
  pinnedApplications = nextApplications;
  emitChange();
}

function handleStorageChange(event) {
  if (event.type === "storage" && event.key !== STORAGE_KEY) return;
  refreshFromStorage();
}

function persist(nextApplications) {
  pinnedApplications = Object.freeze(nextApplications);
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        applications: pinnedApplications,
      }));
    }
  } catch {
    // Keep the current-session registry usable when browser storage is disabled.
  }
  emitChange();
}

export function getPinnedApplications() {
  return pinnedApplications;
}

export function subscribeToPinnedApplications(listener) {
  listeners.add(listener);
  if (typeof window !== "undefined" && !browserListenersActive) {
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("focus", handleStorageChange);
    browserListenersActive = true;
  }

  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined" && listeners.size === 0 && browserListenersActive) {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("focus", handleStorageChange);
      browserListenersActive = false;
    }
  };
}

export function pinApplication(reference) {
  const normalizedReference = normalizeReference(reference);
  const key = getPinnedApplicationKey(normalizedReference);
  if (!normalizedReference || !key || pinnedApplications.some((item) =>
    getPinnedApplicationKey(item) === key)) return;
  persist([...pinnedApplications, normalizedReference].slice(0, MAX_PINNED_APPLICATIONS));
}

export function unpinApplication(key) {
  if (typeof key !== "string") return;
  const nextApplications = pinnedApplications.filter((reference) =>
    getPinnedApplicationKey(reference) !== key);
  if (nextApplications.length === pinnedApplications.length) return;
  persist(nextApplications);
}

export function reorderPinnedApplication(sourceKey, targetKey) {
  if (!sourceKey || !targetKey || sourceKey === targetKey) return;
  const sourceIndex = pinnedApplications.findIndex((reference) =>
    getPinnedApplicationKey(reference) === sourceKey);
  const targetIndex = pinnedApplications.findIndex((reference) =>
    getPinnedApplicationKey(reference) === targetKey);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const nextApplications = pinnedApplications.slice();
  nextApplications.splice(targetIndex, 0, nextApplications.splice(sourceIndex, 1)[0]);
  persist(nextApplications);
}

export function movePinnedApplication(key, direction) {
  const sourceIndex = pinnedApplications.findIndex((reference) =>
    getPinnedApplicationKey(reference) === key);
  if (sourceIndex < 0) return;
  const targetIndex = Math.max(
    0,
    Math.min(pinnedApplications.length - 1, sourceIndex + direction),
  );
  if (sourceIndex === targetIndex) return;
  const nextApplications = pinnedApplications.slice();
  nextApplications.splice(targetIndex, 0, nextApplications.splice(sourceIndex, 1)[0]);
  persist(nextApplications);
}
