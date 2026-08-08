import {
  AlertRegular,
  ArrowClockwiseRegular,
  ArrowExitRegular,
  CalendarMonthRegular,
  CheckmarkCircleRegular,
  ChevronLeftRegular,
  ChevronRightRegular,
  ClockRegular,
  DismissRegular,
  GlobeRegular,
  OpenRegular,
  PinOffRegular,
  PinRegular,
  PlugConnectedRegular,
  PowerRegular,
  PulseRegular,
  SearchRegular,
  SettingsRegular,
  ShieldRegular,
  Speaker2Regular,
  SpeakerOffRegular,
  WindowAppsRegular,
} from "@fluentui/react-icons";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getUiAudioSnapshot,
  setUiAudioEnabled,
  setUiAudioVolume,
  subscribeUiAudio,
} from "../audio-system.js";
import {
  clearSystemFeed,
  markSystemFeedRead,
  refreshApplicationCatalog,
  refreshDisplayTopology,
  refreshNotificationHistory,
  removeWindowAppearanceRule,
  requestNotificationHistoryAccess,
  retryTaskbarMode,
  setTrayMuted,
  setTrayVolume,
  setTaskbarMode,
  setWindowAppearanceMode,
  setWindowAppearanceRule,
  useApplicationCatalog,
  useDisplayTopology,
  useNotificationHistory,
  usePlatformClock,
  useSystemSnapshot,
  useSystemFeed,
  useTaskbarModeState,
  useTaskbarSnapshot,
  useTrayStatus,
  useWindowAppearanceState,
} from "../hooks/usePlatformData.js";
import {
  CALENDAR_WEEKDAYS,
  createCalendarMonth,
  isTimestampOnLocalDate,
  moveCalendarDate,
  parseLocalDateKey,
  shiftCalendarMonth,
  toLocalDateKey,
} from "../date-time-panel-model.js";
import { mergeSystemFeedEvents } from "../feedback-model.js";
import { filterHelpSections, helpCenterSections } from "../help-center-model.js";
import { useRecentApplicationIds } from "../hooks/useRecentApplications.js";
import { clearRecentApplications } from "../recent-applications.js";
import { useDialogFocusTrap } from "../hooks/useDialogFocusTrap.js";
import { usePinnedApplicationRefs } from "../hooks/usePinnedApplications.js";
import {
  getPinnedApplicationKey,
  pinApplication,
  unpinApplication,
} from "../pinned-applications.js";
import {
  getMenuApplicationPinKey,
  getMenuApplicationPinReference,
  resolvePinnedApplications,
} from "../pinned-application-model.js";
import { platform } from "../platform/index.js";
import { CoreNodeGlyph, JarvisMark } from "./VectorMarks.jsx";
import {
  quickLaunchItems as startApps,
  quickSettingItems as quickSettings,
} from "../quick-search-catalog.js";
import { normalizeSearchText } from "../quick-search.js";
import {
  createExitChallenge,
  EXIT_TO_WINDOWS_ACTION,
  isSessionChallengeExpired,
  normalizeSessionChallenge,
  normalizeSessionControlState,
} from "../session-control-model.js";
import {
  filterSystemFeed,
  getSystemFeedFilterShortcut,
  getSystemFeedFilterSummary,
} from "../system-feed-filter-model.js";
import { createVolumeCommitScheduler } from "../volume-commit-model.js";

const SESSION_ACTION_ICONS = Object.freeze({
  "exit-jarvis": ArrowExitRegular,
  lock: ShieldRegular,
  "sign-out": ArrowExitRegular,
  restart: ArrowClockwiseRegular,
  "shut-down": PowerRegular,
});
import {
  buildStartMenuApplications,
  createStartMenuVirtualRows,
  filterStartMenuApplications,
  getStartPanelCommand,
  getStartViewNavigation,
  getStartMenuVirtualWindow,
  groupStartMenuApplications,
} from "../start-menu-model.js";
import { normalizeProcessName } from "../taskbar-grouping.js";
import {
  canRetryTaskbarMode,
  getTaskbarCooldownRemaining,
  getTaskbarTransitionToast,
} from "../taskbar-mode-model.js";
import {
  getVisualThemeSnapshot,
  setVisualTheme,
  subscribeVisualTheme,
  visualThemes,
} from "../theme-system.js";
import {
  getInterfacePreferencesSnapshot,
  resetInterfacePreferences,
  setInterfacePreferences,
  subscribeInterfacePreferences,
} from "../interface-preferences.js";
import {
  getWindowCompatibilityReasonLabel,
  normalizeWindowAppearanceProcessName,
} from "../window-appearance-model.js";

const windowAppearanceOptions = [
  {
    mode: "off",
    level: "L0",
    title: "OFF",
    label: "关闭",
    tag: "原生",
    description: "不处理第三方窗口，保留 Windows 原生外观。",
  },
  {
    mode: "conservative",
    level: "L1",
    title: "CONSERVATIVE",
    label: "安全外框",
    tag: "安全",
    description: "只添加点击穿透的 JARVIS 辉光外框，不改标题栏。",
  },
  {
    mode: "enhanced",
    level: "L2",
    title: "ENHANCED",
    label: "Win11 标题栏增强",
    tag: "推荐",
    description: "安全外框 + 深色标题栏、橙色信号边框与系统圆角。",
  },
  {
    mode: "immersive",
    level: "L3",
    title: "IMMERSIVE",
    label: "沉浸接管",
    tag: "实验",
    description: "覆盖全部合格窗口；自动跳过受保护与安全窗口。",
  },
];

const windowAppearanceLabels = Object.fromEntries(
  windowAppearanceOptions.map((option) => [option.mode, option.title]),
);

const taskbarModeOptions = [
  {
    mode: "native",
    title: "NATIVE",
    label: "原生回退",
    description: "完整保留 Windows 任务栏；JARVIS 只运行桌面与工具层。",
  },
  {
    mode: "hybrid",
    title: "HYBRID",
    label: "混合任务栏",
    description: "推荐默认；由 Explorer 保留通知区，JARVIS 接管其余主任务栏区域。",
  },
  {
    mode: "full",
    title: "FULL",
    label: "完整替换",
    description: "实验模式；隐藏原生任务栏，第三方托盘功能可能不可用。",
  },
];

const interfaceMotionOptions = Object.freeze([
  Object.freeze({ id: "system", label: "SYSTEM", detail: "Follow Windows motion preference" }),
  Object.freeze({ id: "reduced", label: "REDUCED", detail: "Minimize animation and transitions" }),
  Object.freeze({ id: "full", label: "FULL", detail: "Use the complete JARVIS motion profile" }),
]);

const interfaceEmissionOptions = Object.freeze([
  Object.freeze({ id: "standard", label: "STANDARD", detail: "Approved layered glow profile" }),
  Object.freeze({ id: "subtle", label: "SUBTLE", detail: "Lower halo for long sessions" }),
  Object.freeze({ id: "minimal", label: "MINIMAL", detail: "Keep luminous lines, suppress bloom" }),
]);

function getWindowsReleaseLabel(windows11, osBuild) {
  if (!windows11) return "WIN10";
  const build = Number.parseInt(String(osBuild ?? ""), 10);
  if (Number.isFinite(build) && build >= 28000) return "WIN11 26H1";
  if (Number.isFinite(build) && build >= 26200) return "WIN11 25H2";
  if (Number.isFinite(build) && build >= 26100) return "WIN11 24H2";
  return "WIN11";
}

function formatUptime(seconds) {
  const totalMinutes = Math.max(0, Math.floor(Number(seconds) / 60));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return days > 0 ? `${days}D ${hours}H` : `${hours}H ${minutes}M`;
}

