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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getAgentLauncherStatus, getAgentProviderLabel } from "../agent-provider-model.js";
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
import { useDialogFocusTrap } from "../hooks/useDialogFocusTrap.js";
import {
  getTaskbarAccessibleLabel,
  getTaskbarKeyboardTarget,
} from "../taskbar-accessibility-model.js";
import {
  filterTaskbarFlyoutEntries,
  getNativeInternalWindowItems,
  getNativeTaskbarOverflowPayload,
  getTaskbarFlyoutKeyboardTarget,
  getTaskbarOverflowSummary,
} from "../taskbar-flyout-model.js";
import {
  getRunningGroupKey,
  getTaskbarContextActionIds,
  normalizeProcessName,
  partitionWindowsByPinnedApplications,
  reconcileRunningTaskbarOrder,
} from "../taskbar-grouping.js";
import {
  acceptsTaskbarHoverPointer,
  getTaskbarHoverPreviewTarget,
  TASKBAR_HOVER_DISMISS_DELAY_MS,
  TASKBAR_HOVER_PREVIEW_DELAY_MS,
} from "../taskbar-hover-preview.js";
import { getTaskbarLayoutPlan, TASKBAR_ICON_SLOT_WIDTH } from "../taskbar-layout-model.js";
import { AgentGlyph } from "./VectorMarks.jsx";

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

function resolveTaskbarIconDataUrl(item) {
  return item.selectedWindow?.iconDataUrl
    ?? item.windows.find((window) => window.iconDataUrl)?.iconDataUrl
    ?? item.iconDataUrl
    ?? null;
}

function hasRecognizableTaskbarIcon(item) {
  return Boolean(resolveTaskbarIconDataUrl(item) || (item.Icon && item.Icon !== WindowAppsRegular));
}

function useTaskbarLayoutPlan(containerRef, measurementRefs, items) {
  const [layout, setLayout] = useState(null);
  const itemKey = items.map((item) => item.id).join("\u001f");

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let cancelled = false;
    const update = () => {
      if (cancelled) return;
      const plan = getTaskbarLayoutPlan(items.map((item) => ({
        id: item.id,
        fullWidth: measurementRefs.current.get(item.id)?.getBoundingClientRect().width,
        canUseIconOnly: hasRecognizableTaskbarIcon(item),
      })), container.clientWidth);
      const signature = JSON.stringify(plan);
      setLayout((current) => current?.itemKey === itemKey && current.signature === signature
        ? current
        : { itemKey, plan, signature });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    void document.fonts?.ready?.then(update);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [containerRef, itemKey, items, measurementRefs]);

  return layout?.itemKey === itemKey ? layout.plan : null;
}

