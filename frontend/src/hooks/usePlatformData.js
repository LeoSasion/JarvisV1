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
import {
  normalizeWindowAppearanceProcessName,
  normalizeWindowAppearanceRules,
  normalizeWindowCompatibilityMatrix,
} from "../window-appearance-model.js";

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
const TASKBAR_MODES = new Set(["native", "hybrid", "full"]);

function normalizeTaskbarModeState(rawState = {}) {
  const reportedRequestedMode = rawState.requestedMode ?? rawState.RequestedMode;
  const requestedMode = TASKBAR_MODES.has(reportedRequestedMode)
    ? reportedRequestedMode
    : "native";
  const reportedEffectiveMode = rawState.effectiveMode ?? rawState.EffectiveMode;
  const effectiveMode = TASKBAR_MODES.has(reportedEffectiveMode)
    ? reportedEffectiveMode
    : "native";
  const fallbackReason = rawState.fallbackReason ?? rawState.FallbackReason;
  return {
    requestedMode,
    effectiveMode,
    fallbackReason: fallbackReason ? String(fallbackReason) : null,
    hybridAvailable: Boolean(rawState.hybridAvailable ?? rawState.HybridAvailable),
    safeMode: Boolean(rawState.safeMode ?? rawState.SafeMode),
    loading: false,
    error: null,
  };
}

function taskbarModeStatesEqual(left, right) {
  return left.requestedMode === right.requestedMode &&
    left.effectiveMode === right.effectiveMode &&
    left.fallbackReason === right.fallbackReason &&
    left.hybridAvailable === right.hybridAvailable &&
    left.safeMode === right.safeMode &&
    left.loading === right.loading &&
    left.error === right.error;
}

export function normalizeTraySnapshot(rawSnapshot = {}) {
  const rawAudio = rawSnapshot.audio ?? rawSnapshot.Audio ?? {};
  const rawNetwork = rawSnapshot.network ?? rawSnapshot.Network ?? {};
  const rawPower = rawSnapshot.power ?? rawSnapshot.Power ?? {};
  const reportedVolume = Number(rawAudio.volumePercent ?? rawAudio.VolumePercent);
  const volumePercent = Number.isFinite(reportedVolume)
    ? Math.max(0, Math.min(100, Math.round(reportedVolume)))
    : null;

  return {
    timestamp: rawSnapshot.timestamp ?? rawSnapshot.Timestamp ?? null,
    audio: {
      available: Boolean(rawAudio.available ?? rawAudio.Available),
      volumePercent,
      muted: Boolean(rawAudio.muted ?? rawAudio.Muted),
      deviceLabel: rawAudio.deviceLabel ?? rawAudio.DeviceLabel ?? null,
      error: rawAudio.error ?? rawAudio.Error ?? null,
    },
    network: {
      available: Boolean(rawNetwork.isAvailable ?? rawNetwork.IsAvailable ?? rawNetwork.available),
      interfaceName: rawNetwork.interfaceName ?? rawNetwork.InterfaceName ?? null,
      interfaceType: rawNetwork.interfaceType ?? rawNetwork.InterfaceType ?? null,
    },
    power: {
      batteryPresent: Boolean(rawPower.batteryPresent ?? rawPower.BatteryPresent),
      percentage: rawPower.percentage ?? rawPower.Percentage ?? null,
      charging: Boolean(rawPower.charging ?? rawPower.Charging),
      acConnected: Boolean(rawPower.acConnected ?? rawPower.AcConnected),
    },
    simulation: Boolean(rawSnapshot.simulation ?? rawSnapshot.Simulation ?? !platform.isNative),
    loading: false,
    error: null,
  };
}

function traySnapshotsEqual(left, right) {
  return left.audio.available === right.audio.available &&
    left.audio.volumePercent === right.audio.volumePercent &&
    left.audio.muted === right.audio.muted &&
    left.audio.deviceLabel === right.audio.deviceLabel &&
    left.audio.error === right.audio.error &&
    left.network.available === right.network.available &&
    left.network.interfaceName === right.network.interfaceName &&
    left.network.interfaceType === right.network.interfaceType &&
    left.power.batteryPresent === right.power.batteryPresent &&
    left.power.percentage === right.power.percentage &&
    left.power.charging === right.power.charging &&
    left.power.acConnected === right.power.acConnected &&
    left.simulation === right.simulation &&
    left.loading === right.loading &&
    left.error === right.error;
}

