import {
  AlertRegular,
  ArrowClockwiseRegular,
  ArrowExitRegular,
  CheckmarkCircleRegular,
  DismissRegular,
  GlobeRegular,
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
  setTrayMuted,
  setTrayVolume,
  setTaskbarMode,
  setWindowAppearanceMode,
  setWindowAppearanceRule,
  useApplicationCatalog,
  useDisplayTopology,
  useNotificationHistory,
  useSystemSnapshot,
  useSystemFeed,
  useTaskbarModeState,
  useTaskbarSnapshot,
  useTrayStatus,
  useWindowAppearanceState,
} from "../hooks/usePlatformData.js";
import { useRecentApplicationIds } from "../hooks/useRecentApplications.js";
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
import {
  quickLaunchItems as startApps,
  quickSettingItems as quickSettings,
} from "../quick-search-catalog.js";
import { normalizeSearchText } from "../quick-search.js";
import {
  buildStartMenuApplications,
  createStartMenuVirtualRows,
  filterStartMenuApplications,
  getStartMenuVirtualWindow,
  groupStartMenuApplications,
} from "../start-menu-model.js";
import { normalizeProcessName } from "../taskbar-grouping.js";
import {
  getVisualThemeSnapshot,
  setVisualTheme,
  subscribeVisualTheme,
  visualThemes,
} from "../theme-system.js";
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
    description: "安全外框 + 深色标题栏、青蓝边框与系统圆角。",
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
    description: "由 Explorer 保留通知区，JARVIS 接管其余主任务栏区域。",
  },
  {
    mode: "full",
    title: "FULL",
    label: "完整替换",
    description: "实验模式；隐藏原生任务栏，第三方托盘功能可能不可用。",
  },
];

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
      <img src="/assets/jarvis-top-brand-core-v1.png" alt="" />
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
  onExit,
}) {
  const taskbar = useTaskbarSnapshot();
  const system = useSystemSnapshot();
  const applicationCatalog = useApplicationCatalog();
  const recentApplicationIds = useRecentApplicationIds();
  const pinnedApplicationRefs = usePinnedApplicationRefs();
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

  return (
    <section className="shell-panel start-panel" role="dialog" aria-modal="false" aria-label="JARVIS Start">
      <PanelHeader eyebrow="WINDOWS CONTROL" title="START" onClose={onClose} />
      <div className="start-search">
        <SearchRegular />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search all apps and running windows"
          aria-label="Search applications"
        />
        <button type="button" onClick={onOpenCommand}>QUICK SEARCH</button>
      </div>

      <div className="start-view-switch" role="tablist" aria-label="Start menu view">
        <button
          type="button"
          role="tab"
          aria-selected={view === "pinned"}
          className={view === "pinned" ? "is-active" : ""}
          onClick={() => { setQuery(""); setView("pinned"); }}
        >
          <span>PINNED</span><small>{pinnedApplications.length}</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "all"}
          className={view === "all" ? "is-active" : ""}
          onClick={() => { setQuery(""); setView("all"); }}
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
                <div className="start-section-heading"><span>RECENTLY OPENED</span><small>{recentApplications.length} LOCAL</small></div>
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
        <button type="button" onClick={() => onLaunch({ label: "JARVIS Settings", target: "jarvis-settings:" })}><SettingsRegular /><span>Settings</span></button>
        <button type="button" className="is-exit" onClick={onExit}><ArrowExitRegular /><span>Exit to Windows</span></button>
      </footer>
    </section>
  );
}

