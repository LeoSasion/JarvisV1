import { useCallback, useEffect, useState } from "react";
import { CommandOverlay } from "./components/CommandOverlay.jsx";
import { getGlobalQuickSearchAction } from "./global-quick-search-model.js";
import { platform } from "./platform/index.js";

async function executeAction(action) {
  switch (action.type) {
    case "activate-window":
      return platform.taskbar.activateWindow(action.windowId);
    case "open-application":
      return platform.shell.openApplication(action.applicationId);
    case "open-target":
      return platform.shell.open(action.target);
    case "show-desktop":
      return platform.lifecycle.showDesktop({ panel: action.panel });
    case "dismiss":
      return platform.surface.dismiss(action.restoreForeground);
    default:
      throw new Error("This local search result is not available.");
  }
}

export function GlobalQuickSearchSurface() {
  const [session, setSession] = useState(0);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  useEffect(() => {
    const beginSession = () => {
      setSession((current) => current + 1);
      setBusy(false);
      setStatusMessage(null);
    };
    const reportMockDismissal = (event) => {
      setStatusMessage(event.detail?.restoreForeground
        ? "PREVIEW · FOREGROUND RESTORE REQUESTED"
        : "PREVIEW · TARGET ACTIVATION REQUESTED");
    };

    window.addEventListener("jarvis:global-search-open", beginSession);
    window.addEventListener("jarvis:mock-surface-dismissed", reportMockDismissal);
    return () => {
      window.removeEventListener("jarvis:global-search-open", beginSession);
      window.removeEventListener("jarvis:mock-surface-dismissed", reportMockDismissal);
    };
  }, []);

  const dismiss = useCallback(async () => {
    if (busy) return;
    try {
      await platform.surface.dismiss(true);
    } catch (error) {
      setStatusMessage(`DISMISS FAILED · ${error.message}`);
    }
  }, [busy]);

  const execute = useCallback(async (result) => {
    if (busy) return;
    const action = getGlobalQuickSearchAction(result);
    if (!action) {
      setStatusMessage("RESULT IS NO LONGER AVAILABLE");
      return;
    }

    setBusy(true);
    setStatusMessage(`OPENING · ${result.label}`);
    try {
      await executeAction(action);
      if (action.type !== "dismiss") {
        await platform.surface.dismiss(false);
      }
    } catch (error) {
      setStatusMessage(`ACTION BLOCKED · ${error.message}`);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return (
    <main className="jarvis-global-search" aria-label="JARVIS global Quick Search">
      <div className="global-search-field" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <CommandOverlay
        key={session}
        open
        onClose={dismiss}
        onExecute={execute}
        busy={busy}
        statusMessage={statusMessage}
        surfaceLabel="SYSTEM-WIDE · CTRL ALT J"
      />
    </main>
  );
}