function TaskbarAppIcon({ item }) {
  const iconDataUrl = resolveTaskbarIconDataUrl(item);
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

function TaskbarLocalFlyout({
  flyout,
  onActivate,
  onCloseWindow,
  onContextAction,
  onDismiss,
  onPointerEnter,
  onPointerLeave,
}) {
  const flyoutRef = useRef(null);
  const entryRefs = useRef(new Map());
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  useDialogFocusTrap(flyoutRef, flyout.source !== "hover", {
    onEscape: onDismiss,
  });

  if (flyout.mode === "context") {
    return (
      <section
        ref={flyoutRef}
        className="taskbar-flyout-mock is-context"
        role="dialog"
        aria-modal="false"
        aria-label={`${flyout.item.label} commands`}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        <header>
          <span>APP COMMANDS</span>
          <small>{flyout.item.label}</small>
          <button type="button" onClick={onDismiss} aria-label="Close taskbar commands"><DismissRegular /></button>
        </header>
        <div className="taskbar-context-actions">
          {flyout.actions.map((action, index) => (
            <button
              type="button"
              key={action}
              data-dialog-initial-focus={index === 0 ? "true" : undefined}
              onClick={() => onContextAction(flyout.item, action)}
            >
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
      searchText: `${window.title} ${window.processName}`,
      window,
      item: flyout.item,
    }))
    : flyout.items.map((item) => ({
      key: item.id,
      label: item.label,
      meta: item.selectedWindow?.title ?? (item.isPinned ? "PINNED APPLICATION" : "RUNNING APPLICATION"),
      searchText: `${item.label} ${item.selectedWindow?.title ?? ""} ${item.windows.map((window) => `${window.title} ${window.processName}`).join(" ")}`,
      window: item.selectedWindow ?? null,
      item,
    }));
  const visibleEntries = flyout.mode === "overflow"
    ? filterTaskbarFlyoutEntries(entries, query)
    : entries;
  const selectedIndex = visibleEntries.length > 0
    ? Math.min(activeIndex, visibleEntries.length - 1)
    : 0;
  const overflowSummary = getTaskbarOverflowSummary(entries, visibleEntries);
  const focusEntryAt = (index) => {
    const entry = visibleEntries[index];
    if (!entry) return;
    setActiveIndex(index);
    window.requestAnimationFrame(() => entryRefs.current.get(entry.key)?.focus());
  };
  const handleEntryKeyDown = (event, index) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    focusEntryAt(getTaskbarFlyoutKeyboardTarget(
      visibleEntries.length,
      index,
      event.key,
    ));
  };

  return (
    <section
      ref={flyoutRef}
      className={`taskbar-flyout-mock is-${flyout.mode}`}
      role="dialog"
      aria-modal="false"
      aria-label={flyout.mode === "windows" ? "Window previews" : "Taskbar overflow"}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <header>
        <span>{flyout.mode === "windows" ? "WINDOW GROUP" : "TASK OVERFLOW"}</span>
        <small>{visibleEntries.length} {flyout.mode === "windows" ? "OPEN WINDOWS" : "VISIBLE APPLICATIONS"}</small>
        <button type="button" onClick={onDismiss} aria-label="Close taskbar flyout"><DismissRegular /></button>
      </header>
      {flyout.mode === "overflow" ? (
        <div className="taskbar-overflow-tools">
          <label>
            <SearchRegular aria-hidden="true" />
            <input
              type="search"
              value={query}
              maxLength={64}
              placeholder="Filter overflow applications"
              aria-label="Filter taskbar overflow applications"
              data-dialog-initial-focus="true"
              onChange={(event) => {
                setQuery(event.target.value.slice(0, 64));
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (!["ArrowDown", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                focusEntryAt(getTaskbarFlyoutKeyboardTarget(
                  visibleEntries.length,
                  selectedIndex,
                  event.key,
                ));
              }}
            />
          </label>
          <code>{overflowSummary.label}</code>
        </div>
      ) : null}
      <div className="taskbar-flyout-grid">
        {visibleEntries.map((entry, index) => (
          <article
            key={entry.key}
            className={[
              entry.window?.active ? "is-active" : "",
              index === selectedIndex ? "is-keyboard-active" : "",
            ].filter(Boolean).join(" ")}
          >
            {flyout.mode === "windows" ? (
              <div className="mock-window-thumbnail" aria-hidden="true">
                <TaskbarAppIcon item={entry.item} />
                <span><small>WINDOW PREVIEW</small><strong>{entry.label}</strong></span>
              </div>
            ) : null}
            <button
              ref={(element) => {
                if (element) entryRefs.current.set(entry.key, element);
                else entryRefs.current.delete(entry.key);
              }}
              type="button"
              className="mock-window-main"
              data-dialog-initial-focus={flyout.mode === "windows" && index === 0 ? "true" : undefined}
              tabIndex={index === selectedIndex ? 0 : -1}
              onFocus={() => setActiveIndex(index)}
              onKeyDown={(event) => handleEntryKeyDown(event, index)}
              onClick={() => onActivate(entry.item, entry.window)}
            >
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
        {visibleEntries.length === 0 ? (
          <p className="taskbar-flyout-empty" role="status">
            <SearchRegular />
            <span><strong>NO OVERFLOW MATCH</strong><small>Try another application or window name.</small></span>
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function Taskbar({
  activeApp,
  internalWindows = [],
  onAppClick,
  onOpenCommand,
  onToggleAgent,
  agentState,
  onOpenStart,
  onOpenQuickSettings,
  onOpenDateTime,
  onOpenNotifications,
  onShowFlyout,
  onHideFlyout,
  onCloseWindow,
  onToggleShowDesktop,
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
  const taskbarMeasurementRefs = useRef(new Map());
  const taskbarItemsRef = useRef([]);
  const taskbarButtonRefs = useRef(new Map());
  const hoverPreviewTimerRef = useRef(null);
  const hoverDismissTimerRef = useRef(null);
  const mockFlyoutRef = useRef(null);
  const taskbarHadFocusRef = useRef(false);
  const [runningOrder, setRunningOrder] = useState([]);
  const [draggedPinnedId, setDraggedPinnedId] = useState(null);
  const [mockFlyout, setMockFlyout] = useState(null);
  const [focusedTaskbarItemId, setFocusedTaskbarItemId] = useState(null);
  const menuApplications = useMemo(() => buildStartMenuApplications(
    quickLaunchItems,
    applicationCatalog.applications,
  ), [applicationCatalog.applications]);
  const orderedPinnedApps = useMemo(() => createTaskbarPinnedApps(
    resolvePinnedApplications(pinnedApplicationRefs, menuApplications),
  ), [menuApplications, pinnedApplicationRefs]);
  const agentWindow = internalWindows.find((window) => window.internalWindowId === "agent") ?? null;
  const taskbarInternalWindows = useMemo(
    () => internalWindows.filter((window) => window.internalWindowId !== "agent"),
    [internalWindows],
  );
  const taskbarItems = useMemo(
    () => buildTaskbarItems(taskbar.windows, orderedPinnedApps, runningOrder, taskbarInternalWindows),
    [orderedPinnedApps, runningOrder, taskbar.windows, taskbarInternalWindows],
  );
  const layoutPlan = useTaskbarLayoutPlan(appsRef, taskbarMeasurementRefs, taskbarItems);
  useEffect(() => {
    taskbarItemsRef.current = taskbarItems;
  }, [taskbarItems]);
  useEffect(() => {
    mockFlyoutRef.current = mockFlyout;
  }, [mockFlyout]);
  useEffect(() => {
    const currentIds = taskbarItems
      .filter((item) => !item.isPinned)
      .map((item) => item.id);
    setRunningOrder((current) => reconcileRunningTaskbarOrder(current, currentIds));
  }, [taskbarItems]);
  const taskbarItemsById = useMemo(
    () => new Map(taskbarItems.map((item) => [item.id, item])),
    [taskbarItems],
  );
  const visibleLayout = useMemo(
    () => layoutPlan?.visible
      ?? taskbarItems.map((item) => ({ id: item.id, density: "icon", width: TASKBAR_ICON_SLOT_WIDTH })),
    [layoutPlan, taskbarItems],
  );
  const visibleItems = useMemo(
    () => visibleLayout.map((entry) => taskbarItemsById.get(entry.id)).filter(Boolean),
    [taskbarItemsById, visibleLayout],
  );
  const overflowItems = useMemo(
    () => (layoutPlan?.overflowIds ?? []).map((id) => taskbarItemsById.get(id)).filter(Boolean),
    [layoutPlan?.overflowIds, taskbarItemsById],
  );
  const hasOverflow = overflowItems.length > 0;
  const layoutById = useMemo(
    () => new Map(visibleLayout.map((entry) => [entry.id, entry])),
    [visibleLayout],
  );
  const focusableTaskbarIds = useMemo(
    () => [
      ...visibleItems.map((item) => item.id),
      ...(hasOverflow ? ["taskbar:overflow"] : []),
    ],
    [hasOverflow, visibleItems],
  );
  useLayoutEffect(() => {
    setFocusedTaskbarItemId((current) => (
      focusableTaskbarIds.includes(current)
        ? current
        : (() => {
          const next = current && hasOverflow
            ? "taskbar:overflow"
            : focusableTaskbarIds[0] ?? null;
          if (taskbarHadFocusRef.current && next) {
            window.requestAnimationFrame(() => taskbarButtonRefs.current.get(next)?.focus());
          }
          return next;
        })()
    ));
  }, [focusableTaskbarIds, hasOverflow]);
  const focusTaskbarItemAt = useCallback((index) => {
    const id = focusableTaskbarIds[index];
    if (!id) return;
    setFocusedTaskbarItemId(id);
    window.requestAnimationFrame(() => taskbarButtonRefs.current.get(id)?.focus());
  }, [focusableTaskbarIds]);
  const agentRunning = Boolean(agentWindow);
  const agentActive = Boolean(agentWindow?.active && !agentWindow?.minimized);
  const hasActiveInternalWindow = agentActive
    || taskbarInternalWindows.some((window) => window.active);
  const agentWorking = ["starting", "running"].includes(agentState?.status);
  const agentDegraded = Boolean(agentState?.error);
  const agentProviderLabel = getAgentProviderLabel(agentState);
  const agentLauncherStatus = getAgentLauncherStatus(agentState, {
    open: agentRunning,
    active: agentActive,
  });
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

  const cancelHoverPreview = useCallback(() => {
    if (hoverPreviewTimerRef.current === null) return;
    window.clearTimeout(hoverPreviewTimerRef.current);
    hoverPreviewTimerRef.current = null;
  }, []);

  const cancelHoverDismiss = useCallback(() => {
    if (hoverDismissTimerRef.current === null) return;
    window.clearTimeout(hoverDismissTimerRef.current);
    hoverDismissTimerRef.current = null;
  }, []);

  const scheduleHoverMockDismiss = useCallback(() => {
    cancelHoverDismiss();
    if (mockFlyoutRef.current?.source !== "hover") return;
    hoverDismissTimerRef.current = window.setTimeout(() => {
      hoverDismissTimerRef.current = null;
      if (mockFlyoutRef.current?.source !== "hover") return;
      mockFlyoutRef.current = null;
      setMockFlyout(null);
    }, TASKBAR_HOVER_DISMISS_DELAY_MS);
  }, [cancelHoverDismiss]);

  const scheduleHoverPreview = useCallback((event, item) => {
    cancelHoverPreview();
    cancelHoverDismiss();
    if (
      !acceptsTaskbarHoverPointer(event.pointerType, draggedPinnedId)
      || (mockFlyoutRef.current && mockFlyoutRef.current.source !== "hover")
      || !getTaskbarHoverPreviewTarget(item, platformKind)
    ) {
      return;
    }

    const itemId = item.id;
    const anchorElement = event.currentTarget;
    hoverPreviewTimerRef.current = window.setTimeout(() => {
      hoverPreviewTimerRef.current = null;
      if (!anchorElement.isConnected) return;
      const currentItem = taskbarItemsRef.current.find((candidate) =>
        candidate.id === itemId);
      const target = getTaskbarHoverPreviewTarget(currentItem, platformKind);
      if (!target) return;

      if (target.kind === "mock") {
        const nextFlyout = {
          mode: "windows",
          item: currentItem,
          source: "hover",
        };
        mockFlyoutRef.current = nextFlyout;
        setMockFlyout(nextFlyout);
        return;
      }

      if (mockFlyoutRef.current?.source === "hover") {
        mockFlyoutRef.current = null;
        setMockFlyout(null);
      }
      onShowFlyout({
        mode: "windows",
        windowIds: target.windowIds,
        ...getFlyoutAnchor(anchorElement),
      });
    }, TASKBAR_HOVER_PREVIEW_DELAY_MS);
  }, [
    cancelHoverDismiss,
    cancelHoverPreview,
    draggedPinnedId,
    getFlyoutAnchor,
    onShowFlyout,
    platformKind,
  ]);

  const handleHoverPreviewLeave = useCallback(() => {
    cancelHoverPreview();
    scheduleHoverMockDismiss();
  }, [cancelHoverPreview, scheduleHoverMockDismiss]);

  useEffect(() => () => {
    cancelHoverPreview();
    cancelHoverDismiss();
  }, [cancelHoverDismiss, cancelHoverPreview]);

  const showWindowGroup = useCallback((event, item) => {
    cancelHoverPreview();
    cancelHoverDismiss();
    const request = {
      mode: "windows",
      windowIds: item.windows.map((window) => window.windowId),
      ...getFlyoutAnchor(event.currentTarget),
    };
    if (platformKind === "mock") {
      setMockFlyout({ mode: "windows", item, source: "manual" });
      return;
    }
    if (item.windows.some((window) => window.internalWindowId)) {
      onShowFlyout({
        mode: "overflow",
        windowIds: [],
        items: getNativeInternalWindowItems(item),
        ...getFlyoutAnchor(event.currentTarget),
      });
      return;
    }
    onShowFlyout(request);
  }, [
    cancelHoverDismiss,
    cancelHoverPreview,
    getFlyoutAnchor,
    onShowFlyout,
    platformKind,
  ]);

  const showOverflow = useCallback((event) => {
    event.preventDefault();
    cancelHoverPreview();
    cancelHoverDismiss();
    onHideFlyout();
    if (platformKind !== "mock") {
      const { windowIds, items } = getNativeTaskbarOverflowPayload(overflowItems);
      if (windowIds.length > 0 || items.length > 0) {
        onShowFlyout({
          mode: "overflow",
          windowIds,
          items,
          ...getFlyoutAnchor(event.currentTarget),
        });
      }
      return;
    }
    setMockFlyout({ mode: "overflow", items: overflowItems });
  }, [
    cancelHoverDismiss,
    cancelHoverPreview,
    getFlyoutAnchor,
    onHideFlyout,
    onShowFlyout,
    overflowItems,
    platformKind,
  ]);

  const activateMockFlyoutWindow = useCallback((item, window) => {
    cancelHoverDismiss();
    setMockFlyout(null);
    onAppClick(item, window);
  }, [cancelHoverDismiss, onAppClick]);

  const closeMockFlyoutWindow = useCallback((windowId) => {
    cancelHoverDismiss();
    setMockFlyout(null);
    onCloseWindow(windowId);
  }, [cancelHoverDismiss, onCloseWindow]);

  const executeContextAction = useCallback(async (item, action) => {
    cancelHoverPreview();
    cancelHoverDismiss();
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
  }, [
    cancelHoverDismiss,
    cancelHoverPreview,
    onAppClick,
    onCloseWindow,
    onHideFlyout,
  ]);

  useEffect(() => {
    if (platformKind === "mock") return undefined;
    const handleNativeContextAction = (event) => {
      const itemId = event.detail?.itemId;
      const action = event.detail?.action;
      if (typeof itemId !== "string" || typeof action !== "string") return;
      const item = taskbarItemsRef.current.find((candidate) => candidate.id === itemId);
      if (!item) return;
      if (action === "activate") {
        const requestedWindowId = event.detail?.windowId;
        const targetWindow = typeof requestedWindowId === "string"
          ? item.windows.find((window) => window.windowId === requestedWindowId)
          : item.selectedWindow;
        void onAppClick(item, targetWindow ?? null);
        return;
      }
      if (!getTaskbarContextActionIds(item).includes(action)) return;
      void executeContextAction(item, action);
    };
    window.addEventListener("jarvis:taskbar-action", handleNativeContextAction);
    return () => window.removeEventListener("jarvis:taskbar-action", handleNativeContextAction);
  }, [executeContextAction, onAppClick, platformKind]);

  const handleItemClick = useCallback((event, item) => {
    cancelHoverPreview();
    cancelHoverDismiss();
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
  }, [
    cancelHoverDismiss,
    cancelHoverPreview,
    onAppClick,
    onHideFlyout,
    showWindowGroup,
  ]);

  const handleItemAuxClick = useCallback((event, item) => {
    if (event.button !== 1 || !item.isPinned) return;
    event.preventDefault();
    cancelHoverPreview();
    cancelHoverDismiss();
    setMockFlyout(null);
    onHideFlyout();
    onAppClick(item, null, { forceLaunch: true });
  }, [cancelHoverDismiss, cancelHoverPreview, onAppClick, onHideFlyout]);

  const showTaskbarContext = useCallback((event, item) => {
    event.preventDefault();
    cancelHoverPreview();
    cancelHoverDismiss();
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
    if (platformKind === "mock") {
      setMockFlyout({ mode: "context", item, actions, source: "manual" });
      return;
    }
    setMockFlyout(null);
    onShowFlyout(request);
  }, [
    cancelHoverDismiss,
    cancelHoverPreview,
    getFlyoutAnchor,
    onShowFlyout,
    platformKind,
  ]);

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
          <span className="taskbar-start-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
        </button>
      </div>
      <button
        type="button"
        className={[
          "jarvis-agent-launcher",
          agentRunning ? "is-running" : "",
          agentActive ? "is-active" : "",
          agentWorking ? "is-working" : "",
          agentState?.available === false ? "is-offline" : "",
          agentDegraded ? "is-degraded" : "",
        ].filter(Boolean).join(" ")}
        onClick={onToggleAgent ?? onOpenCommand}
        aria-label={agentActive ? "Minimize JARVIS Agent" : "Open JARVIS Agent"}
        title={agentState?.error?.message
          ?? (agentState?.available === false ? "Agent Provider configuration required" : `Open Agent · ${agentProviderLabel}`)}
      >
        <AgentGlyph
          state={agentWorking
            ? "working"
            : agentDegraded
              ? "attention"
              : agentState?.available === false ? "offline" : "ready"}
        />
        <span className="jarvis-agent-launcher__copy">
          <strong>AGENT</strong>
          <small><span>{agentProviderLabel}</span> · {agentLauncherStatus}</small>
        </span>
        <i aria-hidden="true" />
      </button>
      <nav
        ref={appsRef}
        className={`taskbar-apps is-density-${layoutPlan?.mode ?? "measuring"}`}
        aria-label="Taskbar applications"
        aria-busy={!layoutPlan}
        onFocusCapture={() => { taskbarHadFocusRef.current = true; }}
        onBlurCapture={() => {
          window.requestAnimationFrame(() => {
            taskbarHadFocusRef.current = Boolean(appsRef.current?.contains(document.activeElement));
          });
        }}
      >
        <span className="taskbar-measure-layer" aria-hidden="true">
          {taskbarItems.map((item) => (
            <span
              key={item.id}
              ref={(element) => {
                if (element) taskbarMeasurementRefs.current.set(item.id, element);
                else taskbarMeasurementRefs.current.delete(item.id);
              }}
              className="taskbar-app-measure"
            >
              <span className="taskbar-app-measure__icon"><TaskbarAppIcon item={item} /></span>
              <span>{item.label}</span>
              {item.windows.length > 1 ? <small>{item.windows.length}</small> : null}
            </span>
          ))}
        </span>
        {visibleItems.map((item) => {
          const { id, label, windows, selectedWindow: runningWindow } = item;
          const isInternalItem = windows.some((window) => window.internalWindowId);
          const isInternalBuiltin = item.pinnedApplication?.id === "explorer"
            || item.pinnedApplication?.id === "terminal";
          const isActive = isInternalItem
            ? Boolean(runningWindow?.active)
            : hasActiveInternalWindow
              ? false
              : runningWindow?.active
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
          const itemLayout = layoutById.get(id);
          const title = runningWindow
            ? `${label}${windowTitle ? ` — ${windowTitle}` : ""}${windows.length > 1 ? ` (${windows.length} windows)` : ""}${runningWindow.minimized ? " (minimized)" : ""}`
            : label;

          return (
            <button
              key={id}
              ref={(element) => {
                if (element) taskbarButtonRefs.current.set(id, element);
                else taskbarButtonRefs.current.delete(id);
              }}
              type="button"
              className={className}
              data-density={itemLayout?.density ?? "icon"}
              style={{ "--taskbar-item-width": `${itemLayout?.width ?? TASKBAR_ICON_SLOT_WIDTH}px` }}
              aria-label={getTaskbarAccessibleLabel(item, isActive)}
              aria-current={isActive ? "true" : undefined}
              title={`${title}${item.isPinned ? " · drag to reorder" : ""}`}
              tabIndex={
                focusedTaskbarItemId
                  ? focusedTaskbarItemId === id ? 0 : -1
                  : visibleItems[0]?.id === id ? 0 : -1
              }
              draggable={item.isPinned}
              aria-keyshortcuts={item.isPinned ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
              onFocus={() => setFocusedTaskbarItemId(id)}
              onPointerEnter={(event) => scheduleHoverPreview(event, item)}
              onPointerLeave={handleHoverPreviewLeave}
              onDragStart={(event) => {
                cancelHoverPreview();
                cancelHoverDismiss();
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
                if (!event.altKey &&
                    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  focusTaskbarItemAt(getTaskbarKeyboardTarget(
                    focusableTaskbarIds.length,
                    focusableTaskbarIds.indexOf(id),
                    event.key,
                  ));
                  return;
                }
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
            ref={(element) => {
              if (element) taskbarButtonRefs.current.set("taskbar:overflow", element);
              else taskbarButtonRefs.current.delete("taskbar:overflow");
            }}
            type="button"
            className="taskbar-overflow-button is-running"
            aria-label={`More taskbar applications (${overflowItems.length})`}
            title={`${overflowItems.length} more taskbar applications`}
            tabIndex={focusedTaskbarItemId === "taskbar:overflow" ? 0 : -1}
            onFocus={() => setFocusedTaskbarItemId("taskbar:overflow")}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              focusTaskbarItemAt(getTaskbarKeyboardTarget(
                focusableTaskbarIds.length,
                focusableTaskbarIds.indexOf("taskbar:overflow"),
                event.key,
              ));
            }}
            onClick={showOverflow}
          >
            <MoreHorizontalRegular />
            <small>{overflowItems.length}</small>
          </button>
        ) : null}
      </nav>
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
        <button
          type="button"
          className="tray-clock"
          aria-label={`Open date and time · ${clock.longDate}, ${clock.time}`}
          title="Date and time"
          onClick={onOpenDateTime}
        >
          <strong>{clock.time}</strong>
          <small>{clock.shortDate}</small>
        </button>
        <button className="tray-notifications" type="button" aria-label={`JARVIS system feed${alertCount ? ` (${alertCount} unread)` : ""}`} title="JARVIS System Feed" onClick={onOpenNotifications}>
          <AlertRegular />
          {alertCount ? <small>{alertCount}</small> : null}
        </button>
      </div>
      <button
        type="button"
        className="taskbar-show-desktop"
        aria-label="Show desktop"
        title="Show desktop"
        onClick={onToggleShowDesktop}
      />
      <span className="taskbar-edge-track" aria-hidden="true" />
      {mockFlyout ? (
        <TaskbarLocalFlyout
          key={`${mockFlyout.mode}:${mockFlyout.item?.id ?? "overflow"}`}
          flyout={mockFlyout}
          onActivate={activateMockFlyoutWindow}
          onCloseWindow={closeMockFlyoutWindow}
          onContextAction={executeContextAction}
          onDismiss={() => {
            cancelHoverDismiss();
            setMockFlyout(null);
          }}
          onPointerEnter={cancelHoverDismiss}
          onPointerLeave={scheduleHoverMockDismiss}
        />
      ) : null}
    </footer>
  );
}