function QuickSettingsPanel({ onClose, onLaunch }) {
  const system = useSystemSnapshot();
  const tray = useTrayStatus();
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

  const commitVolume = async () => {
    setAudioError("");
    try {
      await setTrayVolume(Math.round(volume));
    } catch (error) {
      setAudioError(error.message);
    }
  };

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
          onChange={(event) => setVolume(Number(event.target.value))}
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

function NotificationsPanel({ onClose, onLaunch }) {
  const feed = useSystemFeed();
  const notificationHistory = useNotificationHistory();
  const actionTargets = {
    "open-network-settings": { label: "Network settings", target: "ms-settings:network-status" },
    "open-sound-settings": { label: "Sound settings", target: "ms-settings:sound" },
    "open-power-settings": { label: "Power settings", target: "ms-settings:powersleep" },
    "open-runtime-settings": { label: "JARVIS Settings", target: "jarvis-settings:" },
  };

  return (
    <section className="shell-panel shell-notifications-panel" role="dialog" aria-modal="false" aria-label="JARVIS system feed">
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
      <div className="shell-notification-list">
        {feed.loading ? <p className="system-feed-empty">Connecting to the JARVIS event stream…</p> : null}
        {feed.error ? <p className="runtime-settings-error" role="alert"><AlertRegular />{feed.error}</p> : null}
        {!feed.loading && !feed.error && feed.items.length === 0
          ? <p className="system-feed-empty">No JARVIS events in this session.</p>
          : null}
        {feed.items.map((item) => {
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
        <span>{feed.unreadCount} UNREAD · CURRENT SESSION ONLY</span>
        <button type="button" disabled={feed.unreadCount === 0} onClick={() => void markSystemFeedRead()}>MARK ALL READ</button>
        <button type="button" disabled={feed.items.length === 0} onClick={() => void clearSystemFeed()}>CLEAR</button>
      </footer>
    </section>
  );
}

function QuickSearchShortcutSetting({ onToast }) {
  const [shortcutState, setShortcutState] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    platform.quickSearchShortcut.getState()
      .then((result) => {
        if (!mountedRef.current) return;
        setShortcutState(result);
        setStatus("ready");
      })
      .catch((nextError) => {
        if (!mountedRef.current) return;
        setError(nextError.message);
        setStatus("error");
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (shortcutState?.status !== "starting" || status === "error") return undefined;
    let requestPending = false;
    const timer = window.setInterval(async () => {
      if (requestPending) return;
      requestPending = true;
      try {
        const result = await platform.quickSearchShortcut.getState();
        if (!mountedRef.current) return;
        setShortcutState(result);
        setStatus("ready");
      } catch (nextError) {
        if (!mountedRef.current) return;
        setError(nextError.message);
        setStatus("error");
      } finally {
        requestPending = false;
      }
    }, 350);
    return () => window.clearInterval(timer);
  }, [shortcutState?.status, status]);

  const savePreference = async (enabled, retry = false) => {
    if (status === "saving") return;
    setStatus("saving");
    setError("");
    try {
      const result = await platform.quickSearchShortcut.setEnabled(enabled);
      if (!mountedRef.current) return;
      setShortcutState(result);
      setStatus("ready");
      onToast?.(
        result.enabled
          ? result.status === "starting"
            ? "Global Quick Search renderer is starting"
            : result.registered
            ? "Global Quick Search shortcut enabled · Ctrl+Alt+J"
            : "Quick Search is enabled but the Windows shortcut is unavailable"
          : "Global Quick Search disabled · desktop Ctrl+Space remains available",
      );
    } catch (nextError) {
      if (!mountedRef.current) return;
      setError(nextError.message);
      setStatus("error");
      if (retry) {
        onToast?.("Quick Search shortcut retry failed");
      }
    }
  };

  const enabled = Boolean(shortcutState?.enabled);
  const registered = Boolean(shortcutState?.registered);
  const starting = shortcutState?.status === "starting";
  const unavailable = shortcutState?.status === "unavailable";
  const detail = status === "loading"
    ? "Reading the current-user shortcut preference…"
    : !enabled
      ? "System-wide shortcut disabled. Desktop Ctrl+Space remains available."
      : starting
        ? "Preparing the isolated search renderer before Windows shortcut registration…"
      : registered
        ? `${shortcutState.shortcut} opens Quick Search above Windows applications.`
        : `${shortcutState?.failureReason ?? "Windows did not register the shortcut."} Desktop Ctrl+Space remains available.`;

  return (
    <div className={`runtime-setting-row quick-search-shortcut-row ${unavailable ? "is-attention" : ""}`}>
      <span className="runtime-setting-icon"><SearchRegular /></span>
      <span className="runtime-setting-copy">
        <strong>GLOBAL QUICK SEARCH</strong>
        <small>{detail}</small>
        {shortcutState?.configurationWarning ? (
          <small className="runtime-setting-warning">{shortcutState.configurationWarning}</small>
        ) : null}
        {error ? <small className="runtime-setting-error" role="alert">{error}</small> : null}
        {unavailable ? (
          <button
            type="button"
            className="quick-search-shortcut-retry"
            disabled={status === "saving"}
            onClick={() => void savePreference(true, true)}
          >
            RETRY REGISTRATION
          </button>
        ) : null}
      </span>
      <button
        type="button"
        className={`runtime-switch ${enabled ? "is-on" : ""} ${unavailable ? "needs-repair" : ""}`}
        role="switch"
        aria-label="Enable global Quick Search shortcut"
        aria-checked={enabled}
        disabled={!shortcutState || status === "saving"}
        onClick={() => void savePreference(!enabled)}
      >
        <span />
        <strong>{status === "saving" ? "SAVING" : starting ? "STARTING" : enabled ? "ON" : "OFF"}</strong>
      </button>
    </div>
  );
}

const runtimeSettingsSections = Object.freeze([
  { id: "settings-general", label: "GENERAL" },
  { id: "settings-taskbar", label: "TASKBAR" },
  { id: "settings-windows", label: "WINDOWS" },
  { id: "settings-interface", label: "INTERFACE" },
  { id: "settings-integration", label: "INTEGRATION" },
  { id: "settings-recovery", label: "RECOVERY" },
]);

function RuntimeSettingsPanel({ onClose, onToast }) {
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
          <img src="/assets/jarvis-right-core-status-v1.png" alt="" />
          <span>
            <small>RUNTIME CHANNEL</small>
            <strong>{runtime?.productName ?? "JARVIS Night Shell"}</strong>
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

          <QuickSearchShortcutSetting onToast={onToast} />

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
        ? "Windows 通知历史已连接"
        : state.reason ?? "Windows 通知历史仍不可用");
    } catch (nextError) {
      onToast?.(`通知权限检查失败 · ${nextError.message}`);
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
  const selectedMode = pendingMode ?? state.requestedMode;
  const busy = state.loading || pendingMode !== null;

  const updateMode = async (mode) => {
    if (busy || mode === state.requestedMode) return;
    setPendingMode(mode);
    try {
      const nextState = await setTaskbarMode(mode);
      onToast?.(nextState.effectiveMode === mode
        ? `任务栏模式已切换至 ${mode.toUpperCase()}`
        : `任务栏已安全回退至 ${nextState.effectiveMode.toUpperCase()}`);
    } catch {
      // The shared taskbar-mode store exposes bridge failures inline.
    } finally {
      setPendingMode(null);
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

      <div className="window-appearance-telemetry" role="status" aria-live="polite">
        <span><small>请求模式 · REQUESTED</small><strong>{busy ? "APPLYING" : state.requestedMode.toUpperCase()}</strong></span>
        <span><small>实际模式 · EFFECTIVE</small><strong>{state.effectiveMode.toUpperCase()}</strong></span>
        <span><small>混合探测 · HYBRID</small><strong>{state.hybridAvailable ? "AVAILABLE" : "UNVERIFIED"}</strong></span>
      </div>

      {state.safeMode ? (
        <p className="window-appearance-feedback is-fallback" role="status">
          <ShieldRegular /><span>安全模式已启用：JARVIS_KEEP_NATIVE_TASKBAR=1。</span>
        </p>
      ) : null}
      {state.fallbackReason ? (
        <p className="window-appearance-feedback is-fallback" role="status">
          <AlertRegular /><span>{state.fallbackReason}</span>
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

  return (
    <section className="interface-preferences" aria-labelledby="interface-preferences-title">
      <header>
        <span>
          <strong id="interface-preferences-title">INTERFACE SIGNAL</strong>
          <small>LAYERED EMISSION · ACCESSIBLE AUDIO</small>
        </span>
        <code>{themeId.toUpperCase()}</code>
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
        ? `窗口外观已切换至 ${nextLabel}`
        : `系统已自动回退至 ${nextLabel}`);
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
      setRuleInputError("请输入进程文件名，例如 notepad.exe；不能包含路径或通配符。");
      return;
    }

    setRuleInputError(null);
    setPendingRule(true);
    try {
      await setWindowAppearanceRule(processName, action);
      if (clearInput) setProcessInput("");
      onToast?.(`${processName} 已设为${action === "allow" ? "允许接管" : "禁止接管"}`);
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
      onToast?.(`${processName} 已恢复自动判定`);
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
  onExit,
  onToast,
}) {
  useEffect(() => {
    if (!panel) return undefined;
    const handleEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, panel]);

  if (!panel) return null;

  return (
    <div className={`shell-panel-layer is-${panel}`} onMouseDown={onClose}>
      <div onMouseDown={(event) => event.stopPropagation()}>
        {panel === "start" ? (
          <StartPanel
            onClose={onClose}
            onOpenCommand={onOpenCommand}
            onLaunch={onLaunch}
            onLaunchInstalled={onLaunchInstalled}
            onActivateWindow={onActivateWindow}
            onExit={onExit}
          />
        ) : null}
        {panel === "quick-settings" ? <QuickSettingsPanel onClose={onClose} onLaunch={onLaunch} /> : null}
        {panel === "notifications" ? <NotificationsPanel onClose={onClose} onLaunch={onLaunch} /> : null}
        {panel === "settings" ? <RuntimeSettingsPanel onClose={onClose} onToast={onToast} /> : null}
      </div>
    </div>
  );
}
