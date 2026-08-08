import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getLatestAgentRelationMessage } from "./agent-context-model.js";
import { CommandOverlay } from "./components/CommandOverlay.jsx";
import { CoreStage } from "./components/CoreStage.jsx";
import { DesktopShortcuts } from "./components/DesktopShortcuts.jsx";
import { ManagedWorkspaceWindow } from "./components/ManagedWorkspaceWindow.jsx";
import { LinkedSystemRail } from "./components/LinkedSystemRail.jsx";
import { LinkedWorkspaceRoutes } from "./components/LinkedWorkspaceRoutes.jsx";
import { Taskbar } from "./components/Taskbar.jsx";
import { TelemetryRail } from "./components/TelemetryRail.jsx";
import { TopStatusBar } from "./components/TopStatusBar.jsx";
import { JarvisMark } from "./components/VectorMarks.jsx";
import { SystemNotice } from "./components/SystemNotice.jsx";
import {
  appendFeedbackEvent,
  createShellFeedback,
  selectFeedbackNotice,
} from "./feedback-model.js";
import { useAgentSession } from "./hooks/useAgentSession.js";
import { useWorkspaceManager } from "./hooks/useWorkspaceManager.js";
import { platform } from "./platform/index.js";
import { isQuickSearchToggleShortcut } from "./quick-search.js";
import { recordRecentApplication } from "./recent-applications.js";
import { subscribeShellFeedback } from "./shell-feedback-channel.js";
import {
  getVisibleInternalWindowIds,
  planInternalShowDesktopToggle,
} from "./show-desktop-model.js";
import { subscribeWorkspaceCommands } from "./workspace-runtime-channel.js";
import {
  getLinkedWorkspaceVariant,
  getWorkspaceLayoutMode,
  isDockedWindow,
} from "./workspace-layout-mode.js";

const FileExplorerWindow = lazy(() => import("./components/FileExplorerWindow.jsx")
  .then((module) => ({ default: module.FileExplorerWindow })));
const AgentConversationWindow = lazy(() => import("./components/AgentConversationWindow.jsx")
  .then((module) => ({ default: module.AgentConversationWindow })));
const ShellPanelLayer = lazy(() => import("./components/ShellPanels.jsx")
  .then((module) => ({ default: module.ShellPanelLayer })));
const TerminalWorkbench = lazy(() => import("./components/TerminalWorkbench.jsx")
  .then((module) => ({ default: module.TerminalWorkbench })));
const SystemInspector = lazy(() => import("./components/SystemInspector.jsx")
  .then((module) => ({ default: module.SystemInspector })));
const BootSequence = lazy(() => import("./components/BootSequence.jsx")
  .then((module) => ({ default: module.BootSequence })));

