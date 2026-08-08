import { useCallback, useEffect, useRef, useState } from "react";
import { Taskbar } from "./components/Taskbar.jsx";
import { useAgentSession } from "./hooks/useAgentSession.js";
import { platform } from "./platform/index.js";
import { recordRecentApplication } from "./recent-applications.js";
import { publishShellFeedback } from "./shell-feedback-channel.js";
import { isHelpShortcut } from "./shell-shortcuts.js";
import {
  getVisibleInternalWindowIds,
  planInternalShowDesktopToggle,
} from "./show-desktop-model.js";
import {
  readWorkspaceRuntime,
  sendWorkspaceCommand,
  subscribeWorkspaceRuntime,
} from "./workspace-runtime-channel.js";

export function TaskbarSurface() {
  const [activeApp, setActiveApp] = useState("builtin:explorer");
  const [internalWindows, setInternalWindows] = useState(readWorkspaceRuntime);
  const agentSession = useAgentSession();
  const showDesktopRestoreIdsRef = useRef([]);
  const taskbarMode = new URLSearchParams(window.location.search).get("taskbarMode") ?? "full";

  useEffect(() => subscribeWorkspaceRuntime(setInternalWindows), []);

  const reportTaskbarFault = useCallback((title, error, severity = "error") => {
    const detail = error instanceof Error ? error.message : String(error ?? "Unexpected taskbar failure");
    const fault = { source: "taskbar", severity, title, detail, persistent: true };
    if (!publishShellFeedback(fault)) {
      void platform.feed.reportFault(fault).catch(() => {
        // Both renderer channels are unavailable; the originating taskbar remains interactive.
      });
    }
  }, []);

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
    } catch (error) {
      reportTaskbarFault("Unable to show window preview", error);
    }
  }, [reportTaskbarFault]);

  const showDesktopPanel = useCallback(async (panel = null) => {
    await hideTaskbarFlyout();
    try {
      await platform.lifecycle.showDesktop({ panel });
    } catch (error) {
      reportTaskbarFault("Unable to open the JARVIS desktop", error);
    }
  }, [hideTaskbarFlyout, reportTaskbarFault]);

  useEffect(() => {
    const handleShortcut = (event) => {
      if (!isHelpShortcut(event)) return;
      event.preventDefault();
      void showDesktopPanel("help");
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [showDesktopPanel]);

  const closeTaskbarWindow = useCallback(async (windowId) => {
    if (windowId.startsWith("jarvis:")) {
      const internalWindowId = windowId.slice("jarvis:".length);
      await showDesktopPanel();
      sendWorkspaceCommand(internalWindowId, "close");
      return;
    }
    try {
      await platform.taskbar.closeWindow(windowId);
    } catch (error) {
      reportTaskbarFault("Unable to close window", error);
    }
  }, [reportTaskbarFault, showDesktopPanel]);

  const toggleShowDesktop = useCallback(async () => {
    await hideTaskbarFlyout();
    const visibleInternalWindowIds = getVisibleInternalWindowIds(internalWindows);
    try {
      const result = await platform.taskbar.toggleDesktop({
        hasVisibleInternalWindow: visibleInternalWindowIds.length > 0,
      });
      const plan = planInternalShowDesktopToggle(
        internalWindows,
        showDesktopRestoreIdsRef.current,
        result,
      );
      plan.commands.forEach(({ id, action }) => {
        sendWorkspaceCommand(id, action);
      });
      showDesktopRestoreIdsRef.current = plan.nextRestoreIds;
    } catch (error) {
      reportTaskbarFault("Unable to toggle desktop", error);
    }
  }, [hideTaskbarFlyout, internalWindows, reportTaskbarFault]);

  const handleAppClick = useCallback(async (item, runningWindow = null, options = {}) => {
    const builtinId = item.pinnedApplication?.id;
    setActiveApp(item.id);
    try {
      if (runningWindow?.internalWindowId) {
        await showDesktopPanel();
        sendWorkspaceCommand(runningWindow.internalWindowId, "toggle");
        return;
      }
      if (builtinId === "explorer") {
        await showDesktopPanel("explorer");
        return;
      }
      if (builtinId === "jarvis-settings") {
        await showDesktopPanel("settings");
        return;
      }
      if (builtinId === "jarvis-help") {
        await showDesktopPanel("help");
        return;
      }
      if (builtinId === "terminal") {
        await showDesktopPanel("terminal");
        return;
      }
      await hideTaskbarFlyout();
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
    } catch (error) {
      reportTaskbarFault(`Unable to open ${item.label ?? "application"}`, error);
    }
  }, [hideTaskbarFlyout, reportTaskbarFault, showDesktopPanel]);

  const toggleAgent = useCallback(async () => {
    await showDesktopPanel();
    sendWorkspaceCommand("agent", "toggle");
  }, [showDesktopPanel]);

  return (
    <main
      className={[
        "jarvis-taskbar-surface",
        platform.isNative ? "is-native" : "",
        taskbarMode === "hybrid" ? "is-hybrid" : "",
      ].filter(Boolean).join(" ")}
      aria-label="JARVIS taskbar surface"
    >
      <Taskbar
        activeApp={activeApp}
        internalWindows={internalWindows}
        onAppClick={handleAppClick}
        onOpenCommand={() => showDesktopPanel("command")}
        onToggleAgent={toggleAgent}
        agentState={agentSession.state}
        onOpenStart={() => showDesktopPanel("start")}
        onOpenQuickSettings={() => showDesktopPanel("quick-settings")}
        onOpenDateTime={() => showDesktopPanel("date-time")}
        onOpenNotifications={() => showDesktopPanel("notifications")}
        onShowFlyout={showTaskbarFlyout}
        onHideFlyout={hideTaskbarFlyout}
        onCloseWindow={closeTaskbarWindow}
        onToggleShowDesktop={toggleShowDesktop}
      />
    </main>
  );
}
