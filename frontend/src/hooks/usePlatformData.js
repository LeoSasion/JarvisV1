import { useSyncExternalStore } from "react";
import { platform } from "../platform/index.js";
import {
  mockDesktopEntries,
  mockSystemSnapshot,
  mockTaskbarSnapshot,
} from "../platform/mock-platform.js";
import {
  createSystemSnapshotProjector,
  normalizeDesktopEntries,
} from "../platform/presentation-data.js";

function createStore(initialValue) {
  let value = initialValue;
  const listeners = new Set();

  return {
    getSnapshot: () => value,
    set(nextValue) {
      if (Object.is(value, nextValue)) return;
      value = nextValue;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const WINDOW_APPEARANCE_MODES = new Set(["off", "conservative", "enhanced", "immersive"]);

function normalizeWindowAppearanceState(rawState = {}) {
  const requestedMode = rawState.mode ?? rawState.Mode;
  const mode = WINDOW_APPEARANCE_MODES.has(requestedMode) ? requestedMode : "off";
  const reportedEffectiveMode = rawState.effectiveMode ?? rawState.EffectiveMode;
  const effectiveMode = WINDOW_APPEARANCE_MODES.has(reportedEffectiveMode)
    ? reportedEffectiveMode
    : mode;
  const styledWindowCount = Number(rawState.styledWindowCount ?? rawState.StyledWindowCount ?? 0);
  const fallbackReason = rawState.fallbackReason ?? rawState.FallbackReason;

  return {
    mode,
    effectiveMode,
    osBuild: rawState.osBuild ?? rawState.OsBuild ?? null,
    windows11: Boolean(rawState.windows11 ?? rawState.Windows11),
    styledWindowCount: Number.isFinite(styledWindowCount) ? Math.max(0, styledWindowCount) : 0,
    fallbackReason: fallbackReason ? String(fallbackReason) : null,
    hooksReady: Boolean(rawState.hooksReady ?? rawState.HooksReady),
    hostIntegrityVerified: Boolean(
      rawState.hostIntegrityVerified ?? rawState.HostIntegrityVerified,
    ),
    safetyHotkeyRegistered: Boolean(
      rawState.safetyHotkeyRegistered ?? rawState.SafetyHotkeyRegistered,
    ),
    recoveryArmed: Boolean(rawState.recoveryArmed ?? rawState.RecoveryArmed),
    loading: false,
    error: null,
  };
}

function windowAppearanceStatesEqual(left, right) {
  return left.mode === right.mode &&
    left.effectiveMode === right.effectiveMode &&
    left.osBuild === right.osBuild &&
    left.windows11 === right.windows11 &&
    left.styledWindowCount === right.styledWindowCount &&
    left.fallbackReason === right.fallbackReason &&
    left.hooksReady === right.hooksReady &&
    left.hostIntegrityVerified === right.hostIntegrityVerified &&
    left.safetyHotkeyRegistered === right.safetyHotkeyRegistered &&
    left.recoveryArmed === right.recoveryArmed &&
    left.loading === right.loading &&
    left.error === right.error;
}

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const mockClock = {
  dateTime: "2026-07-20T22:47:00",
  time: "22:47",
  longDate: "Monday, 20 July 2026",
  shortDate: "20/07/2026",
};

function formatClock(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return mockClock;
  const safeDate = date;
  const day = safeDate.getDate();
  const month = safeDate.getMonth();
  const year = safeDate.getFullYear();
  const hours = String(safeDate.getHours()).padStart(2, "0");
  const minutes = String(safeDate.getMinutes()).padStart(2, "0");

  return {
    dateTime: safeDate.toISOString(),
    time: `${hours}:${minutes}`,
    longDate: `${weekdays[safeDate.getDay()]}, ${day} ${months[month]} ${year}`,
    shortDate: `${String(day).padStart(2, "0")}/${String(month + 1).padStart(2, "0")}/${year}`,
  };
}

function normalizeTaskbarSnapshot(snapshot = mockTaskbarSnapshot) {
  const foregroundWindowId = snapshot.foregroundWindowId ?? snapshot.ForegroundWindowId ?? null;
  const sourceWindows = snapshot.windows ?? snapshot.Windows ?? [];
  const windows = sourceWindows.flatMap((window, index) => {
    const windowId = window.windowId ?? window.WindowId;
    if (windowId === undefined || windowId === null) return [];
    const title = String(window.title ?? window.Title ?? "");
    const processName = String(window.processName ?? window.ProcessName ?? "");
    const applicationId = window.applicationId ?? window.ApplicationId ?? null;
    if (!processName) return [];

    return [{
      windowId,
      key: String(windowId),
      title,
      processName,
      pid: Number(window.pid ?? window.Pid ?? index),
      minimized: Boolean(window.minimized ?? window.Minimized),
      active: Boolean(window.active ?? window.Active) || String(windowId) === String(foregroundWindowId),
      applicationId: applicationId === null ? null : String(applicationId),
      iconDataUrl: window.iconDataUrl ?? window.IconDataUrl ?? null,
    }];
  });

  return { windows, foregroundWindowId, loading: false, error: null };
}

function taskbarSnapshotsEqual(left, right) {
  if (left.foregroundWindowId !== right.foregroundWindowId || left.windows.length !== right.windows.length) {
    return false;
  }

  return left.windows.every((window, index) => {
    const other = right.windows[index];
    return window.windowId === other.windowId &&
      window.title === other.title &&
      window.processName === other.processName &&
      window.pid === other.pid &&
      window.minimized === other.minimized &&
      window.active === other.active &&
      window.applicationId === other.applicationId &&
      window.iconDataUrl === other.iconDataUrl;
  });
}

function systemStatusesEqual(left, right) {
  return left.network.available === right.network.available &&
    left.network.interfaceName === right.network.interfaceName &&
    left.network.interfaceType === right.network.interfaceType &&
    left.power.batteryPresent === right.power.batteryPresent &&
    left.power.percentage === right.power.percentage &&
    left.power.charging === right.power.charging &&
    left.power.acConnected === right.power.acConnected;
}

function selectSystemTrayStatus(status) {
  return { network: status.network, power: status.power };
}

function normalizeApplicationCatalog(result = {}) {
  const source = result.applications ?? result.Applications ?? [];
  const seen = new Set();
  const applications = source.flatMap((application) => {
    const applicationId = application.applicationId ?? application.ApplicationId;
    const label = String(application.label ?? application.Label ?? "").trim();
    if (!applicationId || !label || seen.has(applicationId)) return [];
    const rawProcessNames = application.processNames ?? application.ProcessNames ?? [];
    const processNames = Array.isArray(rawProcessNames)
      ? [...new Set(rawProcessNames
        .map((processName) => String(processName ?? "").trim().toLowerCase().replace(/\.exe$/i, ""))
        .filter(Boolean))]
      : [];
    seen.add(applicationId);
    return [{
      applicationId: String(applicationId),
      label,
      category: String(application.category ?? application.Category ?? "Applications"),
      source: String(application.source ?? application.Source ?? "start-menu"),
      processNames,
      iconDataUrl: application.iconDataUrl ?? application.IconDataUrl ?? null,
    }];
  });

  return {
    applications,
    indexedAtUtc: result.indexedAtUtc ?? result.IndexedAtUtc ?? null,
    sourceCount: Number(result.sourceCount ?? result.SourceCount ?? 0),
    truncated: Boolean(result.truncated ?? result.Truncated),
    loading: false,
    error: null,
  };
}

const fallbackProjector = createSystemSnapshotProjector();
const initialSystemSnapshot = fallbackProjector(mockSystemSnapshot);
const systemStore = createStore(initialSystemSnapshot);
const systemStatusStore = createStore(selectSystemTrayStatus(initialSystemSnapshot.status));
const clockStore = createStore(mockClock);
const desktopStore = createStore({
  entries: normalizeDesktopEntries(mockDesktopEntries),
  loading: platform.isNative,
  error: null,
});
const applicationCatalogStore = createStore({
  applications: [],
  indexedAtUtc: null,
  sourceCount: 0,
  truncated: false,
  loading: true,
  error: null,
});
const taskbarStore = createStore({
  ...normalizeTaskbarSnapshot(mockTaskbarSnapshot),
  loading: platform.isNative,
});
const windowAppearanceStore = createStore({
  mode: "off",
  effectiveMode: "off",
  osBuild: null,
  windows11: false,
  styledWindowCount: 0,
  fallbackReason: null,
  loading: true,
  error: null,
});

const nativeProjector = createSystemSnapshotProjector();
let systemSubscribers = 0;
let stopSystemEvents = null;
let desktopLoaded = false;
let desktopRequest = null;
let applicationCatalogLoaded = false;
let applicationCatalogRequest = null;
let lastSystemTimestamp = null;
let taskbarSubscribers = 0;
let stopTaskbarEvents = null;
let windowAppearanceSubscribers = 0;
let stopWindowAppearanceEvents = null;
let windowAppearanceRequest = null;

function setWindowAppearanceState(nextState) {
  const current = windowAppearanceStore.getSnapshot();
  if (!windowAppearanceStatesEqual(current, nextState)) {
    windowAppearanceStore.set(nextState);
  }
}

function publishWindowAppearanceState(rawState) {
  setWindowAppearanceState(normalizeWindowAppearanceState(rawState));
}

function reportWindowAppearanceError(error) {
  const current = windowAppearanceStore.getSnapshot();
  setWindowAppearanceState({
    ...current,
    loading: false,
    error: error?.message ?? "Window appearance service is unavailable.",
  });
}

function startWindowAppearanceFeed() {
  if (!stopWindowAppearanceEvents) {
    stopWindowAppearanceEvents = platform.events.subscribe(
      "windowAppearance.changed",
      publishWindowAppearanceState,
    );
  }
  if (windowAppearanceRequest) return;

  windowAppearanceRequest = platform.windowAppearance.getState()
    .then(publishWindowAppearanceState)
    .catch(reportWindowAppearanceError)
    .finally(() => {
      windowAppearanceRequest = null;
    });
}

function subscribeToWindowAppearance(listener) {
  windowAppearanceSubscribers += 1;
  startWindowAppearanceFeed();
  const unsubscribe = windowAppearanceStore.subscribe(listener);
  return () => {
    unsubscribe();
    windowAppearanceSubscribers -= 1;
    if (windowAppearanceSubscribers === 0 && stopWindowAppearanceEvents) {
      stopWindowAppearanceEvents();
      stopWindowAppearanceEvents = null;
    }
  };
}

function publishSystemSnapshot(rawSnapshot) {
  const timestamp = rawSnapshot?.timestamp ?? rawSnapshot?.Timestamp;
  if (timestamp && timestamp === lastSystemTimestamp) return;
  lastSystemTimestamp = timestamp ?? lastSystemTimestamp;
  const projected = nativeProjector(rawSnapshot);
  systemStore.set(projected);
  const nextSystemStatus = selectSystemTrayStatus(projected.status);
  if (!systemStatusesEqual(nextSystemStatus, systemStatusStore.getSnapshot())) {
    systemStatusStore.set(nextSystemStatus);
  }
  const nextClock = formatClock(timestamp);
  const currentClock = clockStore.getSnapshot();
  if (nextClock.time !== currentClock.time || nextClock.shortDate !== currentClock.shortDate) {
    clockStore.set(nextClock);
  }
}

function startSystemFeed() {
  if (!platform.isNative || stopSystemEvents) return;
  stopSystemEvents = platform.events.subscribe("system.snapshot", publishSystemSnapshot);
  platform.system.getSnapshot().then(publishSystemSnapshot).catch(() => {
    // Keep the design-safe mock snapshot visible while the host recovers.
  });
}

function subscribeToSystem(listener) {
  systemSubscribers += 1;
  startSystemFeed();
  const unsubscribe = systemStore.subscribe(listener);
  return () => {
    unsubscribe();
    systemSubscribers -= 1;
    if (systemSubscribers === 0 && stopSystemEvents) {
      stopSystemEvents();
      stopSystemEvents = null;
    }
  };
}

function subscribeToClock(listener) {
  systemSubscribers += 1;
  startSystemFeed();
  const unsubscribe = clockStore.subscribe(listener);
  return () => {
    unsubscribe();
    systemSubscribers -= 1;
    if (systemSubscribers === 0 && stopSystemEvents) {
      stopSystemEvents();
      stopSystemEvents = null;
    }
  };
}

function subscribeToSystemStatus(listener) {
  systemSubscribers += 1;
  startSystemFeed();
  const unsubscribe = systemStatusStore.subscribe(listener);
  return () => {
    unsubscribe();
    systemSubscribers -= 1;
    if (systemSubscribers === 0 && stopSystemEvents) {
      stopSystemEvents();
      stopSystemEvents = null;
    }
  };
}

function publishTaskbarSnapshot(rawSnapshot) {
  const snapshot = normalizeTaskbarSnapshot(rawSnapshot);
  const current = taskbarStore.getSnapshot();
  if (taskbarSnapshotsEqual(snapshot, current) && !current.loading && !current.error) return;
  taskbarStore.set(snapshot);
}

function startTaskbarFeed() {
  if (stopTaskbarEvents) return;
  stopTaskbarEvents = platform.events.subscribe("taskbar.snapshot", publishTaskbarSnapshot);
  platform.taskbar.getSnapshot().then(publishTaskbarSnapshot).catch((error) => {
    taskbarStore.set({ ...taskbarStore.getSnapshot(), loading: false, error });
  });
}

function subscribeToTaskbar(listener) {
  taskbarSubscribers += 1;
  startTaskbarFeed();
  const unsubscribe = taskbarStore.subscribe(listener);
  return () => {
    unsubscribe();
    taskbarSubscribers -= 1;
    if (taskbarSubscribers === 0 && stopTaskbarEvents) {
      stopTaskbarEvents();
      stopTaskbarEvents = null;
    }
  };
}

export function refreshApplicationCatalog() {
  if (applicationCatalogRequest) return applicationCatalogRequest;
  applicationCatalogStore.set({
    ...applicationCatalogStore.getSnapshot(),
    loading: true,
    error: null,
  });
  applicationCatalogRequest = platform.shell.listApplications()
    .then((result) => {
      const catalog = normalizeApplicationCatalog(result);
      applicationCatalogLoaded = true;
      applicationCatalogStore.set(catalog);
      return catalog.applications;
    })
    .catch((error) => {
      applicationCatalogLoaded = false;
      applicationCatalogStore.set({
        ...applicationCatalogStore.getSnapshot(),
        loading: false,
        error,
      });
      return applicationCatalogStore.getSnapshot().applications;
    })
    .finally(() => {
      applicationCatalogRequest = null;
    });
  return applicationCatalogRequest;
}

function subscribeToApplicationCatalog(listener) {
  const unsubscribe = applicationCatalogStore.subscribe(listener);
  if (!applicationCatalogLoaded) refreshApplicationCatalog();
  return unsubscribe;
}

function subscribeToApplicationCatalogPassively(listener) {
  return applicationCatalogStore.subscribe(listener);
}

export function refreshDesktopEntries() {
  if (desktopRequest) return desktopRequest;
  desktopStore.set({ ...desktopStore.getSnapshot(), loading: platform.isNative, error: null });
  desktopRequest = platform.desktop.listEntries()
    .then((result) => {
      const entries = normalizeDesktopEntries(result, mockDesktopEntries);
      desktopLoaded = true;
      desktopStore.set({ entries, loading: false, error: null });
      return entries;
    })
    .catch((error) => {
      desktopLoaded = true;
      desktopStore.set({ ...desktopStore.getSnapshot(), loading: false, error });
      return desktopStore.getSnapshot().entries;
    })
    .finally(() => {
      desktopRequest = null;
    });
  return desktopRequest;
}

export async function setWindowAppearanceMode(mode) {
  if (!WINDOW_APPEARANCE_MODES.has(mode)) {
    throw new Error(`Unsupported window appearance mode: ${mode}`);
  }

  const current = windowAppearanceStore.getSnapshot();
  if (current.mode === mode && !current.error) return current;
  setWindowAppearanceState({ ...current, loading: true, error: null });

  try {
    const result = await platform.windowAppearance.setMode(mode);
    publishWindowAppearanceState(result);
    return windowAppearanceStore.getSnapshot();
  } catch (error) {
    reportWindowAppearanceError(error);
    throw error;
  }
}

function subscribeToDesktop(listener) {
  const unsubscribe = desktopStore.subscribe(listener);
  if (!desktopLoaded) refreshDesktopEntries();
  return unsubscribe;
}

export function useSystemSnapshot() {
  return useSyncExternalStore(
    subscribeToSystem,
    systemStore.getSnapshot,
    systemStore.getSnapshot,
  );
}

export function useDesktopEntries() {
  return useSyncExternalStore(
    subscribeToDesktop,
    desktopStore.getSnapshot,
    desktopStore.getSnapshot,
  );
}

export function useApplicationCatalog(enabled = true) {
  return useSyncExternalStore(
    enabled ? subscribeToApplicationCatalog : subscribeToApplicationCatalogPassively,
    applicationCatalogStore.getSnapshot,
    applicationCatalogStore.getSnapshot,
  );
}

export function usePlatformClock() {
  return useSyncExternalStore(
    subscribeToClock,
    clockStore.getSnapshot,
    clockStore.getSnapshot,
  );
}

export function useSystemTrayStatus() {
  return useSyncExternalStore(
    subscribeToSystemStatus,
    systemStatusStore.getSnapshot,
    systemStatusStore.getSnapshot,
  );
}

export function useTaskbarSnapshot() {
  return useSyncExternalStore(
    subscribeToTaskbar,
    taskbarStore.getSnapshot,
    taskbarStore.getSnapshot,
  );
}

export function useWindowAppearanceState() {
  return useSyncExternalStore(
    subscribeToWindowAppearance,
    windowAppearanceStore.getSnapshot,
    windowAppearanceStore.getSnapshot,
  );
}

export function usePlatformKind() {
  return platform.kind;
}