export function App() {
  const hasExternalTaskbar = new URLSearchParams(window.location.search).get("taskbar") === "external";
  const {
    state: workspaceState,
    taskbarWindows: internalTaskbarWindows,
    open: openWorkspaceWindow,
    close: closeWorkspaceWindow,
    activate: activateWorkspaceWindow,
    minimize: minimizeWorkspaceWindow,
    restore: restoreWorkspaceWindow,
    toggleMaximize: toggleMaximizeWorkspaceWindow,
    toggleFromTaskbar: toggleWorkspaceWindowFromTaskbar,
    commitBounds: commitWorkspaceWindowBounds,
    cycle: cycleWorkspaceWindows,
  } = useWorkspaceManager();
  const agentSession = useAgentSession();
  const [selectedShortcut, setSelectedShortcut] = useState(null);
  const [activeApp, setActiveApp] = useState("builtin:explorer");
  const [commandOpen, setCommandOpen] = useState(false);
  const [shellPanel, setShellPanel] = useState(null);
  const [explorerRequest, setExplorerRequest] = useState({ path: null, sequence: 0 });
  const [explorerSelection, setExplorerSelection] = useState([]);
  const [inspectorTarget, setInspectorTarget] = useState(null);
  const [bootActive, setBootActive] = useState(true);
  const [notice, setNotice] = useState(null);
  const [localFeedEvents, setLocalFeedEvents] = useState([]);
  const showDesktopRestoreIdsRef = useRef([]);
  const workspaceLayoutMode = getWorkspaceLayoutMode(workspaceState.windows);
  const linkedWorkspaceVariant = workspaceLayoutMode === "explorer-agent-linked"
    ? getLinkedWorkspaceVariant(workspaceState.viewport)
    : null;
  const linkedAgentMessage = useMemo(
    () => getLatestAgentRelationMessage(agentSession.messages, agentSession.context),
    [agentSession.context, agentSession.messages],
  );
  const handleToggleWorkspaceMaximize = useCallback((id) => {
    if (isDockedWindow(id, workspaceLayoutMode)) return;
    toggleMaximizeWorkspaceWindow(id);
  }, [toggleMaximizeWorkspaceWindow, workspaceLayoutMode]);

  const showToast = useCallback((input) => {
    const feedback = createShellFeedback(input);
    setNotice((current) => selectFeedbackNotice(current, feedback));
    if (feedback.severity === "warning" || feedback.severity === "error") {
      void platform.feed.reportFault({
        source: feedback.source,
        severity: feedback.severity,
        title: feedback.title,
        detail: feedback.detail,
        actionId: null,
      }).catch(() => {
        setLocalFeedEvents((current) => appendFeedbackEvent(current, feedback));
      });
    }
    return feedback;
  }, []);
  const showDesktopFeedback = useCallback((input) => showToast(
    typeof input === "string" ? { title: input, source: "desktop" } : { ...input, source: input?.source ?? "desktop" },
  ), [showToast]);
  const showExplorerFeedback = useCallback((input) => showToast(
    typeof input === "string" ? { title: input, source: "explorer" } : { ...input, source: input?.source ?? "explorer" },
  ), [showToast]);
  const showTerminalFeedback = useCallback((input) => showToast(
    typeof input === "string" ? { title: input, source: "terminal" } : { ...input, source: input?.source ?? "terminal" },
  ), [showToast]);
  const showSystemFeedback = useCallback((input) => showToast(
    typeof input === "string" ? { title: input, source: "system" } : { ...input, source: input?.source ?? "system" },
  ), [showToast]);
  const showSettingsFeedback = useCallback((input) => showToast(
    typeof input === "string" ? { title: input, source: "settings" } : { ...input, source: input?.source ?? "settings" },
  ), [showToast]);
  const finishBoot = useCallback(() => setBootActive(false), []);

  const openExplorer = useCallback((path = null) => {
    setCommandOpen(false);
    setShellPanel(null);
    setActiveApp("builtin:explorer");
    if (path) {
      setExplorerRequest((current) => ({
        path,
        sequence: current.sequence + 1,
      }));
    }
    openWorkspaceWindow("explorer");
  }, [openWorkspaceWindow]);

  const openTerminal = useCallback(() => {
    setCommandOpen(false);
    setShellPanel(null);
    setActiveApp("builtin:terminal");
    openWorkspaceWindow("terminal");
  }, [openWorkspaceWindow]);

  const hideTaskbarFlyout = useCallback(async () => {
    try {
      await platform.taskbar.hideFlyout();
    } catch {
      // A stale flyout must not block the desktop taskbar.
    }
  }, []);

  const showTaskbarFlyout = useCallback(async (options) => {
    try {
      await platform.taskbar.showFlyout(options);
    } catch (error) {
      showToast({
        severity: "error",
        source: "taskbar",
        title: "Unable to show window preview",
        detail: error.message,
        actions: [{ label: "RETRY", onInvoke: () => showTaskbarFlyout(options) }],
      });
    }
  }, [showToast]);

  const closeTaskbarWindow = useCallback(async (windowId) => {
    if (windowId.startsWith("jarvis:")) {
      const internalWindowId = windowId.slice("jarvis:".length);
      if (workspaceState.windows[internalWindowId]) {
        closeWorkspaceWindow(internalWindowId);
        showToast("JARVIS window closed");
      }
      return;
    }
    try {
      await platform.taskbar.closeWindow(windowId);
      showToast("Window close requested");
    } catch (error) {
      showToast({
        severity: "error",
        source: "taskbar",
        title: "Unable to close window",
        detail: error.message,
        actions: [{ label: "RETRY", onInvoke: () => closeTaskbarWindow(windowId) }],
      });
    }
  }, [closeWorkspaceWindow, showToast, workspaceState.windows]);

  const openCommand = useCallback(async () => {
    await hideTaskbarFlyout();
    setShellPanel(null);
    setCommandOpen(true);
  }, [hideTaskbarFlyout]);

  const openAgent = useCallback(async () => {
    await hideTaskbarFlyout();
    setCommandOpen(false);
    setShellPanel(null);
    setActiveApp("jarvis:launcher");
    openWorkspaceWindow("agent");
  }, [hideTaskbarFlyout, openWorkspaceWindow]);

  const toggleAgentFromTaskbar = useCallback(async () => {
    await hideTaskbarFlyout();
    setCommandOpen(false);
    setShellPanel(null);
    setActiveApp("jarvis:launcher");
    toggleWorkspaceWindowFromTaskbar("agent");
  }, [hideTaskbarFlyout, toggleWorkspaceWindowFromTaskbar]);

  const linkExplorerSelectionToAgent = useCallback(async (entries) => {
    const stagedItems = agentSession.addContextItems(entries);
    if (!stagedItems.length) {
      showToast("Select an Explorer item before linking the Agent");
      return;
    }
    await openAgent();
    showToast(`${stagedItems.length} Explorer reference${stagedItems.length === 1 ? "" : "s"} linked to the Agent`);
  }, [agentSession.addContextItems, openAgent, showToast]);

  const clearLinkedAgentContext = useCallback(() => {
    if (agentSession.clearContext()) showToast("Explorer reference unlinked from the Agent");
  }, [agentSession.clearContext, showToast]);

  const reuseLinkedAgentResult = useCallback(() => {
    agentSession.setDraft((current) => current.trim()
      ? current
      : "Refine the completed response into a concise, actionable next step.");
  }, [agentSession.setDraft]);

  useEffect(() => {
    if (!notice || notice.persistent || !notice.timeoutMs) return undefined;
    const noticeId = notice.id;
    const timer = window.setTimeout(() => {
      setNotice((current) => current?.id === noticeId ? null : current);
    }, notice.timeoutMs);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => subscribeShellFeedback((feedback) => {
    showToast(feedback);
  }), [showToast]);

  const dismissNotice = useCallback(() => {
    const noticeId = notice?.id;
    setNotice(null);
    if (noticeId) {
      setLocalFeedEvents((current) => current.filter((event) => event.id !== `local:${noticeId}`));
    }
  }, [notice?.id]);

  useEffect(() => {
    const handleShortcut = (event) => {
      if (isQuickSearchToggleShortcut(event)) {
        event.preventDefault();
        setCommandOpen((current) => !current);
        return;
      }
      const activeWindowId = workspaceState.activeId;
      if (event.ctrlKey && event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        cycleWorkspaceWindows(event.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (!activeWindowId || !event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "F4") {
        event.preventDefault();
        closeWorkspaceWindow(activeWindowId);
      } else if (event.key === "F9") {
        event.preventDefault();
        minimizeWorkspaceWindow(activeWindowId);
      } else if (event.key === "F10") {
        event.preventDefault();
        handleToggleWorkspaceMaximize(activeWindowId);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    closeWorkspaceWindow,
    cycleWorkspaceWindows,
    minimizeWorkspaceWindow,
    handleToggleWorkspaceMaximize,
    workspaceState.activeId,
  ]);

  useEffect(() => subscribeWorkspaceCommands(({ id, action }) => {
    if (action === "close") {
      closeWorkspaceWindow(id);
      return;
    }
    if (action === "minimize") {
      minimizeWorkspaceWindow(id);
      return;
    }
    if (action === "restore") {
      restoreWorkspaceWindow(id);
      return;
    }
    toggleWorkspaceWindowFromTaskbar(id);
  }), [
    closeWorkspaceWindow,
    minimizeWorkspaceWindow,
    restoreWorkspaceWindow,
    toggleWorkspaceWindowFromTaskbar,
  ]);

  useEffect(() => {
    const handleOpenPanel = (event) => {
      const panel = event.detail;
      if (panel === "command") {
        setShellPanel(null);
        setCommandOpen(true);
        return;
      }
      if (panel === "explorer") {
        openExplorer();
        return;
      }
      if (panel === "terminal") {
        openTerminal();
        return;
      }
      if (panel === "agent") {
        void openAgent();
        return;
      }
      if (["start", "quick-settings", "date-time", "notifications", "session", "settings"].includes(panel)) {
        setCommandOpen(false);
        setShellPanel(panel);
      }
    };
    const handleOpenCommand = () => handleOpenPanel({ detail: "command" });
    window.addEventListener("jarvis:open-shell-panel", handleOpenPanel);
    window.addEventListener("jarvis:open-command", handleOpenCommand);
    return () => {
      window.removeEventListener("jarvis:open-shell-panel", handleOpenPanel);
      window.removeEventListener("jarvis:open-command", handleOpenCommand);
    };
  }, [openAgent, openExplorer, openTerminal]);

  const openShortcut = useCallback(async (shortcut) => {
    const label = shortcut.label ?? shortcut.name;
    setActiveApp(label.toLowerCase().replaceAll(" ", "-"));
    if (shortcut.id === "terminal" && !shortcut.path) {
      openTerminal();
      showToast("ConPTY terminal ready");
      return;
    }
    if (shortcut.kind === "directory" && shortcut.path) {
      openExplorer(shortcut.path);
      showToast(`Browsing ${label}`);
      return;
    }
    try {
      await platform.shell.open(shortcut.target ?? shortcut.path ?? label);
      showToast(`Opening ${label} with Windows`);
    } catch (error) {
      showToast({
        severity: "error",
        source: "desktop",
        title: `Unable to open ${label}`,
        detail: error.message,
        actions: [{ label: "RETRY", onInvoke: () => openShortcut(shortcut) }],
      });
    }
  }, [openExplorer, openTerminal, showToast]);

  const openShortcutLocation = useCallback(async (shortcut) => {
    if (!shortcut.path) return;
    try {
      await platform.explorer.openInWindows(shortcut.path);
      showToast(`Located ${shortcut.label} in Windows File Explorer`);
    } catch (error) {
      showToast({
        severity: "error",
        source: "desktop",
        title: `Unable to locate ${shortcut.label}`,
        detail: error.message,
        actions: [{ label: "RETRY", onInvoke: () => openShortcutLocation(shortcut) }],
      });
    }
  }, [showToast]);

  const copyShortcutPath = useCallback(async (shortcut) => {
    if (!shortcut.path) return;
    try {
      await navigator.clipboard.writeText(shortcut.path);
      showToast("Path copied");
    } catch (error) {
      showToast({
        severity: "error",
        source: "desktop",
        title: "Unable to copy path",
        detail: error.message,
        actions: [{ label: "RETRY", onInvoke: () => copyShortcutPath(shortcut) }],
      });
    }
  }, [showToast]);

  const openDesktopSettings = useCallback(() => {
    setCommandOpen(false);
    setShellPanel("settings");
    showToast("JARVIS runtime settings ready");
  }, [showToast]);

  const inspect = useCallback((label) => {
    setInspectorTarget(label);
    setActiveApp("internal:inspector");
    openWorkspaceWindow("inspector");
  }, [openWorkspaceWindow]);

  const handleNotification = useCallback((notification) => {
    if (notification?.local) {
      setNotice(createShellFeedback({
        id: String(notification.id).replace(/^local:/u, ""),
        severity: notification.severity,
        source: notification.source,
        title: notification.title,
        detail: notification.detail,
        timestamp: notification.timestamp,
        persistent: true,
      }));
      return;
    }
    setCommandOpen(false);
    setShellPanel("notifications");
  }, []);

  const launchInstalledApplication = useCallback(async (application) => {
    setShellPanel(null);
    try {
      await platform.shell.openApplication(application.applicationId);
      recordRecentApplication(application.applicationId);
      showToast(platform.isNative
        ? `Opening ${application.label}`
        : `${application.label} launch requested`);
    } catch (error) {
      showToast({
        severity: "error",
        source: "shell",
        title: `Unable to open ${application.label}`,
        detail: error.message,
        actions: [{ label: "RETRY", onInvoke: () => launchInstalledApplication(application) }],
      });
    }
  }, [showToast]);

  const handleAppClick = useCallback(async (item, runningWindow = null, options = {}) => {
    const builtinId = item.pinnedApplication?.id;
    setActiveApp(item.id);
    await hideTaskbarFlyout();
    try {
      if (runningWindow?.internalWindowId) {
        toggleWorkspaceWindowFromTaskbar(runningWindow.internalWindowId);
        showToast(runningWindow.active && !runningWindow.minimized
          ? `Minimizing ${item.label}`
          : `Switching to ${item.label}`);
        return;
      }
      if (builtinId === "explorer") {
        openExplorer();
        showToast("JARVIS File Explorer ready");
        return;
      }
      if (builtinId === "jarvis-settings") {
        setCommandOpen(false);
        setShellPanel("settings");
        showToast("JARVIS runtime settings ready");
        return;
      }
      if (builtinId === "terminal") {
        openTerminal();
        showToast("ConPTY terminal ready");
        return;
      }
      if (runningWindow && !options.forceLaunch) {
        await platform.taskbar.toggleWindow(runningWindow.windowId);
        const appLabel = item.label ?? runningWindow.processName;
        showToast(runningWindow.active && !runningWindow.minimized
          ? `Minimizing ${appLabel}`
          : `Switching to ${appLabel}`);
        return;
      }
      if (item.kind === "installed" && item.application) {
        await launchInstalledApplication(item.application);
        return;
      }
      if (!item.pinnedApplication) return;
      await platform.shell.open(item.pinnedApplication.target);
      showToast(platform.isNative
        ? `Opening ${item.label} with Windows`
        : `${item.label} selected`);
    } catch (error) {
      const appLabel = item.label ?? runningWindow?.processName ?? item.id;
      showToast({
        severity: "error",
        source: "taskbar",
        title: `Unable to open ${appLabel}`,
        detail: error.message,
        actions: [{ label: "RETRY", onInvoke: () => handleAppClick(item, runningWindow, options) }],
      });
    }
  }, [
    hideTaskbarFlyout,
    launchInstalledApplication,
    openExplorer,
    openTerminal,
    showToast,
    toggleWorkspaceWindowFromTaskbar,
  ]);

  const toggleShowDesktop = useCallback(async () => {
    await hideTaskbarFlyout();
    const visibleInternalWindowIds = getVisibleInternalWindowIds(internalTaskbarWindows);
    try {
      const result = await platform.taskbar.toggleDesktop({
        hasVisibleInternalWindow: visibleInternalWindowIds.length > 0,
      });
      const plan = planInternalShowDesktopToggle(
        internalTaskbarWindows,
        showDesktopRestoreIdsRef.current,
        result,
      );
      plan.commands.forEach(({ id, action }) => {
        if (action === "minimize") {
          minimizeWorkspaceWindow(id);
        } else {
          restoreWorkspaceWindow(id);
        }
      });
      showDesktopRestoreIdsRef.current = plan.nextRestoreIds;
      if (result.action === "shown") {
        setCommandOpen(false);
        setShellPanel(null);
        showToast("Desktop shown");
      } else if (result.action === "restored") {
        showToast("Previous windows restored");
      } else {
        showToast({
          severity: "warning",
          source: "taskbar",
          title: "Some windows could not be restored",
          detail: "Open Session Control to review the active shell state.",
          actions: [{ label: "SESSION CONTROL", onInvoke: () => setShellPanel("session") }],
        });
      }
    } catch (error) {
      showToast({
        severity: "error",
        source: "taskbar",
        title: "Unable to toggle desktop",
        detail: error.message,
        actions: [{ label: "SESSION CONTROL", onInvoke: () => setShellPanel("session") }],
      });
    }
  }, [
    hideTaskbarFlyout,
    internalTaskbarWindows,
    minimizeWorkspaceWindow,
    restoreWorkspaceWindow,
    showToast,
  ]);

  const openShellPanel = useCallback(async (panel) => {
    await hideTaskbarFlyout();
    setCommandOpen(false);
    setShellPanel((current) => current === panel ? null : panel);
  }, [hideTaskbarFlyout]);
  const openSessionPanel = useCallback(() => {
    void openShellPanel("session");
  }, [openShellPanel]);
  const navigateShellPanel = useCallback((panel) => {
    setCommandOpen(false);
    setShellPanel(panel);
  }, []);

  const launchShellApp = useCallback(async ({ label, target }) => {
    if (target.toLowerCase() === "jarvis-settings:") {
      setShellPanel("settings");
      showToast("JARVIS runtime settings ready");
      return;
    }
    if (target.toLowerCase() === "jarvis-terminal:") {
      openTerminal();
      showToast("ConPTY terminal ready");
      return;
    }
    setShellPanel(null);
    if (target.toLowerCase() === "explorer.exe") {
      openExplorer();
      showToast("JARVIS File Explorer ready");
      return;
    }
    try {
      await platform.shell.open(target);
      showToast(platform.isNative ? `Opening ${label} with Windows` : `${label} launch requested`);
    } catch (error) {
      showToast({
        severity: "error",
        source: "shell",
        title: `Unable to open ${label}`,
        detail: error.message,
        actions: [{ label: "RETRY", onInvoke: () => launchShellApp({ label, target }) }],
      });
    }
  }, [openExplorer, openTerminal, showToast]);

  const activateShellWindow = useCallback(async (window) => {
    setShellPanel(null);
    try {
      await platform.taskbar.toggleWindow(window.windowId);
      showToast(`Switching to ${window.title || window.processName}`);
    } catch (error) {
      showToast({
        severity: "error",
        source: "taskbar",
        title: "Unable to switch window",
        detail: error.message,
        actions: [{ label: "RETRY", onInvoke: () => activateShellWindow(window) }],
      });
    }
  }, [showToast]);

  const exitToWindows = useCallback(async () => {
    if (!platform.isNative) {
      showToast("Power controls are protected");
      return;
    }
    try {
      await platform.lifecycle.exitToWindows();
    } catch (error) {
      showToast({
        severity: "error",
        source: "runtime",
        title: "Unable to exit JARVIS",
        detail: error.message,
        actions: [{ label: "SESSION CONTROL", onInvoke: () => setShellPanel("session") }],
      });
    }
  }, [showToast]);

  const executeQuickSearch = useCallback((result) => {
    setCommandOpen(false);
    if (result.kind === "window") {
      if (result.window.active && !result.window.minimized) {
        showToast(`${result.window.title || result.window.processName} is already active`);
        return;
      }
      void activateShellWindow(result.window);
      return;
    }
    if (result.kind === "desktop") {
      void openShortcut(result.entry);
      return;
    }
    if (result.kind === "installed-app") {
      void launchInstalledApplication(result.application);
      return;
    }
    if (result.kind === "app" || result.kind === "setting") {
      void launchShellApp({ label: result.label, target: result.target });
      return;
    }
    showToast("This local search result is not available");
  }, [
    activateShellWindow,
    launchInstalledApplication,
    launchShellApp,
    openShortcut,
    showToast,
  ]);

  const hasVisibleWorkspaceWindow = Object.values(workspaceState.windows)
    .some((windowState) => windowState.open && !windowState.minimized);
  const workspaceAvailableWidth = Math.max(
    1,
    workspaceState.viewport.width - workspaceState.viewport.left - workspaceState.viewport.right,
  );

  return (
    <main className={[
      "jarvis-shell",
      "is-mic-muted",
      hasExternalTaskbar ? "has-external-taskbar" : "",
      hasVisibleWorkspaceWindow ? "has-open-window" : "",
      `is-layout-${workspaceLayoutMode}`,
      linkedWorkspaceVariant ? `is-linked-${linkedWorkspaceVariant}` : "",
    ].filter(Boolean).join(" ")}
    style={{
      "--workspace-top-inset": `${workspaceState.viewport.top}px`,
      "--workspace-right-inset": `${workspaceState.viewport.right}px`,
      "--workspace-bottom-inset": `${workspaceState.viewport.bottom}px`,
      "--workspace-left-inset": `${workspaceState.viewport.left}px`,
      "--workspace-available-width": `${workspaceAvailableWidth}px`,
    }}>
      <div className="ambient-field" aria-hidden="true" />
      <TopStatusBar
        onOpenCommand={openCommand}
        onAbortAgent={agentSession.abort}
        agentState={agentSession.state}
        onPower={openSessionPanel}
      />

      <section className="desktop-workspace" aria-label="JARVIS desktop workspace">
        <DesktopShortcuts
          selectedId={selectedShortcut}
          onSelect={setSelectedShortcut}
          onOpen={openShortcut}
          onOpenLocation={openShortcutLocation}
          onCopyPath={copyShortcutPath}
          onOpenSettings={openDesktopSettings}
          onNotify={showDesktopFeedback}
        />
        <CoreStage />
        <TelemetryRail
          localEvents={localFeedEvents}
          onInspect={inspect}
          onNotification={handleNotification}
        />
      </section>

      {bootActive ? (
        <Suspense fallback={null}>
          <BootSequence onComplete={finishBoot} />
        </Suspense>
      ) : null}

      {workspaceState.windows.agent.open ? (
        <ManagedWorkspaceWindow
          id="agent"
          windowState={workspaceState.windows.agent}
          viewport={workspaceState.viewport}
          active={workspaceState.activeId === "agent"}
          layoutMode={workspaceLayoutMode}
          onActivate={activateWorkspaceWindow}
          onCommitBounds={commitWorkspaceWindowBounds}
          onToggleMaximize={handleToggleWorkspaceMaximize}
        >
          <Suspense fallback={null}>
            <AgentConversationWindow
              open
              active={workspaceState.activeId === "agent" && !workspaceState.windows.agent.minimized}
              maximized={workspaceState.windows.agent.maximized && !isDockedWindow("agent", workspaceLayoutMode)}
              canMaximize={!isDockedWindow("agent", workspaceLayoutMode)}
              state={agentSession.state}
              messages={agentSession.messages}
              historyError={agentSession.historyError}
              sessionTransitioning={agentSession.sessionTransitioning}
              draft={agentSession.draft}
              linkedContext={agentSession.context}
              linkedFlowPhase={agentSession.context.phase}
              explorerSelection={explorerSelection}
              onDraftChange={agentSession.setDraft}
              onSend={agentSession.send}
              onAbort={agentSession.abort}
              onNewSession={agentSession.newSession}
              onLinkExplorerSelection={linkExplorerSelectionToAgent}
              onClearLinkedContext={clearLinkedAgentContext}
              onReuseLinkedResult={reuseLinkedAgentResult}
              onMinimize={() => minimizeWorkspaceWindow("agent")}
              onToggleMaximize={() => handleToggleWorkspaceMaximize("agent")}
              onClose={() => closeWorkspaceWindow("agent")}
            />
          </Suspense>
        </ManagedWorkspaceWindow>
      ) : null}

      {workspaceState.windows.explorer.open ? (
        <ManagedWorkspaceWindow
          id="explorer"
          windowState={workspaceState.windows.explorer}
          viewport={workspaceState.viewport}
          active={workspaceState.activeId === "explorer"}
          layoutMode={workspaceLayoutMode}
          onActivate={activateWorkspaceWindow}
          onCommitBounds={commitWorkspaceWindowBounds}
          onToggleMaximize={handleToggleWorkspaceMaximize}
        >
          <Suspense fallback={null}>
            <FileExplorerWindow
              open
              active={workspaceState.activeId === "explorer" && !workspaceState.windows.explorer.minimized}
              initialPath={explorerRequest.path}
              requestSequence={explorerRequest.sequence}
              maximized={workspaceState.windows.explorer.maximized && !isDockedWindow("explorer", workspaceLayoutMode)}
              canMaximize={!isDockedWindow("explorer", workspaceLayoutMode)}
              linkedContext={agentSession.context}
              linkedFlowPhase={agentSession.context.phase}
              onSelectionChange={setExplorerSelection}
              onAddToAgentContext={linkExplorerSelectionToAgent}
              onMinimize={() => minimizeWorkspaceWindow("explorer")}
              onToggleMaximize={() => handleToggleWorkspaceMaximize("explorer")}
              onClose={() => closeWorkspaceWindow("explorer")}
              onToast={showExplorerFeedback}
            />
          </Suspense>
        </ManagedWorkspaceWindow>
      ) : null}

      {workspaceState.windows.terminal.open ? (
        <ManagedWorkspaceWindow
          id="terminal"
          windowState={workspaceState.windows.terminal}
          viewport={workspaceState.viewport}
          active={workspaceState.activeId === "terminal"}
          layoutMode={workspaceLayoutMode}
          onActivate={activateWorkspaceWindow}
          onCommitBounds={commitWorkspaceWindowBounds}
          onToggleMaximize={handleToggleWorkspaceMaximize}
        >
          <Suspense fallback={null}>
            <TerminalWorkbench
              open
              active={workspaceState.activeId === "terminal" && !workspaceState.windows.terminal.minimized}
              visible={!workspaceState.windows.terminal.minimized}
              maximized={workspaceState.windows.terminal.maximized}
              onMinimize={() => minimizeWorkspaceWindow("terminal")}
              onToggleMaximize={() => toggleMaximizeWorkspaceWindow("terminal")}
              onClose={() => closeWorkspaceWindow("terminal")}
              onToast={showTerminalFeedback}
            />
          </Suspense>
        </ManagedWorkspaceWindow>
      ) : null}

      {workspaceState.windows.inspector.open ? (
        <ManagedWorkspaceWindow
          id="inspector"
          windowState={workspaceState.windows.inspector}
          viewport={workspaceState.viewport}
          active={workspaceState.activeId === "inspector"}
          layoutMode={workspaceLayoutMode}
          onActivate={activateWorkspaceWindow}
          onCommitBounds={commitWorkspaceWindowBounds}
          onToggleMaximize={handleToggleWorkspaceMaximize}
        >
          <Suspense fallback={null}>
            <SystemInspector
              open
              active={workspaceState.activeId === "inspector" && !workspaceState.windows.inspector.minimized}
              target={inspectorTarget}
              maximized={workspaceState.windows.inspector.maximized}
              onMinimize={() => minimizeWorkspaceWindow("inspector")}
              onToggleMaximize={() => toggleMaximizeWorkspaceWindow("inspector")}
              onClose={() => closeWorkspaceWindow("inspector")}
              onToast={showSystemFeedback}
            />
          </Suspense>
        </ManagedWorkspaceWindow>
      ) : null}

      {workspaceLayoutMode === "explorer-agent-linked" ? (
        <>
          <LinkedWorkspaceRoutes
            phase={agentSession.context.phase}
            relationId={agentSession.context.relationId}
            targetKey={linkedAgentMessage?.id ?? null}
            layoutVariant={linkedWorkspaceVariant}
          />
          <LinkedSystemRail
            agentState={agentSession.state}
            onInspect={inspect}
            onNotification={handleNotification}
          />
        </>
      ) : null}

      {!hasExternalTaskbar && (
        <Taskbar
          activeApp={activeApp}
          internalWindows={internalTaskbarWindows}
          onAppClick={handleAppClick}
          onOpenCommand={openCommand}
          onToggleAgent={toggleAgentFromTaskbar}
          agentState={agentSession.state}
          onOpenStart={() => openShellPanel("start")}
          onOpenQuickSettings={() => openShellPanel("quick-settings")}
          onOpenDateTime={() => openShellPanel("date-time")}
          onOpenNotifications={() => openShellPanel("notifications")}
          onShowFlyout={showTaskbarFlyout}
          onHideFlyout={hideTaskbarFlyout}
          onCloseWindow={closeTaskbarWindow}
          onToggleShowDesktop={toggleShowDesktop}
        />
      )}

      {shellPanel ? (
        <Suspense fallback={null}>
          <ShellPanelLayer
            panel={shellPanel}
            onClose={() => setShellPanel(null)}
            onOpenCommand={openCommand}
            onLaunch={launchShellApp}
            onLaunchInstalled={launchInstalledApplication}
            onActivateWindow={activateShellWindow}
            onOpenPanel={navigateShellPanel}
            onExit={exitToWindows}
            onToast={showSettingsFeedback}
          />
        </Suspense>
      ) : null}

      {commandOpen ? (
        <CommandOverlay
          open
          onClose={() => setCommandOpen(false)}
          onExecute={executeQuickSearch}
        />
      ) : null}

      <SystemNotice notice={notice} onDismiss={dismissNotice} />

      <div className="desktop-only-notice" role="status">
        <JarvisMark />
        <strong>JARVIS LOCAL VISUAL FRAME</strong>
        <span>Desktop viewport required</span>
      </div>
    </main>
  );
}
