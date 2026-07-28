import {
  AlertRegular,
  Battery6Regular,
  ChevronUpRegular,
  DismissRegular,
  MoreHorizontalRegular,
  PlugConnectedRegular,
  PulseRegular,
  SearchRegular,
  Speaker2Regular,
  SpeakerOffRegular,
  Wifi4Regular,
  WindowAppsRegular,
} from "@fluentui/react-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  usePlatformClock,
  usePlatformKind,
  useApplicationCatalog,
  useSystemFeed,
  useTrayStatus,
  useTaskbarSnapshot,
} from "../hooks/usePlatformData.js";
import { usePinnedApplicationRefs } from "../hooks/usePinnedApplications.js";
import {
  movePinnedApplication,
  reorderPinnedApplication,
  unpinApplication,
} from "../pinned-applications.js";
import {
  getMenuApplicationPinKey,
  resolvePinnedApplications,
} from "../pinned-application-model.js";
import { quickLaunchItems } from "../quick-search-catalog.js";
import { buildStartMenuApplications } from "../start-menu-model.js";
import {
  getRunningGroupKey,
  getTaskbarContextActionIds,
  normalizeProcessName,
  partitionWindowsByPinnedApplications,
  reconcileRunningTaskbarOrder,
} from "../taskbar-grouping.js";

const processDisplayNames = {
  applicationframehost: "Windows app",
  calculatorapp: "Calculator",
  chrome: "Google Chrome",
  explorer: "File Explorer",
  firefox: "Mozilla Firefox",
  msedge: "Microsoft Edge",
  mspaint: "Paint",
  notepad: "Notepad",
  paintstudio: "Paint",
  powershell: "PowerShell",
  taskmgr: "Task Manager",
};

function createTaskbarPinnedApps(applications) {
  return applications.map((application) => ({
    id: getMenuApplicationPinKey(application),
    label: application.label,
    Icon: application.pinnedApplication?.Icon ?? WindowAppsRegular,
    iconDataUrl: application.iconDataUrl ?? null,
    processes: application.pinnedApplication?.processes ?? application.processes ?? [],
    applicationId: application.applicationId ?? null,
    kind: application.kind,
    application: application.application ?? null,
    pinnedApplication: application.pinnedApplication ?? null,
  }));
}

function selectAppWindow(windows) {
  return windows.find((window) => window.active)
    ?? windows.find((window) => !window.minimized)
    ?? windows[0]
    ?? null;
}

