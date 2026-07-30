import { WORKSPACE_WINDOW_IDS } from "./workspace-window-state.js";

const validInternalWindowIds = new Set(WORKSPACE_WINDOW_IDS);

function normalizeIds(values) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.filter((value) =>
    validInternalWindowIds.has(value))));
}

export function getVisibleInternalWindowIds(windows) {
  if (!Array.isArray(windows)) return [];
  return normalizeIds(windows
    .filter((window) => window && window.minimized !== true)
    .map((window) => window.internalWindowId));
}

export function planInternalShowDesktopToggle(
  windows,
  previousRestoreIds,
  hostResult,
) {
  const visibleIds = getVisibleInternalWindowIds(windows);
  const existingWindows = new Map(
    (Array.isArray(windows) ? windows : [])
      .filter((window) => typeof window?.internalWindowId === "string")
      .map((window) => [window.internalWindowId, window]),
  );
  const restorableIds = normalizeIds(previousRestoreIds).filter((id) =>
    existingWindows.get(id)?.minimized === true);
  const hostAction = hostResult?.action;
  const internalOnlyRestore =
    hostAction === "shown" &&
    Number(hostResult?.affectedWindowCount) === 0 &&
    hostResult?.restoreAvailable !== true &&
    visibleIds.length === 0 &&
    restorableIds.length > 0;

  if (hostAction === "restored" || internalOnlyRestore) {
    return {
      commands: restorableIds.map((id) => ({ id, action: "restore" })),
      nextRestoreIds: [],
    };
  }

  if (hostAction !== "shown") {
    return {
      commands: [],
      nextRestoreIds: restorableIds,
    };
  }

  return {
    commands: visibleIds.map((id) => ({ id, action: "minimize" })),
    nextRestoreIds: visibleIds,
  };
}