function formatFeedTime(timestamp) {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function PanelHeader({ eyebrow, title, onClose }) {
  return (
    <header className="shell-panel-header">
      <JarvisMark />
      <span><small>{eyebrow}</small><strong>{title}</strong></span>
      <button type="button" onClick={onClose} aria-label={`Close ${title}`}><DismissRegular /></button>
    </header>
  );
}

function getApplicationSourceLabel(source) {
  if (source === "packaged") return "WINDOWS APP";
  if (source === "user") return "USER START";
  if (source === "common") return "SYSTEM START";
  return "PINNED";
}

function StartMenuApplicationIcon({ application }) {
  if (application.iconDataUrl) return <img src={application.iconDataUrl} alt="" />;
  if (application.pinnedApplication?.Icon) {
    const Icon = application.pinnedApplication.Icon;
    return <Icon />;
  }
  return <WindowAppsRegular />;
}

function StartMenuApplicationRow({
  application,
  applicationIndex = null,
  isPinned,
  onNavigate = null,
  onOpen,
  onTogglePin,
}) {
  return (
    <div className={`start-application-row${isPinned ? " is-pinned" : ""}`}>
      <button
        type="button"
        className="start-application-main"
        data-start-application-index={applicationIndex}
        onKeyDown={onNavigate}
        onClick={() => onOpen(application)}
        title={`${application.label} · ${getApplicationSourceLabel(application.source)}`}
      >
        <span className="start-application-icon"><StartMenuApplicationIcon application={application} /></span>
        <span className="start-application-copy">
          <strong>{application.label}</strong>
          <small>{getApplicationSourceLabel(application.source)} · {application.category}</small>
        </span>
      </button>
      <button
        type="button"
        className="start-application-pin"
        onClick={() => onTogglePin(application)}
        aria-label={`${isPinned ? "Unpin" : "Pin"} ${application.label}`}
        title={`${isPinned ? "Unpin from" : "Pin to"} JARVIS taskbar`}
      >
        {isPinned ? <PinOffRegular /> : <PinRegular />}
      </button>
    </div>
  );
}

function StartApplicationGroups({ groups, pinnedKeys, onOpen, onTogglePin, emptyLabel }) {
  const viewportRef = useRef(null);
  const frameRef = useRef(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 320 });
  const [pendingFocusIndex, setPendingFocusIndex] = useState(null);
  const layout = useMemo(() => createStartMenuVirtualRows(groups), [groups]);
  const visibleRows = useMemo(
    () => getStartMenuVirtualWindow(layout.rows, viewport.scrollTop, viewport.height),
    [layout.rows, viewport.height, viewport.scrollTop],
  );
  const orderedApplications = useMemo(
    () => groups.flatMap((group) => group.items),
    [groups],
  );
  const applicationIndexById = useMemo(
    () => new Map(orderedApplications.map((application, index) => [application.menuId, index])),
    [orderedApplications],
  );

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;
    const updateHeight = () => {
      setViewport((current) => ({
        scrollTop: element.scrollTop,
        height: Math.max(1, element.clientHeight),
      }));
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (pendingFocusIndex === null) return;
    const element = viewportRef.current;
    const target = element?.querySelector(
      `[data-start-application-index="${pendingFocusIndex}"]`,
    );
    if (!target) return;
    target.focus();
    setPendingFocusIndex(null);
  }, [pendingFocusIndex, visibleRows]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const handleScroll = useCallback((event) => {
    const element = event.currentTarget;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setViewport({
        scrollTop: element.scrollTop,
        height: Math.max(1, element.clientHeight),
      });
    });
  }, []);

  const focusApplication = useCallback((index) => {
    const targetIndex = Math.max(0, Math.min(orderedApplications.length - 1, index));
    const targetApplication = orderedApplications[targetIndex];
    const targetRow = layout.rows.find((row) => (
      row.kind === "applications" &&
      row.items.some((application) => application.menuId === targetApplication?.menuId)
    ));
    const element = viewportRef.current;
    if (!element || !targetRow) return;
    const rowBottom = targetRow.top + targetRow.height;
    if (targetRow.top < element.scrollTop) {
      element.scrollTop = targetRow.top;
    } else if (rowBottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = rowBottom - element.clientHeight;
    }
    setViewport({ scrollTop: element.scrollTop, height: Math.max(1, element.clientHeight) });
    setPendingFocusIndex(targetIndex);
  }, [layout.rows, orderedApplications]);

  const handleApplicationNavigation = useCallback((event) => {
    const currentIndex = Number(event.currentTarget.dataset.startApplicationIndex);
    const currentApplication = orderedApplications[currentIndex];
    const currentRowIndex = layout.rows.findIndex((row) => (
      row.kind === "applications" &&
      row.items.some((application) => application.menuId === currentApplication?.menuId)
    ));
    const currentRow = layout.rows[currentRowIndex];
    const currentColumn = currentRow?.kind === "applications"
      ? currentRow.items.findIndex((application) => application.menuId === currentApplication?.menuId)
      : 0;
    let targetIndex = event.key === "ArrowRight"
      ? currentIndex + 1
      : event.key === "ArrowLeft"
        ? currentIndex - 1
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? orderedApplications.length - 1
            : null;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1;
      let rowIndex = currentRowIndex + step;
      while (rowIndex >= 0 && rowIndex < layout.rows.length) {
        const row = layout.rows[rowIndex];
        if (row.kind === "applications") {
          const targetApplication = row.items[Math.min(currentColumn, row.items.length - 1)];
          targetIndex = applicationIndexById.get(targetApplication.menuId);
          break;
        }
        rowIndex += step;
      }
    }

    if (targetIndex === null) return;
    event.preventDefault();
    focusApplication(targetIndex);
  }, [
    applicationIndexById,
    focusApplication,
    layout.rows,
    orderedApplications,
  ]);

  return (
    <div
      ref={viewportRef}
      className="start-all-apps"
      onScroll={handleScroll}
      aria-label="All applications"
    >
      {groups.length === 0 ? (
        <p className="shell-empty-state start-app-empty">{emptyLabel}</p>
      ) : (
        <div className="start-virtual-space" style={{ height: `${layout.totalHeight}px` }}>
          {visibleRows.map((row) => (
            row.kind === "group" ? (
              <div
                className="start-virtual-group-row"
                key={row.key}
                style={{ transform: `translateY(${row.top}px)`, height: `${row.height}px` }}
                aria-hidden="true"
              >
                <span>{row.label}</span><i />
              </div>
            ) : (
              <div
                className="start-virtual-application-row"
                key={row.key}
                style={{ transform: `translateY(${row.top}px)`, height: `${row.height}px` }}
              >
                {row.items.map((application) => (
                  <StartMenuApplicationRow
                    key={application.menuId}
                    application={application}
                    applicationIndex={applicationIndexById.get(application.menuId)}
                    isPinned={pinnedKeys.has(getMenuApplicationPinKey(application))}
                    onNavigate={handleApplicationNavigation}
                    onOpen={onOpen}
                    onTogglePin={onTogglePin}
                  />
                ))}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}

function StartPanel({
  onClose,
  onOpenCommand,
  onLaunch,
  onLaunchInstalled,
  onActivateWindow,
  onOpenHelp,
  onOpenSession,
}) {
  const taskbar = useTaskbarSnapshot();
  const system = useSystemSnapshot();
  const applicationCatalog = useApplicationCatalog();
  const recentApplicationIds = useRecentApplicationIds();
  const pinnedApplicationRefs = usePinnedApplicationRefs();
  const searchRef = useRef(null);
  const pinnedViewRef = useRef(null);
  const allViewRef = useRef(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState("pinned");
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalizeSearchText(deferredQuery);
  const menuApplications = useMemo(() => buildStartMenuApplications(
    startApps,
    applicationCatalog.applications,
  ), [applicationCatalog.applications]);
  const filteredApplications = useMemo(
    () => filterStartMenuApplications(menuApplications, normalizedQuery),
    [menuApplications, normalizedQuery],
  );
  const applicationGroups = useMemo(
    () => groupStartMenuApplications(filteredApplications),
    [filteredApplications],
  );
  const pinnedKeys = useMemo(() => new Set(pinnedApplicationRefs
    .map(getPinnedApplicationKey)
    .filter(Boolean)), [pinnedApplicationRefs]);
  const pinnedApplications = useMemo(
    () => resolvePinnedApplications(pinnedApplicationRefs, menuApplications),
    [menuApplications, pinnedApplicationRefs],
  );
  const recentApplications = useMemo(() => {
    const applicationById = new Map(menuApplications
      .filter((application) => application.kind === "installed")
      .map((application) => [application.applicationId, application]));
    return recentApplicationIds
      .map((applicationId) => applicationById.get(applicationId))
      .filter(Boolean)
      .slice(0, 4);
  }, [menuApplications, recentApplicationIds]);
  const runningApps = useMemo(() => {
    const groups = new Map();
    taskbar.windows.forEach((window) => {
      const process = normalizeProcessName(window.processName);
      if (!groups.has(process)) groups.set(process, { process, windows: [] });
      groups.get(process).windows.push(window);
    });
    return Array.from(groups.values())
      .filter((group) => !normalizedQuery || normalizeSearchText(group.process).includes(normalizedQuery) ||
        group.windows.some((window) => normalizeSearchText(window.title).includes(normalizedQuery)))
      .slice(0, 5);
  }, [normalizedQuery, taskbar.windows]);
  const openMenuApplication = useCallback((application) => {
    if (application.kind === "installed") {
      onLaunchInstalled(application.application);
      return;
    }
    onLaunch({
      label: application.pinnedApplication.label,
      target: application.pinnedApplication.target,
    });
  }, [onLaunch, onLaunchInstalled]);
  const togglePinnedApplication = useCallback((application) => {
    const reference = getMenuApplicationPinReference(application);
    const key = getPinnedApplicationKey(reference);
    if (!reference || !key) return;
    if (pinnedKeys.has(key)) {
      unpinApplication(key);
      return;
    }
    pinApplication(reference);
  }, [pinnedKeys]);
  const contentMode = normalizedQuery ? "search" : view;
  const catalogStatus = applicationCatalog.error
    ? "WINDOWS CATALOG UNAVAILABLE"
    : applicationCatalog.loading
      ? "INDEXING WINDOWS APPS"
      : applicationCatalog.truncated
        ? `${applicationCatalog.applications.length} APPS · PARTIAL`
        : applicationCatalog.watching
          ? `${applicationCatalog.applications.length} APPS · LIVE R${applicationCatalog.revision}`
          : `${applicationCatalog.applications.length} WINDOWS APPS`;
  const catalogStatusTitle = applicationCatalog.indexedAtUtc
    ? `Indexed ${formatFeedTime(applicationCatalog.indexedAtUtc)} · ${applicationCatalog.refreshReason}`
    : "The Windows application catalog has not finished indexing.";
  const setStartView = useCallback((nextView, focus = false) => {
    setQuery("");
    setView(nextView);
    if (focus) {
      window.requestAnimationFrame(() => {
        (nextView === "all" ? allViewRef : pinnedViewRef).current?.focus();
      });
    }
  }, []);
  const handleStartKeyboard = useCallback((event) => {
    const command = getStartPanelCommand(event);
    if (!command) return;
    event.preventDefault();
    if (command === "focus-search") {
      searchRef.current?.focus();
      searchRef.current?.select();
    } else {
      setStartView(command === "view-all" ? "all" : "pinned", true);
    }
  }, [setStartView]);
  const handleViewKeyboard = useCallback((event) => {
    const nextView = getStartViewNavigation(view, event.key);
    if (!nextView) return;
    event.preventDefault();
    setStartView(nextView, true);
  }, [setStartView, view]);

  return (
    <section
      className="shell-panel start-panel"
      role="dialog"
      aria-modal="false"
      aria-label="JARVIS Start"
      onKeyDownCapture={handleStartKeyboard}
    >
      <PanelHeader eyebrow="WINDOWS CONTROL" title="START" onClose={onClose} />
      <div className="start-search">
        <SearchRegular />
        <input
          ref={searchRef}
          autoFocus
          data-dialog-initial-focus="true"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search all apps and running windows"
          aria-label="Search applications"
        />
        <button type="button" onClick={onOpenCommand}>QUICK SEARCH</button>
      </div>

      <div className="start-view-switch" role="tablist" aria-label="Start menu view">
        <button
          ref={pinnedViewRef}
          type="button"
          role="tab"
          aria-selected={view === "pinned"}
          className={view === "pinned" ? "is-active" : ""}
          onClick={() => setStartView("pinned")}
          onKeyDown={handleViewKeyboard}
        >
          <span>PINNED</span><small>{pinnedApplications.length}</small>
        </button>
        <button
          ref={allViewRef}
          type="button"
          role="tab"
          aria-selected={view === "all"}
          className={view === "all" ? "is-active" : ""}
          onClick={() => setStartView("all")}
          onKeyDown={handleViewKeyboard}
        >
          <span>ALL APPS</span><small>{menuApplications.length}</small>
        </button>
        <span
          className={applicationCatalog.error ? "is-error" : ""}
          title={catalogStatusTitle}
        >
          {catalogStatus}
        </span>
        <button
          type="button"
          className="start-catalog-refresh"
          onClick={() => refreshApplicationCatalog(true)}
          disabled={applicationCatalog.loading}
          aria-label="Refresh application catalog"
          title="Refresh Windows application catalog"
        >
          <ArrowClockwiseRegular />
        </button>
      </div>

      <div
        className={`start-panel-content is-${contentMode}`}
        aria-busy={applicationCatalog.loading || query !== deferredQuery}
      >
        {contentMode === "pinned" ? (
          <>
            <div className="start-section-heading"><span>PINNED</span><small>{pinnedApplications.length} APPS</small></div>
            <div className="start-app-grid">
              {pinnedApplications.length > 0 ? pinnedApplications.map((application) => (
                <div className="start-pinned-tile" key={application.menuId}>
                  <button
                    type="button"
                    className="start-pinned-launch"
                    onClick={() => openMenuApplication(application)}
                    title={application.label}
                  >
                    <span><StartMenuApplicationIcon application={application} /></span>
                    <strong>{application.label}</strong>
                  </button>
                  <button
                    type="button"
                    className="start-pinned-remove"
                    onClick={() => unpinApplication(getMenuApplicationPinKey(application))}
                    aria-label={`Unpin ${application.label}`}
                    title={`Unpin ${application.label}`}
                  >
                    <PinOffRegular />
                  </button>
                </div>
              )) : <p className="shell-empty-state start-pinned-empty">No pinned applications. Open All Apps to add one.</p>}
            </div>

            {recentApplications.length > 0 ? (
              <>
                <div className="start-section-heading">
                  <span>RECENTLY OPENED</span>
                  <span className="start-heading-actions">
                    <small>{recentApplications.length} LOCAL</small>
                    <button
                      type="button"
                      onClick={clearRecentApplications}
                      aria-label="Clear recently opened applications"
                    >
                      CLEAR
                    </button>
                  </span>
                </div>
                <div className="start-recent-list">
                  {recentApplications.map((application) => (
                    <StartMenuApplicationRow
                      key={application.menuId}
                      application={application}
                      isPinned={pinnedKeys.has(getMenuApplicationPinKey(application))}
                      onOpen={openMenuApplication}
                      onTogglePin={togglePinnedApplication}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : (
          <>
            <div className="start-section-heading">
              <span>{contentMode === "search" ? "APPLICATION MATCHES" : "ALL APPLICATIONS"}</span>
              <small>{filteredApplications.length} RESULTS</small>
            </div>
            <StartApplicationGroups
              groups={applicationGroups}
              pinnedKeys={pinnedKeys}
              onOpen={openMenuApplication}
              onTogglePin={togglePinnedApplication}
              emptyLabel={applicationCatalog.loading ? "Indexing Windows applications…" : "No matching applications."}
            />
          </>
        )}

        {contentMode !== "all" ? (
          <>
            <div className="start-section-heading"><span>RUNNING NOW</span><small>{taskbar.windows.length} WINDOWS</small></div>
            <div className="start-running-list">
              {runningApps.length > 0 ? runningApps.map((group) => {
                const selected = group.windows.find((window) => window.active) ?? group.windows[0];
                return (
                  <button key={group.process} type="button" onClick={() => onActivateWindow(selected)}>
                    {selected.iconDataUrl
                      ? <img src={selected.iconDataUrl} alt="" />
                      : <WindowAppsRegular />}
                    <span><strong>{selected.title || group.process}</strong><small>{group.process} · {group.windows.length} WINDOW{group.windows.length === 1 ? "" : "S"}</small></span>
                  </button>
                );
              }) : <p className="shell-empty-state">No matching running applications.</p>}
            </div>
          </>
        ) : null}
      </div>

      <footer className="start-footer">
        <span><strong>{system.status.machineName}</strong><small>{system.status.osDescription}</small></span>
        <button type="button" onClick={onOpenHelp}><PulseRegular /><span>Help</span></button>
        <button type="button" onClick={() => onLaunch({ label: "JARVIS Settings", target: "jarvis-settings:" })}><SettingsRegular /><span>Settings</span></button>
        <button type="button" className="is-exit" onClick={onOpenSession}><PowerRegular /><span>Session controls</span></button>
      </footer>
    </section>
  );
}

function QuickSettingsPanel({ onClose, onLaunch }) {
  const system = useSystemSnapshot();
  const tray = useTrayStatus();
  const volumeCommitRef = useRef(null);
  const [volume, setVolume] = useState(tray.audio.volumePercent ?? 0);
  const [audioError, setAudioError] = useState("");
  const cpu = system.resources.find((resource) => resource.id === "cpu");
  const memory = system.resources.find((resource) => resource.id === "memory");
  const { network, power, audio } = tray;
  const AudioIcon = audio.muted ? SpeakerOffRegular : Speaker2Regular;
  const powerLabel = power.batteryPresent
    ? `${Math.round(power.percentage ?? 0)}%${power.charging ? " · charging" : ""}`
    : power.acConnected ? "AC power" : "Desktop power";

  useEffect(() => {
    if (audio.volumePercent !== null) {
      setVolume(audio.volumePercent);
    }
  }, [audio.volumePercent]);

  useEffect(() => {
    const scheduler = createVolumeCommitScheduler(async (nextVolume) => {
      setAudioError("");
      try {
        await setTrayVolume(nextVolume);
      } catch (error) {
        setAudioError(error.message);
      }
    });
    volumeCommitRef.current = scheduler;
    return () => {
      scheduler.cancel();
      volumeCommitRef.current = null;
    };
  }, []);

  const commitVolume = () => volumeCommitRef.current?.flush(volume);

  const toggleMute = async () => {
    setAudioError("");
    try {
      await setTrayMuted(!audio.muted);
    } catch (error) {
      setAudioError(error.message);
    }
  };

  return (
    <section className="shell-panel quick-settings-panel" role="dialog" aria-modal="false" aria-label="Quick settings">
      <PanelHeader eyebrow="LIVE WINDOWS STATUS" title="QUICK SETTINGS" onClose={onClose} />
      <div className="quick-status-strip">
        <span className={network.available ? "is-online" : "is-offline"}><GlobeRegular /><strong>{network.available ? "ONLINE" : "OFFLINE"}</strong><small>{network.interfaceName}</small></span>
        <span><PlugConnectedRegular /><strong>{powerLabel}</strong><small>{power.batteryPresent ? "BATTERY" : "POWER"}</small></span>
        <span><PulseRegular /><strong>{cpu?.value ?? "—"}</strong><small>CPU</small></span>
        <span><WindowAppsRegular /><strong>{memory?.value ?? "—"}</strong><small>MEMORY</small></span>
      </div>
      <section className="quick-volume-card" aria-label="Windows output volume">
        <span className="runtime-setting-icon"><AudioIcon /></span>
        <span>
          <strong>{audio.available ? audio.muted ? "MUTED" : `${volume}%` : "UNAVAILABLE"}</strong>
          <small>{tray.simulation ? "SIMULATION" : audio.deviceLabel ?? "DEFAULT WINDOWS OUTPUT"}</small>
        </span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={volume}
          disabled={!audio.available}
          aria-label="Windows output volume"
          aria-valuetext={audio.available ? `${volume} percent` : "Audio unavailable"}
          onChange={(event) => {
            const nextVolume = Number(event.target.value);
            setVolume(nextVolume);
            volumeCommitRef.current?.schedule(nextVolume);
          }}
          onPointerUp={commitVolume}
          onKeyUp={commitVolume}
        />
        <button
          type="button"
          className={`runtime-switch ${audio.muted ? "" : "is-on"}`}
          role="switch"
          aria-checked={!audio.muted}
          disabled={!audio.available}
          onClick={toggleMute}
        >
          <span /><strong>{audio.muted ? "MUTED" : "LIVE"}</strong>
        </button>
      </section>
      {audioError ? <p className="runtime-settings-error" role="alert"><AlertRegular />{audioError}</p> : null}
      <div className="quick-setting-grid">
        {quickSettings.map(({ id, label, target, Icon }) => (
          <button key={id} type="button" onClick={() => onLaunch({ label, target })}>
            <span><Icon /></span>
            <strong>{label}</strong>
            <small>{id === "network" ? (network.available ? network.interfaceType : "Unavailable") : "OPEN CONTROL"}</small>
          </button>
        ))}
      </div>
      <footer className="quick-settings-footer">
        <span>SESSION UPTIME</span><strong>{formatUptime(system.status.uptimeSeconds)}</strong>
      </footer>
    </section>
  );
}

function NotificationsPanel({
  localEvents = [],
  onClearLocalFeed,
  onClose,
  onLaunch,
  onMarkLocalFeedRead,
}) {
  const feed = useSystemFeed();
  const notificationHistory = useNotificationHistory();
  const [feedFilter, setFeedFilter] = useState("all");
  const [feedQuery, setFeedQuery] = useState("");
  const deferredFeedQuery = useDeferredValue(feedQuery);
  const events = useMemo(
    () => mergeSystemFeedEvents(localEvents, feed.items, 50),
    [feed.items, localEvents],
  );
  const visibleFeedItems = useMemo(
    () => filterSystemFeed(events, {
      filter: feedFilter,
      query: deferredFeedQuery,
    }),
    [deferredFeedQuery, events, feedFilter],
  );
  const feedSummary = useMemo(
    () => getSystemFeedFilterSummary(events, visibleFeedItems),
    [events, visibleFeedItems],
  );
  const unreadCount = events.filter((item) => item.unread).length;
  const markAllRead = async () => {
    await Promise.allSettled([markSystemFeedRead()]);
    onMarkLocalFeedRead?.();
  };
  const clearAll = async () => {
    await Promise.allSettled([clearSystemFeed()]);
    onClearLocalFeed?.();
  };
  const actionTargets = {
    "open-network-settings": { label: "Network settings", target: "ms-settings:network-status" },
    "open-sound-settings": { label: "Sound settings", target: "ms-settings:sound" },
    "open-power-settings": { label: "Power settings", target: "ms-settings:powersleep" },
    "open-runtime-settings": { label: "JARVIS Settings", target: "jarvis-settings:" },
  };

  return (
    <section
      className="shell-panel shell-notifications-panel"
      role="dialog"
      aria-modal="false"
      aria-label="JARVIS system feed"
      onKeyDown={(event) => {
        const nextFilter = getSystemFeedFilterShortcut(event);
        if (!nextFilter) return;
        event.preventDefault();
        setFeedFilter(nextFilter);
      }}
    >
      <PanelHeader eyebrow="CURRENT SESSION · MAX 50 EVENTS" title="JARVIS SYSTEM FEED" onClose={onClose} />
      <div className={`windows-history-status is-${notificationHistory.historyAvailable ? "ready" : "limited"}`}>
        <span><WindowAppsRegular /></span>
        <span>
          <strong>WINDOWS NOTIFICATION HISTORY</strong>
          <small>{notificationHistory.historyAvailable
            ? `${notificationHistory.items.length} Windows notifications available`
            : notificationHistory.reason ?? "Checking Windows notification access…"}</small>
        </span>
        <code>{notificationHistory.loading
          ? "CHECKING"
          : notificationHistory.accessStatus.toUpperCase()}</code>
      </div>
      <div className="system-feed-controls" role="toolbar" aria-label="Filter JARVIS system feed">
        {[
          ["all", "ALL"],
          ["unread", "UNREAD"],
          ["attention", "ATTENTION"],
          ["status", "STATUS"],
        ].map(([id, label], index) => (
          <button
            key={id}
            type="button"
            className={feedFilter === id ? "is-active" : ""}
            aria-pressed={feedFilter === id}
            aria-keyshortcuts={`Control+${index + 1}`}
            title={`Ctrl+${index + 1}`}
            data-dialog-initial-focus={index === 0 ? "true" : undefined}
            onClick={() => setFeedFilter(id)}
          >
            <span>{label}</span><kbd>{index + 1}</kbd>
          </button>
        ))}
        <label>
          <SearchRegular aria-hidden="true" />
          <input
            value={feedQuery}
            maxLength={96}
            placeholder="Filter events"
            aria-label="Filter system feed text"
            onChange={(event) => setFeedQuery(event.target.value)}
          />
        </label>
        <code>{feedSummary.label}</code>
      </div>
      <div className="shell-notification-list">
        {feed.loading ? <p className="system-feed-empty">Connecting to the JARVIS event stream…</p> : null}
        {feed.error ? <p className="runtime-settings-error" role="alert"><AlertRegular />{feed.error}</p> : null}
        {!feed.loading && !feed.error && events.length === 0
          ? <p className="system-feed-empty">No JARVIS events in this session.</p>
          : null}
        {!feed.loading && !feed.error && events.length > 0 && visibleFeedItems.length === 0
          ? <p className="system-feed-empty">No events match the current feed filter.</p>
          : null}
        {visibleFeedItems.map((item) => {
          const target = actionTargets[item.actionId];
          const Item = target ? "button" : "div";
          const Icon = item.severity === "ok" ? CheckmarkCircleRegular : item.severity === "info" ? WindowAppsRegular : AlertRegular;
          return (
            <Item
              key={item.id}
              {...(target
                ? { type: "button", onClick: () => onLaunch(target) }
                : { role: "status" })}
              className={`shell-notification-item is-${item.severity} ${item.unread ? "is-unread" : ""}`}
            >
              <span><Icon /></span>
              <span><strong>{item.title}</strong><small>{item.detail}</small></span>
              <time dateTime={item.timestamp ?? undefined}>{formatFeedTime(item.timestamp)}</time>
            </Item>
          );
        })}
      </div>
      <footer className="notification-footer">
        <span>{feedSummary.visibleUnread} VISIBLE UNREAD · {feedSummary.label}</span>
        <button type="button" disabled={unreadCount === 0} onClick={() => void markAllRead()}>MARK ALL READ</button>
        <button type="button" disabled={events.length === 0} onClick={() => void clearAll()}>CLEAR</button>
      </footer>
    </section>
  );
}

function DateTimePanel({ onClose, onLaunch }) {
  const clock = usePlatformClock();
  const feed = useSystemFeed();
  const todayKey = toLocalDateKey(clock.dateTime) ??
    toLocalDateKey(new Date());
  const today = parseLocalDateKey(todayKey) ?? new Date();
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);
  const [visibleMonth, setVisibleMonth] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }));
  const calendarRef = useRef(null);
  const pendingFocusDateRef = useRef(null);
  const eventTimestamps = useMemo(
    () => feed.items.map((item) => item.timestamp),
    [feed.items],
  );
  const calendar = useMemo(() => createCalendarMonth({
    ...visibleMonth,
    todayKey,
    eventTimestamps,
  }), [
    eventTimestamps,
    todayKey,
    visibleMonth,
  ]);
  const selectedDate = parseLocalDateKey(selectedDateKey) ?? today;
  const selectedDateLabel = selectedDate.toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).toUpperCase();
  const selectedEvents = useMemo(
    () => feed.items
      .filter((item) =>
        isTimestampOnLocalDate(item.timestamp, selectedDateKey))
      .slice(0, 5),
    [feed.items, selectedDateKey],
  );

  useEffect(() => {
    const dateKey = pendingFocusDateRef.current;
    if (!dateKey) return undefined;
    pendingFocusDateRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      calendarRef.current
        ?.querySelector(`[data-date-key="${dateKey}"]`)
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [calendar, selectedDateKey]);

  const selectDate = (dateKey, focus = false) => {
    const date = parseLocalDateKey(dateKey);
    if (!date) return;
    if (focus) pendingFocusDateRef.current = dateKey;
    setSelectedDateKey(dateKey);
    setVisibleMonth({
      year: date.getFullYear(),
      month: date.getMonth(),
    });
  };

  const navigateMonth = (delta) => {
    const next = shiftCalendarMonth(
      visibleMonth.year,
      visibleMonth.month,
      delta,
    );
    const selectedDay = selectedDate.getDate();
    const lastDay = new Date(
      next.year,
      next.month + 1,
      0,
    ).getDate();
    const target = new Date(
      next.year,
      next.month,
      Math.min(selectedDay, lastDay),
      12,
    );
    selectDate(toLocalDateKey(target), true);
  };

  const handleCalendarKeyDown = (event, dateKey) => {
    const command = event.shiftKey
      ? {
          PageUp: "previousYear",
          PageDown: "nextYear",
        }[event.key]
      : {
          ArrowLeft: "previousDay",
          ArrowRight: "nextDay",
          ArrowUp: "previousWeek",
          ArrowDown: "nextWeek",
          Home: "weekStart",
          End: "weekEnd",
          PageUp: "previousMonth",
          PageDown: "nextMonth",
        }[event.key];
    if (!command) return;
    event.preventDefault();
    const target = moveCalendarDate(dateKey, command);
    if (target) selectDate(target, true);
  };

  const goToToday = () => selectDate(todayKey, true);

  return (
    <section
      className="shell-panel date-time-panel"
      role="dialog"
      aria-modal="false"
      aria-label="Date and time"
    >
      <PanelHeader
        eyebrow="LOCAL SYSTEM TIME · CURRENT SESSION"
        title="DATE & TIME"
        onClose={onClose}
      />

      <div className="date-time-hero">
        <span className="date-time-orbit" aria-hidden="true">
          <ClockRegular />
          <i />
        </span>
        <span>
          <strong>{clock.time}</strong>
          <small>{clock.longDate}</small>
        </span>
        <code>LOCAL</code>
      </div>

      <div className="date-time-calendar-header">
        <span>
          <small>CALENDAR MATRIX</small>
          <strong>{calendar.monthLabel}</strong>
        </span>
        <div>
          <button
            type="button"
            onClick={() => navigateMonth(-1)}
            aria-label="Previous month"
            title="Previous month · Page Up"
          >
            <ChevronLeftRegular />
          </button>
          <button type="button" className="is-today" onClick={goToToday}>
            TODAY
          </button>
          <button
            type="button"
            onClick={() => navigateMonth(1)}
            aria-label="Next month"
            title="Next month · Page Down"
          >
            <ChevronRightRegular />
          </button>
        </div>
      </div>

      <div
        ref={calendarRef}
        className="date-time-calendar"
        role="grid"
        aria-label={calendar.monthLabel}
      >
        <div className="date-time-weekdays" role="row">
          {CALENDAR_WEEKDAYS.map((weekday) => (
            <span key={weekday} role="columnheader">{weekday}</span>
          ))}
        </div>
        <div className="date-time-days">
          {calendar.cells.map((cell) => {
            const selected = cell.key === selectedDateKey;
            return (
              <button
                key={cell.key}
                type="button"
                role="gridcell"
                className={[
                  cell.inMonth ? "" : "is-adjacent",
                  cell.today ? "is-today" : "",
                  selected ? "is-selected" : "",
                  cell.eventCount ? "has-events" : "",
                ].filter(Boolean).join(" ")}
                aria-selected={selected}
                aria-label={`${cell.key}${cell.eventCount ? `, ${cell.eventCount} session events` : ""}`}
                tabIndex={selected ? 0 : -1}
                data-date-key={cell.key}
                onClick={() => selectDate(cell.key)}
                onKeyDown={(event) =>
                  handleCalendarKeyDown(event, cell.key)}
              >
                <span>{cell.day}</span>
                {cell.eventCount ? (
                  <small aria-hidden="true">
                    {Math.min(cell.eventCount, 9)}
                  </small>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <section
        className="date-time-agenda"
        aria-labelledby="date-time-agenda-title"
      >
        <header>
          <span>
            <small>JARVIS SESSION ACTIVITY</small>
            <strong id="date-time-agenda-title">{selectedDateLabel}</strong>
          </span>
          <code>{selectedEvents.length.toString().padStart(2, "0")}</code>
        </header>
        {selectedEvents.length ? (
          <div className="date-time-event-list">
            {selectedEvents.map((item) => (
              <article key={item.id} className={`is-${item.severity}`}>
                <i aria-hidden="true" />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail || "No additional detail."}</small>
                </span>
                <time dateTime={item.timestamp ?? undefined}>
                  {item.timestamp
                    ? new Date(item.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                    : "--:--"}
                </time>
              </article>
            ))}
          </div>
        ) : (
          <div className="date-time-empty">
            <CalendarMonthRegular />
            <span>
              <strong>NO SESSION EVENTS</strong>
              <small>JARVIS has no recorded activity for this local date.</small>
            </span>
          </div>
        )}
      </section>

      <footer className="date-time-footer">
        <span>Calendar accounts are not connected.</span>
        <button
          type="button"
          onClick={() => onLaunch({
            label: "Date & time settings",
            target: "ms-settings:dateandtime",
          })}
        >
          <OpenRegular />
          OPEN WINDOWS SETTINGS
        </button>
      </footer>
    </section>
  );
}

function SessionControlPanel({ onClose, onExit, onToast }) {
  const sessionActionRefs = useRef(new Map());
  const lastSessionActionRef = useRef(null);
  const cancelConfirmationRef = useRef(null);
  const [sessionState, setSessionState] = useState(() =>
    normalizeSessionControlState(null));
  const [status, setStatus] = useState("loading");
  const [challenge, setChallenge] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    platform.session.getState()
      .then((result) => {
        if (!active) return;
        setSessionState(normalizeSessionControlState(result));
        setStatus("ready");
      })
      .catch((nextError) => {
        if (!active) return;
        setError(nextError.message);
        setStatus("error");
      });

    return () => {
      active = false;
      void platform.session.cancel().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!challenge) return undefined;
    const frame = window.requestAnimationFrame(() => {
      cancelConfirmationRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [challenge]);

  const restoreSessionActionFocus = () => {
    const actionId = lastSessionActionRef.current;
    window.requestAnimationFrame(() => {
      sessionActionRefs.current.get(actionId)?.focus();
    });
  };

  const beginAction = async (action) => {
    lastSessionActionRef.current = action.id;
    setError("");
    if (action.local) {
      setChallenge(createExitChallenge());
      return;
    }

    setBusy(true);
    try {
      const result = await platform.session.prepare(action.id);
      const normalized = normalizeSessionChallenge(result, action.id);
      if (!normalized) {
        throw new Error("Windows returned an invalid confirmation capability.");
      }
      setChallenge(normalized);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelChallenge = async () => {
    setChallenge(null);
    setError("");
    restoreSessionActionFocus();
    try {
      await platform.session.cancel();
    } catch {
      // Native challenges expire quickly; cancellation failure is non-blocking.
    }
  };

  const confirmAction = async () => {
    if (!challenge || busy) return;
    if (isSessionChallengeExpired(challenge)) {
      setChallenge(null);
      setError("Confirmation expired. Select the action again.");
      restoreSessionActionFocus();
      return;
    }
    if (challenge.local) {
      await onExit();
      return;
    }

    setBusy(true);
    setError("");
    try {
      const result = await platform.session.commit(
        challenge.actionId,
        challenge.token,
      );
      setChallenge(null);
      onToast(result.message ?? "Windows accepted the session action.");
      onClose();
    } catch (nextError) {
      setChallenge(null);
      setError(nextError.message);
      restoreSessionActionFocus();
    } finally {
      setBusy(false);
    }
  };

  const actions = [EXIT_TO_WINDOWS_ACTION, ...sessionState.actions];
  const ChallengeIcon = challenge
    ? SESSION_ACTION_ICONS[challenge.actionId] ?? PowerRegular
    : PowerRegular;

  return (
    <section
      className="shell-panel session-control-panel"
      role="dialog"
      aria-modal="false"
      aria-label="Session controls"
    >
      <PanelHeader
        eyebrow="RECOVERY-BOUND · LOCAL WINDOWS SESSION"
        title="SESSION CONTROL"
        onClose={onClose}
      />

      <div className="session-control-status">
        <span className="session-control-orbit" aria-hidden="true">
          <PowerRegular />
          <i />
        </span>
        <div>
          <small>CONTROL BOUNDARY</small>
          <strong>{sessionState.available ? "WINDOWS READY" : "JARVIS RECOVERY ONLY"}</strong>
          <p>Every Windows session action requires a short-lived, single-use confirmation.</p>
        </div>
        <code>{status === "loading" ? "CHECKING" : sessionState.available ? "GUARDED" : "LIMITED"}</code>
      </div>

      {!challenge ? (
        <div className="session-control-grid" aria-busy={busy || status === "loading"}>
          {actions.map((action) => {
            const Icon = SESSION_ACTION_ICONS[action.id] ?? PowerRegular;
            const disabled = busy ||
              (action.local ? false : status !== "ready" || !sessionState.available);
            return (
              <button
                key={action.id}
                ref={(element) => {
                  if (element) sessionActionRefs.current.set(action.id, element);
                  else sessionActionRefs.current.delete(action.id);
                }}
                type="button"
                className={[
                  action.local ? "is-primary" : "",
                  action.destructive ? "is-destructive" : "",
                ].filter(Boolean).join(" ")}
                disabled={disabled}
                onClick={() => void beginAction(action)}
              >
                <span><Icon /></span>
                <span>
                  <strong>{action.label}</strong>
                  <small>{action.detail}</small>
                </span>
                <code>{action.local ? "SAFE EXIT" : action.destructive ? "SYSTEM" : "SESSION"}</code>
              </button>
            );
          })}
        </div>
      ) : (
        <section
          className={`session-confirmation ${challenge.destructive ? "is-destructive" : ""}`}
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="session-confirmation-title"
        >
          <span className="session-confirmation-icon" aria-hidden="true">
            <ChallengeIcon />
          </span>
          <div>
            <small>EXPLICIT CONFIRMATION REQUIRED</small>
            <strong id="session-confirmation-title">{challenge.title}</strong>
            <p>{challenge.detail}</p>
            <code>{challenge.local
              ? "JARVIS WILL CLOSE · WINDOWS STAYS ACTIVE"
              : `SINGLE-USE CAPABILITY · ${sessionState.confirmationTimeoutSeconds} SECONDS`}</code>
          </div>
          <div>
            <button
              ref={cancelConfirmationRef}
              type="button"
              data-dialog-initial-focus="true"
              disabled={busy}
              onClick={() => void cancelChallenge()}
            >
              CANCEL
            </button>
            <button
              type="button"
              className={challenge.destructive ? "is-destructive" : "is-confirm"}
              disabled={busy}
              onClick={() => void confirmAction()}
            >
              {busy ? "REQUESTING" : `CONFIRM ${challenge.title}`}
            </button>
          </div>
        </section>
      )}

      {error ? (
        <p className="runtime-settings-error session-control-error" role="alert">
          <AlertRegular />
          {error}
        </p>
      ) : null}

      <footer className="session-control-footer">
        <span><ShieldRegular /> CTRL+SHIFT+Q ALWAYS RESTORES WINDOWS</span>
        <small>No force-close flag is exposed to JARVIS.</small>
      </footer>
    </section>
  );
}

function HelpCenterPanel({ onClose, onOpenPanel }) {
  const [query, setQuery] = useState("");
  const visibleSections = useMemo(() => filterHelpSections(query), [query]);

  return (
    <section
      className="shell-panel help-center-panel"
      role="dialog"
      aria-modal="false"
      aria-label="JARVIS help and shortcuts"
    >
      <PanelHeader eyebrow="LOCAL GUIDE · F1" title="HELP / SHORTCUTS" onClose={onClose} />
      <label className="help-center-search">
        <SearchRegular aria-hidden="true" />
        <input
          autoFocus
          data-dialog-initial-focus="true"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tasks, shortcuts, privacy, recovery"
          aria-label="Search JARVIS help"
        />
        <kbd>F1</kbd>
      </label>
      <div className="help-center-layout">
        <nav aria-label="Help categories">
          {helpCenterSections.map((section, index) => (
            <button
              key={section.id}
              type="button"
              onClick={() => document.getElementById(`help-${section.id}`)?.scrollIntoView({ block: "start" })}
            >
              <code>{String(index + 1).padStart(2, "0")}</code><span>{section.label}</span>
            </button>
          ))}
        </nav>
        <div className="help-center-ledger" aria-live="polite">
          {visibleSections.length > 0 ? visibleSections.map((section) => (
            <section key={section.id} id={`help-${section.id}`}>
              <header><small>{section.label}</small><strong>{section.title}</strong><p>{section.summary}</p></header>
              <dl>
                {section.entries.map((entry) => (
                  <div key={`${section.id}:${entry.command}`}>
                    <dt>{entry.command}</dt><dd>{entry.detail}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )) : <p className="shell-empty-state">No help entry matches this search.</p>}
        </div>
      </div>
      <footer className="help-center-footer">
        <span><ShieldRegular /> EXPLORER STAYS RUNNING · NATIVE TASKBAR RESTORES ON EXIT</span>
        <button type="button" onClick={() => onOpenPanel("session")}>SESSION CONTROL</button>
        <button type="button" onClick={() => onOpenPanel("settings")}>RECOVERY CHECK</button>
      </footer>
    </section>
  );
}

const runtimeSettingsSections = Object.freeze([
  { id: "settings-general", label: "GENERAL" },
  { id: "settings-taskbar", label: "TASKBAR" },
  { id: "settings-windows", label: "WINDOWS" },
  { id: "settings-interface", label: "INTERFACE" },
  { id: "settings-integration", label: "INTEGRATION" },
  { id: "settings-help", label: "HELP" },
  { id: "settings-recovery", label: "RECOVERY" },
]);

function RuntimeSettingsPanel({ onClose, onToast, onOpenHelp }) {
  const panelRef = useRef(null);
  const [runtime, setRuntime] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagnosticStatus, setDiagnosticStatus] = useState("idle");
  const [activeSection, setActiveSection] = useState(runtimeSettingsSections[0].id);

  useEffect(() => {
    let active = true;
    platform.lifecycle.getRuntimeInfo()
      .then((result) => {
        if (!active) return;
        setRuntime(result);
        setStatus("ready");
      })
      .catch((nextError) => {
        if (!active) return;
        setError(nextError.message);
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const updateStartup = async () => {
    if (!runtime || status === "saving") return;
    const needsRepair = runtime.startupEnabled && !runtime.startupCommandCurrent;
    const enabled = needsRepair ? true : !runtime.startupEnabled;
    setStatus("saving");
    setError("");
    try {
      const result = await platform.lifecycle.setStartupEnabled(enabled);
      setRuntime(result);
      setStatus("ready");
      onToast?.(enabled ? "JARVIS will start when you sign in" : "Windows startup disabled for JARVIS");
    } catch (nextError) {
      setError(nextError.message);
      setStatus("error");
    }
  };

  const startupEnabled = Boolean(runtime?.startupEnabled && runtime?.startupCommandCurrent);
  const startupNeedsRepair = Boolean(runtime?.startupEnabled && !runtime?.startupCommandCurrent);
  const recoveryReady = Boolean(runtime?.recoveryReady);
  const handleSettingsScroll = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const threshold = panel.getBoundingClientRect().top + 112;
    let nextSection = runtimeSettingsSections[0].id;
    runtimeSettingsSections.forEach(({ id }) => {
      const section = document.getElementById(id);
      if (section && section.getBoundingClientRect().top <= threshold) {
        nextSection = id;
      }
    });
    setActiveSection((current) => current === nextSection ? current : nextSection);
  }, []);
  const jumpToSection = (sectionId) => {
    const section = document.getElementById(sectionId);
    if (!section) return;
    setActiveSection(sectionId);
    section.scrollIntoView({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  };

  const runDiagnostics = async () => {
    if (diagnosticStatus === "running") return;
    setDiagnosticStatus("running");
    setError("");
    try {
      const result = await platform.lifecycle.runDiagnostics();
      setDiagnostics(result);
      setDiagnosticStatus("ready");
      onToast?.(result.overallStatus === "READY"
        ? `Recovery diagnostics passed · ${result.verifiedFiles} files verified`
        : `Recovery diagnostics: ${result.overallStatus}`);
    } catch (nextError) {
      setError(nextError.message);
      setDiagnosticStatus("error");
    }
  };

  return (
    <section
      ref={panelRef}
      className="shell-panel runtime-settings-panel"
      role="dialog"
      aria-modal="false"
      aria-label="JARVIS settings"
      onScroll={handleSettingsScroll}
    >
      <PanelHeader eyebrow="CURRENT USER · NO ADMIN REQUIRED" title="JARVIS SETTINGS" onClose={onClose} />

      <nav className="runtime-settings-nav" aria-label="Settings sections">
        {runtimeSettingsSections.map((section) => (
          <button
            key={section.id}
            type="button"
            aria-current={activeSection === section.id ? "location" : undefined}
            onClick={() => jumpToSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <section
        id="settings-general"
        className="runtime-settings-section-anchor"
        aria-label="General runtime settings"
      >
        <div className="runtime-identity">
          <CoreNodeGlyph />
          <span>
            <small>RUNTIME CHANNEL</small>
            <strong>{runtime?.productName ?? "JARVIS"}</strong>
            <code>VERSION {runtime?.version ?? "—"} · {runtime?.buildConfiguration ?? "LOADING"}</code>
            <small className="runtime-environment">
              {runtime?.installationMode ?? "DETECTING"} · WEBVIEW2 {runtime?.webView2Version ?? "—"}
            </small>
          </span>
        </div>

        <div className="runtime-setting-list">
          <div className="runtime-setting-row">
            <span className="runtime-setting-icon"><PowerRegular /></span>
            <span className="runtime-setting-copy">
              <strong>START WITH WINDOWS</strong>
              <small>{startupNeedsRepair
                ? "The saved startup path belongs to an older JARVIS build."
                : "Launch JARVIS after the current Windows user signs in."}</small>
            </span>
            <button
              type="button"
              className={`runtime-switch ${startupEnabled ? "is-on" : ""} ${startupNeedsRepair ? "needs-repair" : ""}`}
              role="switch"
              aria-checked={startupEnabled}
              disabled={!runtime || status === "saving"}
              onClick={updateStartup}
            >
              <span />
              <strong>{status === "saving" ? "SAVING" : startupNeedsRepair ? "REPAIR" : startupEnabled ? "ON" : "OFF"}</strong>
            </button>
          </div>

          <div className="runtime-setting-row is-readonly">
            <span className="runtime-setting-icon"><ShieldRegular /></span>
            <span className="runtime-setting-copy">
              <strong>WINDOWS RECOVERY PATH</strong>
              <small>Explorer stays running and the native taskbar is restored on exit or failure.</small>
            </span>
            <span className={recoveryReady ? "runtime-state-ok" : "runtime-state-attention"}>
              {recoveryReady ? <CheckmarkCircleRegular /> : <AlertRegular />}
              {recoveryReady ? "ARMED" : "CHECK"}
            </span>
          </div>
        </div>
      </section>

      <div id="settings-taskbar" className="runtime-settings-section-anchor">
        <TaskbarModeSettings onToast={onToast} />
      </div>

      <div id="settings-windows" className="runtime-settings-section-anchor">
        <WindowAppearanceSettings onToast={onToast} />
      </div>

      <div id="settings-interface" className="runtime-settings-section-anchor">
        <InterfacePreferences onToast={onToast} />
      </div>

      <div id="settings-integration" className="runtime-settings-section-anchor">
        <NativeIntegrationSettings onToast={onToast} />
      </div>

      <section
        id="settings-help"
        className="runtime-settings-section-anchor runtime-help-entry"
        aria-label="JARVIS help and shortcuts"
      >
        <span><PulseRegular /></span>
        <span>
          <small>HELP / SHORTCUTS / RECOVERY</small>
          <strong>OPEN THE LOCAL OPERATIONS MAP</strong>
          <p>Press F1 anywhere in JARVIS for file, window, Agent-link, privacy, and safe-exit guidance.</p>
        </span>
        <button type="button" onClick={onOpenHelp}>OPEN HELP CENTER</button>
      </section>

      <section
        id="settings-recovery"
        className="runtime-settings-section-anchor"
        aria-label="Recovery diagnostics"
      >
        <div className="runtime-path-card">
          <small>ACTIVE EXECUTABLE</small>
          <code title={runtime?.executablePath}>{runtime?.executablePath ?? "Resolving native runtime…"}</code>
        </div>

        <section className="runtime-diagnostics" aria-label="Release and recovery diagnostics">
          <header>
            <span>
              <small>RELEASE &amp; RECOVERY</small>
              <strong>{diagnostics?.overallStatus ?? "NOT CHECKED"}</strong>
            </span>
            <button
              type="button"
              disabled={!runtime || diagnosticStatus === "running"}
              onClick={runDiagnostics}
            >
              {diagnosticStatus === "running" ? "VERIFYING…" : diagnostics ? "RUN AGAIN" : "RUN CHECK"}
            </button>
          </header>

          {diagnostics ? (
            <div className="runtime-diagnostic-results">
              {diagnostics.checks.map((check) => (
                <div key={check.id} className={`is-${check.status.toLowerCase()}`}>
                  <span>{check.status === "READY" ? <CheckmarkCircleRegular /> : <AlertRegular />}</span>
                  <span><strong>{check.label}</strong><small>{check.detail}</small></span>
                  <code>{check.status}</code>
                </div>
              ))}
            </div>
          ) : (
            <p>On demand only. Verifies Windows recovery, the global safe-exit path, native window guards, runtime, startup, installer records, and package hashes.</p>
          )}
        </section>
      </section>

      {error ? <p className="runtime-settings-error" role="alert"><AlertRegular />{error}</p> : null}

      <footer className="runtime-settings-footer">
        <span>{runtime?.safeMode ? "SAFE MODE · NATIVE TASKBAR KEPT" : platform.isNative ? "NATIVE WINDOWS HOST" : "BROWSER PREVIEW"}</span>
        <strong>{startupEnabled ? "AUTO START ARMED" : startupNeedsRepair ? "STARTUP REPAIR REQUIRED" : "MANUAL START"}</strong>
      </footer>
    </section>
  );
}

function NativeIntegrationSettings({ onToast }) {
  const displays = useDisplayTopology();
  const notifications = useNotificationHistory();
  const [requesting, setRequesting] = useState(false);

  const requestAccess = async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      const state = await requestNotificationHistoryAccess();
      onToast?.(state.historyAvailable
        ? "Windows notification history connected"
        : state.reason ?? "Windows notification history remains unavailable");
    } catch (nextError) {
      onToast?.(`Notification access check failed · ${nextError.message}`);
    } finally {
      setRequesting(false);
    }
  };

  return (
    <section className="native-integration-settings" aria-label="Windows integration readiness">
      <header>
        <span><PlugConnectedRegular /></span>
        <span>
          <strong>WINDOWS INTEGRATION</strong>
          <small>R10 / R11 · 权限与显示器拓扑</small>
        </span>
        <button
          type="button"
          onClick={() => {
            void refreshDisplayTopology();
            void refreshNotificationHistory();
          }}
        >
          REFRESH
        </button>
      </header>

      <div className="native-integration-grid">
        <article>
          <small>NOTIFICATION HISTORY</small>
          <strong>{notifications.historyAvailable ? "CONNECTED" : "FEASIBILITY GATE"}</strong>
          <p>{notifications.reason ?? "Windows notification history is available."}</p>
          <dl>
            <div><dt>API</dt><dd>{notifications.apiAvailable ? "AVAILABLE" : "UNAVAILABLE"}</dd></div>
            <div><dt>IDENTITY</dt><dd>{notifications.packaged ? "MSIX" : "UNPACKAGED"}</dd></div>
            <div><dt>ACCESS</dt><dd>{notifications.accessStatus}</dd></div>
          </dl>
          <button
            type="button"
            disabled={!notifications.canRequestAccess || requesting}
            onClick={requestAccess}
          >
            {requesting ? "REQUESTING…" : notifications.canRequestAccess
              ? "REQUEST ACCESS"
              : notifications.packaged ? "ADAPTER NOT ENABLED" : "SIGNED MSIX REQUIRED"}
          </button>
        </article>

        <article>
          <small>DISPLAY TOPOLOGY</small>
          <strong>{displays.monitors.length} MONITOR{displays.monitors.length === 1 ? "" : "S"}</strong>
          <p>
            主桌面仅覆盖主显示器；副屏原生任务栏保持可用。
          </p>
          <dl>
            <div><dt>OS BUILD</dt><dd>{displays.osBuild || "—"}</dd></div>
            <div><dt>WIN10 BASELINE</dt><dd>{displays.windows10Compatible ? "READY" : "UNSUPPORTED"}</dd></div>
            <div><dt>POLICY</dt><dd>{displays.desktopSurfacePolicy}</dd></div>
          </dl>
          <div className="display-monitor-list">
            {displays.monitors.map((monitor) => (
              <span key={monitor.id} className={monitor.isPrimary ? "is-primary" : ""}>
                <b>{monitor.isPrimary ? "PRIMARY" : monitor.deviceName.replace("\\\\.\\", "")}</b>
                <small>{monitor.bounds.width}×{monitor.bounds.height} · {monitor.scalePercent}%</small>
              </span>
            ))}
          </div>
        </article>
      </div>

      {displays.error ? <p className="runtime-settings-error"><AlertRegular />{displays.error}</p> : null}
      {notifications.error ? <p className="runtime-settings-error"><AlertRegular />{notifications.error}</p> : null}
    </section>
  );
}

function TaskbarModeSettings({ onToast }) {
  const state = useTaskbarModeState();
  const [pendingMode, setPendingMode] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const previousTransition = useRef({
    generation: state.transitionGeneration,
    status: state.transitionStatus,
  });
  const selectedMode = pendingMode ?? state.requestedMode;
  const busy = state.loading ||
    state.transitionStatus === "applying" ||
    pendingMode !== null ||
    retrying;
  const retryAfterTimestamp = state.retryAfterUtc
    ? Date.parse(state.retryAfterUtc)
    : Number.NaN;
  const cooldownRemaining = getTaskbarCooldownRemaining(
    state.retryAfterUtc,
    clock,
  );
  const modeMismatch = state.requestedMode !== state.effectiveMode;
  const canRetry = canRetryTaskbarMode(state, busy, clock);

  useEffect(() => {
    const previous = previousTransition.current;
    const toast = getTaskbarTransitionToast(previous, state);
    if (toast) onToast?.(toast);
    previousTransition.current = {
      generation: state.transitionGeneration,
      status: state.transitionStatus,
    };
  }, [
    onToast,
    state.effectiveMode,
    state.transitionGeneration,
    state.transitionStatus,
  ]);

  useEffect(() => {
    if (!Number.isFinite(retryAfterTimestamp) ||
        retryAfterTimestamp <= Date.now()) {
      return undefined;
    }

    setClock(Date.now());
    const timer = globalThis.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= retryAfterTimestamp) {
        globalThis.clearInterval(timer);
      }
    }, 1000);
    return () => globalThis.clearInterval(timer);
  }, [retryAfterTimestamp]);

  const updateMode = async (mode) => {
    if (busy || mode === state.requestedMode) return;
    setPendingMode(mode);
    try {
      await setTaskbarMode(mode);
    } catch {
      // The shared taskbar-mode store exposes bridge failures inline.
    } finally {
      setPendingMode(null);
    }
  };

  const retryMode = async () => {
    if (!canRetry) return;
    setRetrying(true);
    try {
      await retryTaskbarMode();
    } catch {
      // The shared taskbar-mode store exposes the structured rejection inline.
    } finally {
      setRetrying(false);
    }
  };

  return (
    <section className="window-appearance-settings" aria-labelledby="taskbar-mode-title" aria-busy={busy}>
      <header className="window-appearance-header">
        <span className="window-appearance-icon"><WindowAppsRegular /></span>
        <span>
          <strong id="taskbar-mode-title">任务栏接管模式</strong>
          <small>TASKBAR MODE · 分层回退，不修改 Explorer</small>
        </span>
        <code className={state.effectiveMode === state.requestedMode ? "is-compatible" : ""}>
          {(state.effectiveMode ?? "native").toUpperCase()}
        </code>
      </header>

      <fieldset disabled={busy || state.safeMode}>
        <legend>选择任务栏接管级别</legend>
        <div className="window-appearance-options">
          {taskbarModeOptions.map((option, index) => {
            const selected = selectedMode === option.mode;
            return (
              <label
                key={option.mode}
                className={`window-appearance-choice ${selected ? "is-selected" : ""} is-${option.mode}`}
              >
                <input
                  type="radio"
                  name="taskbar-mode"
                  value={option.mode}
                  checked={selected}
                  onChange={() => updateMode(option.mode)}
                />
                <span className="window-appearance-level" aria-hidden="true">T{index}</span>
                <span className="window-appearance-copy">
                  <strong><span>{option.title}</span><b>{option.label}</b></strong>
                  <small>{option.description}</small>
                </span>
                <span className="window-appearance-selector" aria-hidden="true"><i /></span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="window-appearance-telemetry is-taskbar" role="status" aria-live="polite">
        <span><small>请求模式 · REQUESTED</small><strong>{busy ? "APPLYING" : state.requestedMode.toUpperCase()}</strong></span>
        <span><small>实际模式 · EFFECTIVE</small><strong>{state.effectiveMode.toUpperCase()}</strong></span>
        <span><small>事务状态 · TRANSITION</small><strong>{state.transitionStatus.toUpperCase()}</strong></span>
        <span><small>恢复预算 · RECOVERY</small><strong>{state.recoveryFailureCount}/3 · G{state.transitionGeneration}</strong></span>
      </div>

      {state.transitionReason ? (
        <p className="window-appearance-feedback" role="status">
          <PulseRegular /><span>当前事务：{state.transitionReason}</span>
        </p>
      ) : null}
      {state.safeMode ? (
        <p className="window-appearance-feedback is-fallback" role="status">
          <ShieldRegular /><span>安全模式已启用：JARVIS_KEEP_NATIVE_TASKBAR=1。</span>
        </p>
      ) : null}
      {state.fallbackReason ? (
        <p className="window-appearance-feedback is-fallback" role="status">
          <AlertRegular /><span>{state.fallbackReason}</span>
          {modeMismatch ? (
            <button
              type="button"
              className="taskbar-mode-retry"
              disabled={!canRetry}
              onClick={retryMode}
            >
              <ArrowClockwiseRegular />
              {retrying
                ? "RETRYING"
                : cooldownRemaining > 0
                  ? `RETRY ${cooldownRemaining}s`
                  : `RETRY ${state.requestedMode.toUpperCase()}`}
            </button>
          ) : null}
        </p>
      ) : null}
      {state.error ? (
        <p className="window-appearance-feedback is-error" role="alert">
          <AlertRegular /><span>{state.error.message ?? String(state.error)}</span>
        </p>
      ) : null}
    </section>
  );
}

function InterfacePreferences({ onToast }) {
  const themeId = useSyncExternalStore(
    subscribeVisualTheme,
    getVisualThemeSnapshot,
    getVisualThemeSnapshot,
  );
  const audio = useSyncExternalStore(
    subscribeUiAudio,
    getUiAudioSnapshot,
    getUiAudioSnapshot,
  );
  const interfacePreferences = useSyncExternalStore(
    subscribeInterfacePreferences,
    getInterfacePreferencesSnapshot,
    getInterfacePreferencesSnapshot,
  );

  const resetInterface = () => {
    setVisualTheme("nexus");
    setUiAudioEnabled(false);
    setUiAudioVolume(0.14);
    resetInterfacePreferences();
    onToast?.("Interface preferences restored to safe defaults");
  };

  return (
    <section className="interface-preferences" aria-labelledby="interface-preferences-title">
      <header>
        <span>
          <strong id="interface-preferences-title">INTERFACE SIGNAL</strong>
          <small>LAYERED EMISSION · ACCESSIBLE AUDIO</small>
        </span>
        <code>{themeId.toUpperCase()} · {interfacePreferences.emission.toUpperCase()}</code>
      </header>

      <div className="theme-choice-grid" role="radiogroup" aria-label="JARVIS visual theme">
        {visualThemes.map((theme) => (
          <button
            key={theme.id}
            type="button"
            role="radio"
            aria-checked={theme.id === themeId}
            className={theme.id === themeId ? "is-selected" : ""}
            onClick={() => {
              setVisualTheme(theme.id);
              onToast?.(`Visual profile: ${theme.label}`);
            }}
          >
            <span className={`theme-swatch is-${theme.id}`} aria-hidden="true"><i /><i /><i /></span>
            <span><strong>{theme.label}</strong><small>{theme.description}</small></span>
          </button>
        ))}
      </div>

      <div className="interface-option-group">
        <header>
          <span><strong>MOTION PROFILE</strong><small>ACCESSIBILITY · LOCAL PREFERENCE</small></span>
          <code>{interfacePreferences.motion.toUpperCase()}</code>
        </header>
        <div className="interface-option-grid" role="radiogroup" aria-label="JARVIS motion preference">
          {interfaceMotionOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={option.id === interfacePreferences.motion}
              className={option.id === interfacePreferences.motion ? "is-selected" : ""}
              onClick={() => setInterfacePreferences({ motion: option.id })}
            >
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="interface-option-group">
        <header>
          <span><strong>EMISSION LEVEL</strong><small>LINE LEGIBILITY REMAINS UNCHANGED</small></span>
          <code>{interfacePreferences.emission.toUpperCase()}</code>
        </header>
        <div className="interface-option-grid" role="radiogroup" aria-label="JARVIS emission preference">
          {interfaceEmissionOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={option.id === interfacePreferences.emission}
              className={option.id === interfacePreferences.emission ? "is-selected" : ""}
              onClick={() => setInterfacePreferences({ emission: option.id })}
            >
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="audio-preference-row">
        <span className="runtime-setting-icon"><Speaker2Regular /></span>
        <span>
          <strong>INTERACTION AUDIO</strong>
          <small>Synthesized locally. No media asset or network request.</small>
        </span>
        <input
          type="range"
          min="0.04"
          max="0.32"
          step="0.01"
          value={audio.volume}
          disabled={!audio.enabled}
          onChange={(event) => setUiAudioVolume(event.target.value)}
          aria-label="Interaction audio volume"
        />
        <button
          type="button"
          className={`runtime-switch ${audio.enabled ? "is-on" : ""}`}
          role="switch"
          aria-checked={audio.enabled}
          onClick={() => setUiAudioEnabled(!audio.enabled)}
        >
          <span />
          <strong>{audio.enabled ? "ON" : "OFF"}</strong>
        </button>
      </div>
      <button
        type="button"
        className="interface-reset-button"
        onClick={resetInterface}
      >
        <ArrowClockwiseRegular />
        <span>
          <strong>RESET INTERFACE</strong>
          <small>Theme, motion, emission, and local interaction audio only.</small>
        </span>
      </button>
    </section>
  );
}

function WindowAppearanceSettings({ onToast }) {
  const appearance = useWindowAppearanceState();
  const [pendingMode, setPendingMode] = useState(null);
  const [pendingRule, setPendingRule] = useState(false);
  const [processInput, setProcessInput] = useState("");
  const [ruleAction, setRuleAction] = useState("deny");
  const [ruleInputError, setRuleInputError] = useState(null);
  const selectedMode = pendingMode ?? appearance.mode;
  const busy = appearance.loading || pendingMode !== null || pendingRule;
  const effectiveLabel = windowAppearanceLabels[appearance.effectiveMode] ?? "OFF";
  const windowsReleaseLabel = getWindowsReleaseLabel(appearance.windows11, appearance.osBuild);

  const updateMode = async (mode) => {
    if (busy || mode === appearance.mode) return;
    setPendingMode(mode);
    try {
      const nextState = await setWindowAppearanceMode(mode);
      const nextLabel = windowAppearanceLabels[nextState.effectiveMode] ?? nextState.effectiveMode;
      onToast?.(nextState.effectiveMode === mode
        ? `Window appearance switched to ${nextLabel}`
        : `Windows automatically fell back to ${nextLabel}`);
    } catch {
      // The shared appearance store exposes the bridge error inline.
    } finally {
      setPendingMode(null);
    }
  };

  const updateRule = async (processNameValue, action, clearInput = false) => {
    if (busy) return;
    const processName = normalizeWindowAppearanceProcessName(processNameValue);
    if (!processName) {
      setRuleInputError("Enter a process filename such as notepad.exe; paths and wildcards are not allowed.");
      return;
    }

    setRuleInputError(null);
    setPendingRule(true);
    try {
      await setWindowAppearanceRule(processName, action);
      if (clearInput) setProcessInput("");
      onToast?.(`${processName} is now ${action === "allow" ? "allowed" : "blocked"} for takeover`);
    } catch {
      // The shared appearance store exposes native validation errors inline.
    } finally {
      setPendingRule(false);
    }
  };

  const removeRule = async (processName) => {
    if (busy) return;
    setRuleInputError(null);
    setPendingRule(true);
    try {
      await removeWindowAppearanceRule(processName);
      onToast?.(`${processName} restored to automatic compatibility`);
    } catch {
      // The shared appearance store exposes bridge errors inline.
    } finally {
      setPendingRule(false);
    }
  };

  const submitRule = (event) => {
    event.preventDefault();
    updateRule(processInput, ruleAction, true);
  };

  return (
    <section
      className="window-appearance-settings"
      aria-labelledby="window-appearance-title"
      aria-busy={busy}
    >
      <header className="window-appearance-header">
        <span className="window-appearance-icon"><WindowAppsRegular /></span>
        <span>
          <strong id="window-appearance-title">原生窗口外观</strong>
          <small>WINDOW APPEARANCE · 分层接管，异常时自动回退</small>
        </span>
        <code className={appearance.windows11 ? "is-compatible" : ""}>
          {windowsReleaseLabel}
        </code>
      </header>

      <fieldset disabled={busy}>
        <legend>选择窗口外观接管级别</legend>
        <div className="window-appearance-options">
          {windowAppearanceOptions.map((option) => {
            const selected = selectedMode === option.mode;
            return (
              <label
                key={option.mode}
                className={`window-appearance-choice ${selected ? "is-selected" : ""} is-${option.mode}`}
              >
                <input
                  type="radio"
                  name="window-appearance-mode"
                  value={option.mode}
                  checked={selected}
                  aria-describedby={`window-appearance-${option.mode}-description`}
                  onChange={() => updateMode(option.mode)}
                />
                <span className="window-appearance-level" aria-hidden="true">{option.level}</span>
                <span className="window-appearance-copy">
                  <strong><span>{option.title}</span><b>{option.label}</b></strong>
                  <small id={`window-appearance-${option.mode}-description`}>{option.description}</small>
                </span>
                <span className="window-appearance-tag">{option.tag}</span>
                <span className="window-appearance-selector" aria-hidden="true"><i /></span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="window-appearance-telemetry" role="status" aria-live="polite">
        <span><small>实际层级 · EFFECTIVE</small><strong>{busy ? "APPLYING" : effectiveLabel}</strong></span>
        <span><small>增强窗口 · STYLED</small><strong>{appearance.styledWindowCount}</strong></span>
        <span><small>系统构建 · OS BUILD</small><strong>{appearance.osBuild ?? "—"}</strong></span>
      </div>

      <div className="window-appearance-guards" aria-label="窗口接管安全状态">
        <span className={appearance.effectiveMode === "off" || appearance.hooksReady ? "is-ready" : "is-warning"}>
          <i />EVENTS {appearance.effectiveMode === "off" ? "IDLE" : appearance.hooksReady ? "READY" : "OFFLINE"}
        </span>
        <span className={appearance.hostIntegrityVerified ? "is-ready" : "is-warning"}>
          <i />INTEGRITY {appearance.hostIntegrityVerified ? "VERIFIED" : "BLOCKED"}
        </span>
        <span className={appearance.safetyHotkeyRegistered ? "is-ready" : "is-warning"}>
          <i />SAFE EXIT {appearance.safetyHotkeyRegistered ? "ARMED" : "LOCAL ONLY"}
        </span>
        <span className={appearance.recoveryArmed ? "is-ready" : "is-warning"}>
          <i />RECOVERY {appearance.recoveryArmed ? "ARMED" : "PENDING"}
        </span>
      </div>

      <section className="window-rule-editor" aria-labelledby="window-rule-title">
        <header>
          <span>
            <strong id="window-rule-title">应用规则</strong>
            <small>APP RULES · 系统保护项不可覆盖 · {appearance.rules.length}/64</small>
          </span>
        </header>
        <form onSubmit={submitRule}>
          <label>
            <span className="sr-only">进程文件名</span>
            <input
              type="text"
              value={processInput}
              maxLength={68}
              placeholder="notepad.exe"
              autoComplete="off"
              spellCheck="false"
              disabled={busy}
              aria-invalid={Boolean(ruleInputError)}
              aria-describedby={ruleInputError ? "window-rule-input-error" : undefined}
              onChange={(event) => {
                setProcessInput(event.target.value);
                setRuleInputError(null);
              }}
            />
          </label>
          <div className="window-rule-action" role="group" aria-label="规则动作">
            <button
              type="button"
              className={ruleAction === "allow" ? "is-active is-allow" : ""}
              disabled={busy}
              onClick={() => setRuleAction("allow")}
            >
              ALLOW
            </button>
            <button
              type="button"
              className={ruleAction === "deny" ? "is-active is-deny" : ""}
              disabled={busy}
              onClick={() => setRuleAction("deny")}
            >
              DENY
            </button>
          </div>
          <button type="submit" className="window-rule-submit" disabled={busy || !processInput.trim()}>
            {pendingRule ? "APPLYING" : "APPLY"}
          </button>
        </form>
        {ruleInputError ? (
          <p id="window-rule-input-error" className="window-rule-inline-error" role="alert">
            {ruleInputError}
          </p>
        ) : null}
        {appearance.rules.length ? (
          <div className="window-rule-list" aria-label="已保存应用规则">
            {appearance.rules.map((rule) => (
              <div key={rule.processName}>
                <code>{rule.processName}.exe</code>
                <button
                  type="button"
                  className={`is-${rule.action}`}
                  disabled={busy}
                  onClick={() => updateRule(
                    rule.processName,
                    rule.action === "allow" ? "deny" : "allow",
                  )}
                >
                  {rule.action.toUpperCase()}
                </button>
                <button
                  type="button"
                  className="window-rule-remove"
                  disabled={busy}
                  aria-label={`移除 ${rule.processName} 规则`}
                  onClick={() => removeRule(rule.processName)}
                >
                  <DismissRegular />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="window-rule-empty">尚未添加规则；合格应用继续使用自动兼容判定。</p>
        )}
      </section>

      <section className="window-compatibility" aria-labelledby="window-compatibility-title">
        <header>
          <span>
            <strong id="window-compatibility-title">当前窗口兼容矩阵</strong>
            <small>VISIBLE TOP-LEVEL WINDOWS · 按进程聚合</small>
          </span>
          <b>{appearance.compatibilityMatrix.length}</b>
        </header>
        {appearance.compatibilityMatrix.length ? (
          <div className="window-compatibility-list">
            {appearance.compatibilityMatrix.map((entry) => {
              const actionable = !["protected", "limited"].includes(entry.decision);
              const nextAction = entry.decision === "denied" ? "allow" : "deny";
              return (
                <div key={entry.processName} className={`is-${entry.decision}`}>
                  <span>
                    <code>{entry.processName}.exe</code>
                    <small>{getWindowCompatibilityReasonLabel(entry.reasonCode)}</small>
                  </span>
                  <span className="window-compatibility-counts">
                    <small>WIN</small><b>{entry.windowCount}</b>
                    <small>READY</small><b>{entry.eligibleWindowCount}</b>
                    <small>LIVE</small><b>{entry.styledWindowCount}</b>
                  </span>
                  <button
                    type="button"
                    disabled={busy || !actionable}
                    onClick={() => updateRule(entry.processName, nextAction)}
                  >
                    {actionable ? nextAction.toUpperCase() : entry.decision.toUpperCase()}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="window-rule-empty">暂无可评估的用户可见顶层窗口。</p>
        )}
      </section>

      <p className="window-appearance-safety-note">
        <ShieldRegular />
        <span>UAC、安全桌面和全屏独占窗口始终不接管；正常退出或异常终止后自动恢复。</span>
      </p>

      {appearance.fallbackReason ? (
        <p className="window-appearance-feedback is-fallback" role="status">
          <AlertRegular />
          <span>当前已回退至 {effectiveLabel}：{appearance.fallbackReason}</span>
        </p>
      ) : null}
      {appearance.error ? (
        <p className="window-appearance-feedback is-error" role="alert">
          <AlertRegular />
          <span>{appearance.error}</span>
        </p>
      ) : null}
    </section>
  );
}

export function ShellPanelLayer({
  panel,
  onClose,
  onOpenCommand,
  onLaunch,
  onLaunchInstalled,
  onActivateWindow,
  onOpenPanel,
  onExit,
  onToast,
  localFeedEvents,
  onClearLocalFeed,
  onMarkLocalFeedRead,
}) {
  const panelRef = useRef(null);
  useDialogFocusTrap(panelRef, Boolean(panel), { onEscape: onClose });

  if (!panel) return null;

  return (
    <div className={`shell-panel-layer is-${panel}`} onMouseDown={onClose}>
      <div ref={panelRef} onMouseDown={(event) => event.stopPropagation()}>
        {panel === "start" ? (
          <StartPanel
            onClose={onClose}
            onOpenCommand={onOpenCommand}
            onLaunch={onLaunch}
            onLaunchInstalled={onLaunchInstalled}
            onActivateWindow={onActivateWindow}
            onOpenHelp={() => onOpenPanel("help")}
            onOpenSession={() => onOpenPanel("session")}
          />
        ) : null}
        {panel === "quick-settings" ? <QuickSettingsPanel onClose={onClose} onLaunch={onLaunch} /> : null}
        {panel === "date-time" ? <DateTimePanel onClose={onClose} onLaunch={onLaunch} /> : null}
        {panel === "notifications" ? (
          <NotificationsPanel
            localEvents={localFeedEvents}
            onClearLocalFeed={onClearLocalFeed}
            onClose={onClose}
            onLaunch={onLaunch}
            onMarkLocalFeedRead={onMarkLocalFeedRead}
          />
        ) : null}
        {panel === "session" ? (
          <SessionControlPanel
            onClose={onClose}
            onExit={onExit}
            onToast={onToast}
          />
        ) : null}
        {panel === "settings" ? (
          <RuntimeSettingsPanel
            onClose={onClose}
            onToast={onToast}
            onOpenHelp={() => onOpenPanel("help")}
          />
        ) : null}
        {panel === "help" ? <HelpCenterPanel onClose={onClose} onOpenPanel={onOpenPanel} /> : null}
      </div>
    </div>
  );
}