export function normalizeSystemFeed(rawSnapshot = {}) {
  const sourceItems = rawSnapshot.items ?? rawSnapshot.Items ?? [];
  const items = (Array.isArray(sourceItems) ? sourceItems : [])
    .slice(0, 50)
    .map((item, index) => ({
      id: String(item.id ?? item.Id ?? `feed-${index}`),
      type: String(item.type ?? item.Type ?? "runtime.event"),
      severity: ["ok", "warning", "error"].includes(item.severity ?? item.Severity)
        ? (item.severity ?? item.Severity)
        : "info",
      title: String(item.title ?? item.Title ?? "JARVIS event"),
      detail: String(item.detail ?? item.Detail ?? ""),
      timestamp: item.timestamp ?? item.Timestamp ?? null,
      unread: Boolean(item.unread ?? item.Unread),
      actionId: item.actionId ?? item.ActionId ?? null,
    }));
  const reportedUnread = Number(rawSnapshot.unreadCount ?? rawSnapshot.UnreadCount);
  const unreadCount = Number.isFinite(reportedUnread)
    ? Math.max(0, Math.min(items.length, Math.round(reportedUnread)))
    : items.filter((item) => item.unread).length;

  return {
    items,
    unreadCount,
    capacity: Math.max(1, Number(rawSnapshot.capacity ?? rawSnapshot.Capacity ?? 50)),
    loading: false,
    error: null,
  };
}

function systemFeedsEqual(left, right) {
  if (left.unreadCount !== right.unreadCount ||
      left.capacity !== right.capacity ||
      left.loading !== right.loading ||
      left.error !== right.error ||
      left.items.length !== right.items.length) {
    return false;
  }
  return left.items.every((item, index) => {
    const other = right.items[index];
    return item.id === other.id &&
      item.type === other.type &&
      item.severity === other.severity &&
      item.title === other.title &&
      item.detail === other.detail &&
      item.timestamp === other.timestamp &&
      item.unread === other.unread &&
      item.actionId === other.actionId;
  });
}

export function normalizeWindowAppearanceState(rawState = {}) {
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
    rules: normalizeWindowAppearanceRules(rawState.rules ?? rawState.Rules),
    compatibilityMatrix: normalizeWindowCompatibilityMatrix(
      rawState.compatibilityMatrix ?? rawState.CompatibilityMatrix,
    ),
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
    windowAppearanceRulesEqual(left.rules, right.rules) &&
    windowCompatibilityMatricesEqual(left.compatibilityMatrix, right.compatibilityMatrix) &&
    left.loading === right.loading &&
    left.error === right.error;
}

function windowAppearanceRulesEqual(left = [], right = []) {
  return left.length === right.length && left.every((rule, index) =>
    rule.processName === right[index]?.processName &&
    rule.action === right[index]?.action);
}

