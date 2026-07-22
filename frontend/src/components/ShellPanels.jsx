import {
  AlertRegular,
  ArrowExitRegular,
  Battery6Regular,
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
  WindowAppsRegular,
} from "@fluentui/react-icons";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  getUiAudioSnapshot,
  setUiAudioEnabled,
  setUiAudioVolume,
  subscribeUiAudio,
} from "../audio-system.js";
import {
  setWindowAppearanceMode,
  useApplicationCatalog,
  useSystemSnapshot,
  useTaskbarSnapshot,
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
  filterStartMenuApplications,
  groupStartMenuApplications,
} from "../start-menu-model.js";
import { normalizeProcessName } from "../taskbar-grouping.js";
import {
  getVisualThemeSnapshot,
  setVisualTheme,
  subscribeVisualTheme,
  visualThemes,
} from "../theme-system.js";

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

function StartMenuApplicationRow({ application, isPinned, onOpen, onTogglePin }) {
  return (
    <div className={`start-application-row${isPinned ? " is-pinned" : ""}`}>
      <button
        type="button"
        className="start-application-main"
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
  if (groups.length === 0) return <p className="shell-empty-state start-app-empty">{emptyLabel}</p>;
  return groups.map((group) => (
    <section className="start-application-group" key={group.label} aria-label={`${group.label} applications`}>
      <div className="start-application-group-label" aria-hidden="true">{group.label}</div>
      <div className="start-application-group-grid">
        {group.items.map((application) => (
          <StartMenuApplicationRow
            key={application.menuId}
            application={application}
            isPinned={pinnedKeys.has(getMenuApplicationPinKey(application))}
            onOpen={onOpen}
            onTogglePin={onTogglePin}
          />
        ))}
      </div>
    </section>
  ));
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
  const normalizedQuery = normalizeSearchText(query);
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
        : `${applicationCatalog.applications.length} WINDOWS APPS`;

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
        <span className={applicationCatalog.error ? "is-error" : ""}>{catalogStatus}</span>
      </div>

      <div className={`start-panel-content is-${contentMode}`} aria-busy={applicationCatalog.loading}>
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
            <div className="start-all-apps">
              <StartApplicationGroups
                groups={applicationGroups}
                pinnedKeys={pinnedKeys}
                onOpen={openMenuApplication}
                onTogglePin={togglePinnedApplication}
                emptyLabel={applicationCatalog.loading ? "Indexing Windows applications…" : "No matching applications."}
              />
            </div>
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
  const cpu = system.resources.find((resource) => resource.id === "cpu");
  const memory = system.resources.find((resource) => resource.id === "memory");
  const { network, power } = system.status;
  const powerLabel = power.batteryPresent
    ? `${Math.round(power.percentage ?? 0)}%${power.charging ? " · charging" : ""}`
    : power.acConnected ? "AC power" : "Desktop power";

  return (
    <section className="shell-panel quick-settings-panel" role="dialog" aria-modal="false" aria-label="Quick settings">
      <PanelHeader eyebrow="LIVE WINDOWS STATUS" title="QUICK SETTINGS" onClose={onClose} />
      <div className="quick-status-strip">
        <span className={network.available ? "is-online" : "is-offline"}><GlobeRegular /><strong>{network.available ? "ONLINE" : "OFFLINE"}</strong><small>{network.interfaceName}</small></span>
        <span><PlugConnectedRegular /><strong>{powerLabel}</strong><small>{power.batteryPresent ? "BATTERY" : "POWER"}</small></span>
        <span><PulseRegular /><strong>{cpu?.value ?? "—"}</strong><small>CPU</small></span>
        <span><WindowAppsRegular /><strong>{memory?.value ?? "—"}</strong><small>MEMORY</small></span>
      </div>
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
  const system = useSystemSnapshot();
  const taskbar = useTaskbarSnapshot();
  const { network, power } = system.status;
  const notifications = [
    {
      id: "network",
      kind: network.available ? "ok" : "warning",
      title: network.available ? "Network link established" : "Network connection unavailable",
      detail: network.available ? `${network.interfaceName} · ${network.interfaceType}` : "Open Windows network diagnostics",
      Icon: network.available ? CheckmarkCircleRegular : AlertRegular,
      target: "ms-settings:network-status",
    },
    {
      id: "session",
      kind: "info",
      title: `${taskbar.windows.length} active Windows task${taskbar.windows.length === 1 ? "" : "s"}`,
      detail: "JARVIS taskbar synchronization is operational",
      Icon: WindowAppsRegular,
      target: null,
    },
    {
      id: "power",
      kind: power.batteryPresent && (power.percentage ?? 100) < 20 ? "warning" : "ok",
      title: power.batteryPresent ? `Battery at ${Math.round(power.percentage ?? 0)}%` : "Power source stable",
      detail: power.batteryPresent
        ? (power.charging ? "Charging from AC power" : "Running on battery")
        : "No portable battery detected",
      Icon: power.batteryPresent ? Battery6Regular : PowerRegular,
      target: "ms-settings:powersleep",
    },
  ];

  return (
    <section className="shell-panel shell-notifications-panel" role="dialog" aria-modal="false" aria-label="JARVIS notifications">
      <PanelHeader eyebrow="SYSTEM EVENT STREAM" title="NOTIFICATIONS" onClose={onClose} />
      <div className="shell-notification-list">
        {notifications.map(({ id, kind, title, detail, Icon, target }) => {
          const Item = target ? "button" : "div";
          return (
            <Item
              key={id}
              {...(target
                ? { type: "button", onClick: () => onLaunch({ label: title, target }) }
                : { role: "status" })}
              className={`shell-notification-item is-${kind}`}
            >
              <span><Icon /></span>
              <span><strong>{title}</strong><small>{detail}</small></span>
              <time>NOW</time>
            </Item>
          );
        })}
      </div>
      <footer className="notification-footer"><CheckmarkCircleRegular /><span>STATUS FEED SYNCHRONIZED WITH WINDOWS</span></footer>
    </section>
  );
}

function RuntimeSettingsPanel({ onClose, onToast }) {
  const [runtime, setRuntime] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagnosticStatus, setDiagnosticStatus] = useState("idle");

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
    <section className="shell-panel runtime-settings-panel" role="dialog" aria-modal="false" aria-label="JARVIS settings">
      <PanelHeader eyebrow="CURRENT USER · NO ADMIN REQUIRED" title="JARVIS SETTINGS" onClose={onClose} />

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

      <WindowAppearanceSettings onToast={onToast} />

      <InterfacePreferences onToast={onToast} />

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

      {error ? <p className="runtime-settings-error" role="alert"><AlertRegular />{error}</p> : null}

      <footer className="runtime-settings-footer">
        <span>{runtime?.safeMode ? "SAFE MODE · NATIVE TASKBAR KEPT" : platform.isNative ? "NATIVE WINDOWS HOST" : "BROWSER PREVIEW"}</span>
        <strong>{startupEnabled ? "AUTO START ARMED" : startupNeedsRepair ? "STARTUP REPAIR REQUIRED" : "MANUAL START"}</strong>
      </footer>
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
  const selectedMode = pendingMode ?? appearance.mode;
  const busy = appearance.loading || pendingMode !== null;
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
