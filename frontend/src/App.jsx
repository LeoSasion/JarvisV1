import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { CommandOverlay } from "./components/CommandOverlay.jsx";
import { CoreStage } from "./components/CoreStage.jsx";
import { DesktopShortcuts } from "./components/DesktopShortcuts.jsx";
import { Taskbar } from "./components/Taskbar.jsx";
import { TelemetryRail } from "./components/TelemetryRail.jsx";
import { TopStatusBar } from "./components/TopStatusBar.jsx";
import { platform } from "./platform/index.js";
import { recordRecentApplication } from "./recent-applications.js";

const FileExplorerWindow = lazy(() => import("./components/FileExplorerWindow.jsx")
  .then((module) => ({ default: module.FileExplorerWindow })));
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
  const [micActive, setMicActive] = useState(true);
  const [selectedShortcut, setSelectedShortcut] = useState(null);
  const [activeApp, setActiveApp] = useState("builtin:explorer");
  const [commandOpen, setCommandOpen] = useState(false);
  const [shellPanel, setShellPanel] = useState(null);
  const [explorerSession, setExplorerSession] = useState({ open: false, path: null, sequence: 0 });
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [inspectorTarget, setInspectorTarget] = useState(null);
  const [bootActive, setBootActive] = useState(true);
  const [toast, setToast] = useState("");

  const showToast = useCallback((message) => setToast(message), []);
  const finishBoot = useCallback(() => setBootActive(false), []);

  const openExplorer = useCallback((path = null) => {
    setCommandOpen(false);
    setShellPanel(null);
    setActiveApp("explorer");
    setExplorerSession((current) => ({
      open: true,
      path,
      sequence: current.sequence + 1,
    }));
  }, []);

  const openTerminal = useCallback(() => {
    setCommandOpen(false);
    setShellPanel(null);
    setTerminalOpen(true);
    setActiveApp("builtin:terminal");
  }, []);

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
      showToast(`Unable to show window preview: ${error.message}`);
    }
  }, [showToast]);

  const closeTaskbarWindow = useCallback(async (windowId) => {
    try {
      await platform.taskbar.closeWindow(windowId);
      showToast("Window close requested");
    } catch (error) {
      showToast(`Unable to close window: ${error.message}`);
    }
  }, [showToast]);

  const openCommand = useCallback(async () => {
    await hideTaskbarFlyout();
    setShellPanel(null);
    setCommandOpen(true);
  }, [hideTaskbarFlyout]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.code === "Space") {
        event.preventDefault();
        setCommandOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

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
      if (["start", "quick-settings", "notifications", "settings"].includes(panel)) {
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
  }, [openExplorer, openTerminal]);

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
      showToast(`Unable to open ${label}: ${error.message}`);
    }
  }, [openExplorer, openTerminal, showToast]);

  const inspect = useCallback((label) => {
    setInspectorTarget(label);
  }, []);

  const handleNotification = useCallback((notification) => {
    showToast(`${notification.title}: ${notification.detail}`);
  }, [showToast]);

  const launchInstalledApplication = useCallback(async (application) => {
    setShellPanel(null);
    try {
      await platform.shell.openApplication(application.applicationId);
      recordRecentApplication(application.applicationId);
      showToast(platform.isNative
        ? `Opening ${application.label}`
        : `${application.label} launch requested`);
    } catch (error) {
      showToast(`Unable to open ${application.label}: ${error.message}`);
    }
  }, [showToast]);

  const handleAppClick = useCallback(async (item, runningWindow = null, options = {}) => {
    const builtinId = item.pinnedApplication?.id;
    setActiveApp(item.id);
    await hideTaskbarFlyout();
    try {
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
      showToast(`Unable to open ${appLabel}: ${error.message}`);
    }
  }, [hideTaskbarFlyout, launchInstalledApplication, openExplorer, openTerminal, showToast]);

  const openShellPanel = useCallback(async (panel) => {
    await hideTaskbarFlyout();
    setCommandOpen(false);
    setShellPanel((current) => current === panel ? null : panel);
  }, [hideTaskbarFlyout]);

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
      showToast(`Unable to open ${label}: ${error.message}`);
    }
  }, [openExplorer, openTerminal, showToast]);

  const activateShellWindow = useCallback(async (window) => {
    setShellPanel(null);
    try {
      await platform.taskbar.toggleWindow(window.windowId);
      showToast(`Switching to ${window.title || window.processName}`);
    } catch (error) {
      showToast(`Unable to switch window: ${error.message}`);
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
      showToast(`Unable to exit JARVIS: ${error.message}`);
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

  return (
    <main className={`jarvis-shell ${micActive ? "is-mic-active" : "is-mic-muted"} ${hasExternalTaskbar ? "has-external-taskbar" : ""}`}>
      <div className="ambient-field" aria-hidden="true" />
      <TopStatusBar
        micActive={micActive}
        onToggleMic={() => setMicActive((current) => !current)}
        onOpenCommand={openCommand}
        onPower={exitToWindows}
      />

      <section className="desktop-workspace" aria-label="JARVIS desktop workspace">
        <DesktopShortcuts
          selectedId={selectedShortcut}
          onSelect={setSelectedShortcut}
          onOpen={openShortcut}
        />
        <CoreStage listening={micActive} onActivate={openCommand} />
        <TelemetryRail
          micActive={micActive}
          onInspect={inspect}
          onNotification={handleNotification}
        />
      </section>

      {bootActive ? (
        <Suspense fallback={null}>
          <BootSequence onComplete={finishBoot} />
        </Suspense>
      ) : null}

      {explorerSession.open ? (
        <Suspense fallback={null}>
          <FileExplorerWindow
            key={explorerSession.sequence}
            open
            initialPath={explorerSession.path}
            onClose={() => setExplorerSession((current) => ({ ...current, open: false }))}
            onToast={showToast}
          />
        </Suspense>
      ) : null}

      {terminalOpen ? (
        <Suspense fallback={null}>
          <TerminalWorkbench
            open
            onClose={() => setTerminalOpen(false)}
            onToast={showToast}
          />
        </Suspense>
      ) : null}

      {inspectorTarget ? (
        <Suspense fallback={null}>
          <SystemInspector
            open
            target={inspectorTarget}
            onClose={() => setInspectorTarget(null)}
            onToast={showToast}
          />
        </Suspense>
      ) : null}

      {!hasExternalTaskbar && (
        <Taskbar
          activeApp={activeApp}
          onAppClick={handleAppClick}
          onOpenCommand={openCommand}
          onOpenStart={() => openShellPanel("start")}
          onOpenQuickSettings={() => openShellPanel("quick-settings")}
          onOpenNotifications={() => openShellPanel("notifications")}
          onShowFlyout={showTaskbarFlyout}
          onHideFlyout={hideTaskbarFlyout}
          onCloseWindow={closeTaskbarWindow}
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
            onExit={exitToWindows}
            onToast={showToast}
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

      <div className={`system-toast ${toast ? "is-visible" : ""}`} role="status" aria-live="polite">
        <img src="/assets/jarvis-top-agent-ready-core-v1.png" alt="" />
        <span>{toast}</span>
      </div>

      <div className="desktop-only-notice" role="status">
        <img src="/assets/jarvis-top-brand-core-v1.png" alt="" />
        <strong>JARVIS NIGHT SHELL</strong>
        <span>Desktop viewport required</span>
      </div>
    </main>
  );
}
