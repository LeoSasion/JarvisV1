import { useCallback, useState } from "react";
import { Taskbar } from "./components/Taskbar.jsx";
import { platform } from "./platform/index.js";
import { recordRecentApplication } from "./recent-applications.js";

export function TaskbarSurface() {
  const [activeApp, setActiveApp] = useState("builtin:explorer");

  const hideTaskbarFlyout = useCallback(async () => {
    try {
      await platform.taskbar.hideFlyout();
    } catch {
      // A stale flyout must not block normal taskbar actions.
    }
  }, []);

  const showTaskbarFlyout = useCallback(async (options) => {
    try {
      await platform.taskbar.showFlyout(options);
    } catch {
      // Window switching remains available through single-window task items.
    }
  }, []);

  const closeTaskbarWindow = useCallback(async (windowId) => {
    try {
      await platform.taskbar.closeWindow(windowId);
    } catch {
      // A window may close on its own before the native request arrives.
    }
  }, []);

  const showDesktopPanel = useCallback(async (panel = null) => {
    await hideTaskbarFlyout();
    try {
      await platform.lifecycle.showDesktop({ panel });
    } catch {
      // The taskbar remains usable for window switching if the desktop is unavailable.
    }
  }, [hideTaskbarFlyout]);

  const handleAppClick = useCallback(async (item, runningWindow = null, options = {}) => {
    const builtinId = item.pinnedApplication?.id;
    setActiveApp(item.id);
    await hideTaskbarFlyout();
    try {
      if (builtinId === "explorer") {
        await showDesktopPanel("explorer");
        return;
      }
      if (builtinId === "jarvis-settings") {
        await showDesktopPanel("settings");
        return;
      }
      if (builtinId === "terminal") {
        await showDesktopPanel("terminal");
        return;
      }
      if (runningWindow && !options.forceLaunch) {
        await platform.taskbar.toggleWindow(runningWindow.windowId);
        return;
      }
      if (item.kind === "installed" && item.application) {
        await platform.shell.openApplication(item.application.applicationId);
        recordRecentApplication(item.application.applicationId);
        return;
      }
      if (!item.pinnedApplication) return;
      await platform.shell.open(item.pinnedApplication.target);
    } catch {
      // A failed launch must not take down the persistent taskbar surface.
    }
  }, [hideTaskbarFlyout, showDesktopPanel]);

  return (
    <main className="jarvis-taskbar-surface" aria-label="JARVIS taskbar surface">
      <Taskbar
        activeApp={activeApp}
        onAppClick={handleAppClick}
        onOpenCommand={() => showDesktopPanel("command")}
        onOpenStart={() => showDesktopPanel("start")}
        onOpenQuickSettings={() => showDesktopPanel("quick-settings")}
        onOpenNotifications={() => showDesktopPanel("notifications")}
        onShowFlyout={showTaskbarFlyout}
        onHideFlyout={hideTaskbarFlyout}
        onCloseWindow={closeTaskbarWindow}
      />
    </main>
  );
}