function getProcessLabel(processName, fallbackTitle) {
  const normalized = normalizeProcessName(processName);
  if (normalized === "applicationframehost" && fallbackTitle) return fallbackTitle;
  if (processDisplayNames[normalized]) return processDisplayNames[normalized];
  return normalized
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildTaskbarItems(windows, pinnedApps, runningOrder, internalWindows = []) {
  const { matchedWindowsByApplication, unmatchedWindows } =
    partitionWindowsByPinnedApplications(windows, pinnedApps);
  const consumedInternalWindowIds = new Set();
  const pinnedItems = pinnedApps.map((app, index) => {
    const internalMatches = internalWindows.filter((window) => window.taskbarItemId === app.id);
    internalMatches.forEach((window) => consumedInternalWindowIds.add(window.windowId));
    const appWindows = [...matchedWindowsByApplication[index], ...internalMatches];
    return {
      ...app,
      isPinned: true,
      windows: appWindows,
      selectedWindow: selectAppWindow(appWindows),
    };
  });

  const runningGroups = new Map();
  unmatchedWindows.forEach((window) => {
    const processName = normalizeProcessName(window.processName);
    const groupKey = getRunningGroupKey(window);
    let group = runningGroups.get(groupKey);
    if (!group) {
      group = {
        id: `running:${groupKey}`,
        label: getProcessLabel(processName, window.title),
        Icon: WindowAppsRegular,
        isPinned: false,
        windows: [],
      };
      runningGroups.set(groupKey, group);
    }
    group.windows.push(window);
  });
  internalWindows
    .filter((window) => !consumedInternalWindowIds.has(window.windowId))
    .forEach((window) => {
      runningGroups.set(window.taskbarItemId, {
        id: window.taskbarItemId,
        label: window.title,
        Icon: window.internalWindowId === "inspector" ? PulseRegular : WindowAppsRegular,
        isPinned: false,
        windows: [window],
      });
    });

  const runningItems = Array.from(runningGroups.values(), (group) => ({
    ...group,
    selectedWindow: selectAppWindow(group.windows),
  }));
  const orderById = new Map(runningOrder.map((id, index) => [id, index]));
  runningItems.sort((left, right) => {
    const leftIsInternal = left.windows.some((window) => window.internalWindowId);
    const rightIsInternal = right.windows.some((window) => window.internalWindowId);
    if (leftIsInternal !== rightIsInternal) return leftIsInternal ? -1 : 1;
    const leftIndex = orderById.get(left.id);
    const rightIndex = orderById.get(right.id);
    if (leftIndex === undefined && rightIndex === undefined) return 0;
    if (leftIndex === undefined) return 1;
    if (rightIndex === undefined) return -1;
    return leftIndex - rightIndex;
  });

  return [...pinnedItems, ...runningItems];
}

function useTaskbarCapacity(containerRef) {
  const [capacity, setCapacity] = useState(8);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const update = () => {
      const nextCapacity = Math.max(5, Math.floor(container.clientWidth / 56));
      setCapacity((current) => current === nextCapacity ? current : nextCapacity);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);

  return capacity;
}

function TaskbarAppIcon({ item }) {
  const iconDataUrl = item.selectedWindow?.iconDataUrl
    ?? item.windows.find((window) => window.iconDataUrl)?.iconDataUrl
    ?? item.iconDataUrl;
  if (iconDataUrl) {
    return <img className="taskbar-native-icon" src={iconDataUrl} alt="" />;
  }

  const Icon = item.Icon;
  return <Icon />;
}

function getContextActionLabel(action, item) {
  if (action === "launch") return item.windows.length > 0 ? "Open new instance" : "Open";
  if (action === "close") return item.windows.length > 1
    ? `Close all ${item.windows.length} windows`
    : "Close window";
  return "Unpin from JARVIS";
}

function TaskbarLocalFlyout({ flyout, onActivate, onCloseWindow, onContextAction, onDismiss }) {
  if (flyout.mode === "context") {
    return (
      <section className="taskbar-flyout-mock is-context" aria-label={`${flyout.item.label} commands`}>
        <header>
          <span>APP COMMANDS</span>
          <small>{flyout.item.label}</small>
          <button type="button" onClick={onDismiss} aria-label="Close taskbar commands"><DismissRegular /></button>
        </header>
        <div className="taskbar-context-actions">
          {flyout.actions.map((action) => (
            <button type="button" key={action} onClick={() => onContextAction(flyout.item, action)}>
              {getContextActionLabel(action, flyout.item)}
            </button>
          ))}
        </div>
      </section>
    );
  }

  const entries = flyout.mode === "windows"
    ? flyout.item.windows.map((window) => ({
      key: window.windowId,
      label: window.title,
      meta: `${window.processName} · ${window.minimized ? "MINIMIZED" : window.active ? "ACTIVE" : "READY"}`,
      window,
      item: flyout.item,
    }))
    : flyout.items.map((item) => ({
      key: item.id,
      label: item.label,
      meta: item.selectedWindow?.title ?? (item.isPinned ? "PINNED APPLICATION" : "RUNNING APPLICATION"),
      window: item.selectedWindow ?? null,
      item,
    }));

  return (
    <section className={`taskbar-flyout-mock is-${flyout.mode}`} aria-label={flyout.mode === "windows" ? "Window previews" : "Taskbar overflow"}>
      <header>
        <span>{flyout.mode === "windows" ? "WINDOW GROUP" : "TASK OVERFLOW"}</span>
        <small>{entries.length} {flyout.mode === "windows" ? "OPEN WINDOWS" : "APPLICATIONS"}</small>
        <button type="button" onClick={onDismiss} aria-label="Close taskbar flyout"><DismissRegular /></button>
      </header>
      <div className="taskbar-flyout-grid">
        {entries.map((entry) => (
          <article key={entry.key} className={entry.window?.active ? "is-active" : ""}>
            {flyout.mode === "windows" ? <div className="mock-window-thumbnail" aria-hidden="true"><WindowAppsRegular /></div> : null}
            <button type="button" className="mock-window-main" onClick={() => onActivate(entry.item, entry.window)}>
              <TaskbarAppIcon item={entry.item} />
              <span><strong>{entry.label}</strong><small>{entry.meta}</small></span>
            </button>
            {entry.window ? (
              <button
                type="button"
                className="mock-window-close"
                aria-label={`Close ${entry.label}`}
                title={`Close ${entry.label}`}
                onClick={() => onCloseWindow(entry.window.windowId)}
              >
                <DismissRegular />
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

export function Taskbar({
  activeApp,
  internalWindows = [],
  onAppClick,
  onOpenCommand,
  onOpenStart,
  onOpenQuickSettings,
  onOpenNotifications,
  onShowFlyout,
  onHideFlyout,
  onCloseWindow,
}) {
  const clock = usePlatformClock();
  const platformKind = usePlatformKind();
  const tray = useTrayStatus();
  const feed = useSystemFeed();
  const taskbar = useTaskbarSnapshot();
  const pinnedApplicationRefs = usePinnedApplicationRefs();
  const needsApplicationCatalog = pinnedApplicationRefs.some((reference) =>
    reference.kind === "installed");
  const applicationCatalog = useApplicationCatalog(needsApplicationCatalog);
  const appsRef = useRef(null);
  const taskbarItemsRef = useRef([]);
  const [runningOrder, setRunningOrder] = useState([]);
  const [draggedPinnedId, setDraggedPinnedId] = useState(null);
  const [mockFlyout, setMockFlyout] = useState(null);
  const menuApplications = useMemo(() => buildStartMenuApplications(
    quickLaunchItems,
    applicationCatalog.applications,
  ), [applicationCatalog.applications]);
  const orderedPinnedApps = useMemo(() => createTaskbarPinnedApps(
    resolvePinnedApplications(pinnedApplicationRefs, menuApplications),
  ), [menuApplications, pinnedApplicationRefs]);
  const taskbarItems = useMemo(
    () => buildTaskbarItems(taskbar.windows, orderedPinnedApps, runningOrder, internalWindows),
    [internalWindows, orderedPinnedApps, runningOrder, taskbar.windows],
  );
  useEffect(() => {
    taskbarItemsRef.current = taskbarItems;
  }, [taskbarItems]);
  useEffect(() => {
    const currentIds = taskbarItems
      .filter((item) => !item.isPinned)
      .map((item) => item.id);
    setRunningOrder((current) => reconcileRunningTaskbarOrder(current, currentIds));
  }, [taskbarItems]);
  const capacity = useTaskbarCapacity(appsRef);
  const hasOverflow = taskbarItems.length > capacity;
  const visibleItems = hasOverflow ? taskbarItems.slice(0, capacity - 1) : taskbarItems;
  const overflowItems = hasOverflow ? taskbarItems.slice(capacity - 1) : [];
  const hasActiveWindow = taskbar.windows.some((window) => window.active)
    || internalWindows.some((window) => window.active);
  const networkAvailable = tray.network.available;
  const power = tray.power;
  const alertCount = feed.unreadCount;
  const PowerIcon = power.batteryPresent ? Battery6Regular : PlugConnectedRegular;
  const AudioIcon = tray.audio.muted ? SpeakerOffRegular : Speaker2Regular;

  const getFlyoutAnchor = useCallback((element) => {
    const rect = element.getBoundingClientRect();
    return {
      anchorX: rect.left + rect.width / 2,
      viewportWidth: document.documentElement.clientWidth || window.innerWidth,
    };
  }, []);

  const showWindowGroup = useCallback((event, item) => {
    const request = {
      mode: "windows",
      windowIds: item.windows.map((window) => window.windowId),
      ...getFlyoutAnchor(event.currentTarget),
    };
    if (platformKind === "mock" || item.windows.some((window) => window.internalWindowId)) {
      setMockFlyout({ mode: "windows", item });
      return;
    }
    onShowFlyout(request);
  }, [getFlyoutAnchor, onShowFlyout, platformKind]);

  const showOverflow = useCallback((event) => {
    event.preventDefault();
    onHideFlyout();
    if (platformKind !== "mock" && !overflowItems.some((item) =>
      item.windows.some((window) => window.internalWindowId))) {
      const windowIds = overflowItems.flatMap((item) =>
        item.windows.map((window) => window.windowId));
      if (windowIds.length > 0) {
        onShowFlyout({
          mode: "overflow",
          windowIds,
          ...getFlyoutAnchor(event.currentTarget),
        });
      }
      return;
    }
    setMockFlyout({ mode: "overflow", items: overflowItems });
  }, [getFlyoutAnchor, onHideFlyout, onShowFlyout, overflowItems, platformKind]);

  const activateMockFlyoutWindow = useCallback((item, window) => {
    setMockFlyout(null);
    onAppClick(item, window);
  }, [onAppClick]);

  const closeMockFlyoutWindow = useCallback((windowId) => {
    setMockFlyout(null);
    onCloseWindow(windowId);
  }, [onCloseWindow]);

  const executeContextAction = useCallback(async (item, action) => {
    setMockFlyout(null);
    onHideFlyout();
    if (action === "launch") {
      await onAppClick(item, null, { forceLaunch: true });
      return;
    }
    if (action === "close") {
      await Promise.allSettled(item.windows.map((window) => onCloseWindow(window.windowId)));
      return;
    }
    if (action === "unpin" && item.isPinned) {
      unpinApplication(item.id);
    }
  }, [onAppClick, onCloseWindow, onHideFlyout]);

  useEffect(() => {
    if (platformKind === "mock") return undefined;
    const handleNativeContextAction = (event) => {
      const itemId = event.detail?.itemId;
      const action = event.detail?.action;
      if (typeof itemId !== "string" || typeof action !== "string") return;
      const item = taskbarItemsRef.current.find((candidate) => candidate.id === itemId);
      if (!item || !getTaskbarContextActionIds(item).includes(action)) return;
      void executeContextAction(item, action);
    };
    window.addEventListener("jarvis:taskbar-action", handleNativeContextAction);
    return () => window.removeEventListener("jarvis:taskbar-action", handleNativeContextAction);
  }, [executeContextAction, platformKind]);

  const handleItemClick = useCallback((event, item) => {
    if (event.shiftKey && item.isPinned) {
      setMockFlyout(null);
      onHideFlyout();
      onAppClick(item, null, { forceLaunch: true });
      return;
    }
    if (item.windows.length > 1) {
      showWindowGroup(event, item);
      return;
    }
    setMockFlyout(null);
    onHideFlyout();
    onAppClick(item, item.selectedWindow);
  }, [onAppClick, onHideFlyout, showWindowGroup]);

  const handleItemAuxClick = useCallback((event, item) => {
    if (event.button !== 1 || !item.isPinned) return;
    event.preventDefault();
    setMockFlyout(null);
    onHideFlyout();
    onAppClick(item, null, { forceLaunch: true });
  }, [onAppClick, onHideFlyout]);

  const showTaskbarContext = useCallback((event, item) => {
    event.preventDefault();
    const actions = getTaskbarContextActionIds(item);
    if (actions.length === 0) return;
    const request = {
      mode: "context",
      windowIds: item.windows.map((window) => window.windowId),
      itemId: item.id,
      label: String(item.label).replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 128) || "Application",
      actions,
      ...getFlyoutAnchor(event.currentTarget),
    };
    if (platformKind === "mock" || item.windows.some((window) => window.internalWindowId)) {
      setMockFlyout({ mode: "context", item, actions });
      return;
    }
    setMockFlyout(null);
    onShowFlyout(request);
  }, [getFlyoutAnchor, onShowFlyout, platformKind]);

  const reorderPinnedApps = useCallback((targetId) => {
    if (!draggedPinnedId || draggedPinnedId === targetId) return;
    reorderPinnedApplication(draggedPinnedId, targetId);
  }, [draggedPinnedId]);

  const movePinnedApp = useCallback((id, direction) => {
    movePinnedApplication(id, direction);
  }, []);

  return (
    <footer className="taskbar hud-chassis" aria-label="Windows taskbar">
      <div className="taskbar-start">
        <button type="button" aria-label="Start" title="Start" onClick={onOpenStart}>
          <WindowAppsRegular />
        </button>
      </div>
      <button
        type="button"
        className="taskbar-search"
        onClick={onOpenCommand}
        title="Search apps and windows · Ctrl+Alt+J from any application"
      >
        <SearchRegular />
        <span>Search</span>
      </button>
      <nav ref={appsRef} className="taskbar-apps" aria-label="Taskbar applications">
        {visibleItems.map((item) => {
          const { id, label, windows, selectedWindow: runningWindow } = item;
          const isInternalBuiltin = item.pinnedApplication?.id === "explorer"
            || item.pinnedApplication?.id === "terminal";
          const isActive = runningWindow?.active
            ?? (
              platformKind === "mock" &&
              taskbar.windows.length === 0 &&
              !isInternalBuiltin &&
              activeApp === id
            );
          const className = [
            isActive ? "is-active" : "",
            runningWindow ? "is-running" : "",
            item.isPinned ? "is-pinned" : "is-dynamic",
            draggedPinnedId === id ? "is-dragging" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const windowTitle = runningWindow?.title?.trim();
          const title = runningWindow
            ? `${label}${windowTitle ? ` — ${windowTitle}` : ""}${windows.length > 1 ? ` (${windows.length} windows)` : ""}${runningWindow.minimized ? " (minimized)" : ""}`
            : label;

          return (
            <button
              key={id}
              type="button"
              className={className}
              aria-label={title}
              title={`${title}${item.isPinned ? " · drag to reorder" : ""}`}
              draggable={item.isPinned}
              aria-keyshortcuts={item.isPinned ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
              onDragStart={(event) => {
                setDraggedPinnedId(id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", id);
              }}
              onDragOver={(event) => {
                if (!item.isPinned) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                reorderPinnedApps(id);
              }}
              onDragEnd={() => setDraggedPinnedId(null)}
              onKeyDown={(event) => {
                if (!item.isPinned || !event.altKey) return;
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  movePinnedApp(id, -1);
                } else if (event.key === "ArrowRight") {
                  event.preventDefault();
                  movePinnedApp(id, 1);
                }
              }}
              onClick={(event) => handleItemClick(event, item)}
              onAuxClick={(event) => handleItemAuxClick(event, item)}
              onContextMenu={(event) => showTaskbarContext(event, item)}
            >
              <TaskbarAppIcon item={item} />
              <span>{label}</span>
              {windows.length > 1 ? <small className="taskbar-window-count">{windows.length}</small> : null}
            </button>
          );
        })}
        {hasOverflow ? (
          <button
            type="button"
            className="taskbar-overflow-button is-running"
            aria-label={`More taskbar applications (${overflowItems.length})`}
            title={`${overflowItems.length} more taskbar applications`}
            onClick={showOverflow}
          >
            <MoreHorizontalRegular />
            <small>{overflowItems.length}</small>
          </button>
        ) : null}
      </nav>
      <button
        type="button"
        className={`jarvis-launcher${hasActiveWindow ? "" : " is-active"}`}
        onClick={onOpenCommand}
        aria-label="Open JARVIS quick search"
      >
        <img src="/assets/jarvis-taskbar-core-launcher-v1.png" alt="" />
      </button>
      <div className="taskbar-spacer" />
      <div className="system-tray">
        <button
          type="button"
          className="tray-status-button"
          aria-label="Open quick settings"
          title={`${networkAvailable ? "Connected" : "Offline"} · ${power.batteryPresent ? `${Math.round(power.percentage ?? 0)}% battery` : "AC power"}`}
          onClick={onOpenQuickSettings}
        >
          <ChevronUpRegular />
          <Wifi4Regular className={networkAvailable ? "" : "is-offline"} />
          <AudioIcon />
          <PowerIcon />
        </button>
        <span className="tray-clock"><strong>{clock.time}</strong><small>{clock.shortDate}</small></span>
        <button className="tray-notifications" type="button" aria-label={`JARVIS system feed${alertCount ? ` (${alertCount} unread)` : ""}`} title="JARVIS System Feed" onClick={onOpenNotifications}>
          <AlertRegular />
          {alertCount ? <small>{alertCount}</small> : null}
        </button>
      </div>
      <span className="taskbar-edge-track" aria-hidden="true" />
      {mockFlyout ? (
        <TaskbarLocalFlyout
          flyout={mockFlyout}
          onActivate={activateMockFlyoutWindow}
          onCloseWindow={closeMockFlyoutWindow}
          onContextAction={executeContextAction}
          onDismiss={() => setMockFlyout(null)}
        />
      ) : null}
    </footer>
  );
}