function windowCompatibilityMatricesEqual(left = [], right = []) {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return entry.processName === other?.processName &&
      entry.windowCount === other.windowCount &&
      entry.eligibleWindowCount === other.eligibleWindowCount &&
      entry.styledWindowCount === other.styledWindowCount &&
      entry.decision === other.decision &&
      entry.reasonCode === other.reasonCode;
  });
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
    revision: Number(result.revision ?? result.Revision ?? 0),
    refreshReason: String(result.refreshReason ?? result.RefreshReason ?? "initial"),
    watching: Boolean(result.watching ?? result.Watching),
    watchRootCount: Number(result.watchRootCount ?? result.WatchRootCount ?? 0),
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
  revision: 0,
  refreshReason: "initial",
  watching: false,
  watchRootCount: 0,
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
  rules: [],
  compatibilityMatrix: [],
  loading: true,
  error: null,
});
const taskbarModeStore = createStore({
  requestedMode: "native",
  effectiveMode: "native",
  fallbackReason: null,
  hybridAvailable: false,
  safeMode: false,
  loading: true,
  error: null,
});
const trayStore = createStore(normalizeTraySnapshot({
  audio: {
    available: false,
    volumePercent: null,
    muted: false,
    error: "Waiting for the Windows audio service.",
  },
  network: initialSystemSnapshot.status.network,
  power: initialSystemSnapshot.status.power,
}));
const systemFeedStore = createStore({
  items: [],
  unreadCount: 0,
  capacity: 50,
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
let applicationCatalogSubscribers = 0;
let stopApplicationCatalogEvents = null;
let lastSystemTimestamp = null;
let taskbarSubscribers = 0;
let stopTaskbarEvents = null;
let windowAppearanceSubscribers = 0;
let stopWindowAppearanceEvents = null;
let windowAppearanceRequest = null;
let taskbarModeSubscribers = 0;
let stopTaskbarModeEvents = null;
let taskbarModeRequest = null;
let traySubscribers = 0;
let stopTrayEvents = null;
let trayRequest = null;
let systemFeedSubscribers = 0;
let stopSystemFeedEvents = null;
let systemFeedRequest = null;

function setSystemFeedState(nextState) {
  const current = systemFeedStore.getSnapshot();
  if (!systemFeedsEqual(current, nextState)) {
    systemFeedStore.set(nextState);
  }
}

function publishSystemFeed(rawSnapshot) {
  setSystemFeedState(normalizeSystemFeed(rawSnapshot));
}

function reportSystemFeedError(error) {
  setSystemFeedState({
    ...systemFeedStore.getSnapshot(),
    loading: false,
    error: error?.message ?? "JARVIS system feed is unavailable.",
  });
}

function startSystemEventFeed() {
  if (!stopSystemFeedEvents) {
    stopSystemFeedEvents = platform.events.subscribe("feed.snapshot", publishSystemFeed);
  }
  if (systemFeedRequest) return;
  systemFeedRequest = platform.feed.getSnapshot()
    .then(publishSystemFeed)
    .catch(reportSystemFeedError)
    .finally(() => {
      systemFeedRequest = null;
    });
}

function subscribeToSystemFeed(listener) {
  systemFeedSubscribers += 1;
  startSystemEventFeed();
  const unsubscribe = systemFeedStore.subscribe(listener);
  return () => {
    unsubscribe();
    systemFeedSubscribers -= 1;
    if (systemFeedSubscribers === 0 && stopSystemFeedEvents) {
      stopSystemFeedEvents();
      stopSystemFeedEvents = null;
    }
  };
}

function setTrayState(nextState) {
  const current = trayStore.getSnapshot();
  if (!traySnapshotsEqual(current, nextState)) {
    trayStore.set(nextState);
  }
}

function publishTraySnapshot(rawSnapshot) {
  setTrayState(normalizeTraySnapshot(rawSnapshot));
}

function reportTrayError(error) {
  const current = trayStore.getSnapshot();
  setTrayState({
    ...current,
    loading: false,
    error: error?.message ?? "Windows tray state is unavailable.",
  });
}

function startTrayFeed() {
  if (!stopTrayEvents) {
    stopTrayEvents = platform.events.subscribe("tray.snapshot", publishTraySnapshot);
  }
  if (trayRequest) return;
  trayRequest = platform.tray.getSnapshot()
    .then(publishTraySnapshot)
    .catch(reportTrayError)
    .finally(() => {
      trayRequest = null;
    });
}

function subscribeToTray(listener) {
  traySubscribers += 1;
  startTrayFeed();
  const unsubscribe = trayStore.subscribe(listener);
  return () => {
    unsubscribe();
    traySubscribers -= 1;
    if (traySubscribers === 0 && stopTrayEvents) {
      stopTrayEvents();
      stopTrayEvents = null;
    }
  };
}

function setTaskbarModeState(nextState) {
  const current = taskbarModeStore.getSnapshot();
  if (!taskbarModeStatesEqual(current, nextState)) {
    taskbarModeStore.set(nextState);
  }
}

function publishTaskbarModeState(rawState) {
  setTaskbarModeState(normalizeTaskbarModeState(rawState));
}

function reportTaskbarModeError(error) {
  const current = taskbarModeStore.getSnapshot();
  setTaskbarModeState({
    ...current,
    loading: false,
    error: error?.message ?? "Taskbar mode service is unavailable.",
  });
}

function startTaskbarModeFeed() {
  if (!stopTaskbarModeEvents) {
    stopTaskbarModeEvents = platform.events.subscribe(
      "taskbarMode.changed",
      publishTaskbarModeState,
    );
  }
  if (taskbarModeRequest) return;

  taskbarModeRequest = platform.taskbarMode.getState()
    .then(publishTaskbarModeState)
    .catch(reportTaskbarModeError)
    .finally(() => {
      taskbarModeRequest = null;
    });
}

function subscribeToTaskbarMode(listener) {
  taskbarModeSubscribers += 1;
  startTaskbarModeFeed();
  const unsubscribe = taskbarModeStore.subscribe(listener);
  return () => {
    unsubscribe();
    taskbarModeSubscribers -= 1;
    if (taskbarModeSubscribers === 0 && stopTaskbarModeEvents) {
      stopTaskbarModeEvents();
      stopTaskbarModeEvents = null;
    }
  };
}

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

function publishApplicationCatalog(rawCatalog) {
  const catalog = normalizeApplicationCatalog(rawCatalog);
  const current = applicationCatalogStore.getSnapshot();
  if (catalog.revision > 0 && catalog.revision < current.revision) return;
  if (catalog.revision === current.revision &&
      catalog.indexedAtUtc === current.indexedAtUtc &&
      !current.loading &&
      !current.error) {
    return;
  }

  applicationCatalogLoaded = true;
  applicationCatalogStore.set(catalog);
}

function startApplicationCatalogFeed() {
  if (!stopApplicationCatalogEvents) {
    stopApplicationCatalogEvents = platform.events.subscribe(
      "shell.applicationsChanged",
      publishApplicationCatalog,
    );
  }
}

export function refreshApplicationCatalog(force = false) {
  if (applicationCatalogRequest) return applicationCatalogRequest;
  applicationCatalogStore.set({
    ...applicationCatalogStore.getSnapshot(),
    loading: true,
    error: null,
  });
  const request = force && platform.shell.refreshApplications
    ? platform.shell.refreshApplications()
    : platform.shell.listApplications();
  applicationCatalogRequest = request
    .then((result) => {
      const catalog = normalizeApplicationCatalog(result);
      applicationCatalogLoaded = true;
      publishApplicationCatalog(catalog);
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
  applicationCatalogSubscribers += 1;
  startApplicationCatalogFeed();
  const unsubscribe = applicationCatalogStore.subscribe(listener);
  if (!applicationCatalogLoaded) refreshApplicationCatalog();
  return () => {
    unsubscribe();
    applicationCatalogSubscribers -= 1;
    if (applicationCatalogSubscribers === 0 && stopApplicationCatalogEvents) {
      stopApplicationCatalogEvents();
      stopApplicationCatalogEvents = null;
    }
  };
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

export async function setWindowAppearanceRule(processNameValue, action) {
  const processName = normalizeWindowAppearanceProcessName(processNameValue);
  if (!processName || !["allow", "deny"].includes(action)) {
    throw new Error("Window appearance rules require a process name and allow or deny.");
  }

  const current = windowAppearanceStore.getSnapshot();
  setWindowAppearanceState({ ...current, loading: true, error: null });
  try {
    const result = await platform.windowAppearance.setRule(processName, action);
    publishWindowAppearanceState(result);
    return windowAppearanceStore.getSnapshot();
  } catch (error) {
    reportWindowAppearanceError(error);
    throw error;
  }
}

export async function removeWindowAppearanceRule(processNameValue) {
  const processName = normalizeWindowAppearanceProcessName(processNameValue);
  if (!processName) {
    throw new Error("Window appearance rules require a process name.");
  }

  const current = windowAppearanceStore.getSnapshot();
  setWindowAppearanceState({ ...current, loading: true, error: null });
  try {
    const result = await platform.windowAppearance.removeRule(processName);
    publishWindowAppearanceState(result);
    return windowAppearanceStore.getSnapshot();
  } catch (error) {
    reportWindowAppearanceError(error);
    throw error;
  }
}

export async function setTaskbarMode(mode) {
  if (!TASKBAR_MODES.has(mode)) {
    throw new Error(`Unsupported taskbar mode: ${mode}`);
  }

  const current = taskbarModeStore.getSnapshot();
  if (current.requestedMode === mode && !current.error) return current;
  setTaskbarModeState({ ...current, loading: true, error: null });

  try {
    const result = await platform.taskbarMode.setMode(mode);
    publishTaskbarModeState(result);
    return taskbarModeStore.getSnapshot();
  } catch (error) {
    reportTaskbarModeError(error);
    throw error;
  }
}

export async function setTrayVolume(volumePercent) {
  const numericVolume = Number(volumePercent);
  if (!Number.isInteger(numericVolume) || numericVolume < 0 || numericVolume > 100) {
    throw new Error("Volume must be an integer between 0 and 100.");
  }

  const result = await platform.tray.setVolume(numericVolume);
  publishTraySnapshot(result);
  return trayStore.getSnapshot();
}

export async function setTrayMuted(muted) {
  const result = await platform.tray.setMuted(Boolean(muted));
  publishTraySnapshot(result);
  return trayStore.getSnapshot();
}

export async function markSystemFeedRead() {
  const result = await platform.feed.markAllRead();
  publishSystemFeed(result);
  return systemFeedStore.getSnapshot();
}

export async function clearSystemFeed() {
  const result = await platform.feed.clear();
  publishSystemFeed(result);
  return systemFeedStore.getSnapshot();
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

export function useTaskbarModeState() {
  return useSyncExternalStore(
    subscribeToTaskbarMode,
    taskbarModeStore.getSnapshot,
    taskbarModeStore.getSnapshot,
  );
}

export function useTrayStatus() {
  return useSyncExternalStore(
    subscribeToTray,
    trayStore.getSnapshot,
    trayStore.getSnapshot,
  );
}

export function useSystemFeed() {
  return useSyncExternalStore(
    subscribeToSystemFeed,
    systemFeedStore.getSnapshot,
    systemFeedStore.getSnapshot,
  );
}

export function usePlatformKind() {
  return platform.kind;
}
