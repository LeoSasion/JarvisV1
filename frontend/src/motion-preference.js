import {
  getInterfacePreferencesSnapshot,
  subscribeInterfacePreferences,
} from "./interface-preferences.js";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const subscribers = new Set();
let systemMedia = null;
let unsubscribePreferences = null;

function notifySubscribers() {
  subscribers.forEach((listener) => listener());
}

function attachSharedSources() {
  unsubscribePreferences = subscribeInterfacePreferences(notifySubscribers);
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  systemMedia = window.matchMedia(REDUCED_MOTION_QUERY);
  if (typeof systemMedia.addEventListener === "function") {
    systemMedia.addEventListener("change", notifySubscribers);
  } else {
    systemMedia.addListener?.(notifySubscribers);
  }
}

function detachSharedSources() {
  unsubscribePreferences?.();
  unsubscribePreferences = null;
  if (typeof systemMedia?.removeEventListener === "function") {
    systemMedia.removeEventListener("change", notifySubscribers);
  } else {
    systemMedia?.removeListener?.(notifySubscribers);
  }
  systemMedia = null;
}

export function resolveReducedMotion(preference, systemReduced) {
  if (preference === "reduced") return true;
  if (preference === "full") return false;
  return Boolean(systemReduced);
}

function readSystemReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return (systemMedia ?? window.matchMedia(REDUCED_MOTION_QUERY)).matches;
}

export function getReducedMotionSnapshot() {
  return resolveReducedMotion(
    getInterfacePreferencesSnapshot().motion,
    readSystemReducedMotion(),
  );
}

export function getReducedMotionServerSnapshot() {
  return false;
}

export function subscribeReducedMotion(listener) {
  subscribers.add(listener);
  if (subscribers.size === 1) attachSharedSources();

  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) detachSharedSources();
  };
}
