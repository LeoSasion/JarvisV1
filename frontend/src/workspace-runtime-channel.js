import {
  WORKSPACE_WINDOW_DEFINITIONS,
  WORKSPACE_WINDOW_IDS,
} from "./workspace-window-state.js";

export const WORKSPACE_RUNTIME_STORAGE_KEY = "jarvis.workspace.runtime.v1";
export const WORKSPACE_COMMAND_STORAGE_KEY = "jarvis.workspace.command.v1";

const RUNTIME_VERSION = 1;
const validWindowIds = new Set(WORKSPACE_WINDOW_IDS);
const validActions = new Set(["toggle", "close", "minimize", "restore"]);
const localRuntimeEvent = "jarvis:workspace-runtime";
const localCommandEvent = "jarvis:workspace-command";

function safeParse(value) {
  try {
    return JSON.parse(value ?? "null");
  } catch {
    return null;
  }
}

export function normalizeWorkspaceRuntime(value) {
  if (!value || value.version !== RUNTIME_VERSION || !Array.isArray(value.windows)) return [];
  const seen = new Set();
  return value.windows.flatMap((windowState) => {
    const id = windowState?.internalWindowId;
    if (!validWindowIds.has(id) || seen.has(id)) return [];
    seen.add(id);
    const definition = WORKSPACE_WINDOW_DEFINITIONS[id];
    return [{
      windowId: `jarvis:${id}`,
      internalWindowId: id,
      taskbarItemId: definition.taskbarItemId,
      title: definition.label,
      processName: definition.processName,
      active: windowState.active === true,
      minimized: windowState.minimized === true,
      canClose: true,
    }];
  });
}

export function readWorkspaceRuntime() {
  try {
    return normalizeWorkspaceRuntime(safeParse(
      window.localStorage.getItem(WORKSPACE_RUNTIME_STORAGE_KEY),
    ));
  } catch {
    return [];
  }
}

export function publishWorkspaceRuntime(windows) {
  const payload = {
    version: RUNTIME_VERSION,
    updatedAt: Date.now(),
    windows: normalizeWorkspaceRuntime({
      version: RUNTIME_VERSION,
      windows,
    }),
  };
  try {
    window.localStorage.setItem(WORKSPACE_RUNTIME_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // The desktop remains usable when shared storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(localRuntimeEvent, { detail: payload }));
}

export function subscribeWorkspaceRuntime(listener) {
  const handleStorage = (event) => {
    if (event.key !== WORKSPACE_RUNTIME_STORAGE_KEY) return;
    listener(normalizeWorkspaceRuntime(safeParse(event.newValue)));
  };
  const handleLocal = (event) => {
    listener(normalizeWorkspaceRuntime(event.detail));
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(localRuntimeEvent, handleLocal);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(localRuntimeEvent, handleLocal);
  };
}

export function sendWorkspaceCommand(id, action) {
  if (!validWindowIds.has(id) || !validActions.has(action)) return false;
  const payload = {
    version: RUNTIME_VERSION,
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    id,
    action,
  };
  try {
    window.localStorage.setItem(WORKSPACE_COMMAND_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent(localCommandEvent, { detail: payload }));
  return true;
}

function normalizeWorkspaceCommand(value) {
  if (
    !value ||
    value.version !== RUNTIME_VERSION ||
    typeof value.nonce !== "string" ||
    !validWindowIds.has(value.id) ||
    !validActions.has(value.action)
  ) {
    return null;
  }
  return {
    nonce: value.nonce.slice(0, 96),
    id: value.id,
    action: value.action,
  };
}

export function subscribeWorkspaceCommands(listener) {
  let lastNonce = null;
  const deliver = (value) => {
    const command = normalizeWorkspaceCommand(value);
    if (!command || command.nonce === lastNonce) return;
    lastNonce = command.nonce;
    listener(command);
  };
  const handleStorage = (event) => {
    if (event.key === WORKSPACE_COMMAND_STORAGE_KEY) deliver(safeParse(event.newValue));
  };
  const handleLocal = (event) => deliver(event.detail);
  window.addEventListener("storage", handleStorage);
  window.addEventListener(localCommandEvent, handleLocal);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(localCommandEvent, handleLocal);
  };
}
