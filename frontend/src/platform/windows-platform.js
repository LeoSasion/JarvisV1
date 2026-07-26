const DEFAULT_TIMEOUT_MS = 10_000;

function parseMessage(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toBridgeError(error, method) {
  const message = typeof error === "string"
    ? error
    : error?.message ?? `Windows bridge request failed: ${method}`;
  const bridgeError = new Error(message);
  bridgeError.name = "JarvisBridgeError";
  bridgeError.code = error?.code;
  bridgeError.method = method;
  return bridgeError;
}

function normalizeOpenParams(value) {
  return typeof value === "string" ? { target: value } : value;
}

export function createWindowsPlatform(webview) {
  let requestSequence = 0;
  const pendingRequests = new Map();
  const eventListeners = new Map();

  const handleMessage = (event) => {
    const message = parseMessage(event.data);
    if (!message || typeof message !== "object") return;

    if (message.id && pendingRequests.has(message.id)) {
      const pending = pendingRequests.get(message.id);
      pendingRequests.delete(message.id);
      window.clearTimeout(pending.timeout);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(toBridgeError(message.error, pending.method));
      return;
    }

    if (typeof message.event === "string") {
      eventListeners.get(message.event)?.forEach((listener) => listener(message.data));
    }
  };

  webview.addEventListener("message", handleMessage);

  const request = (method, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => new Promise((resolve, reject) => {
    const id = `jarvis-${Date.now()}-${++requestSequence}`;
    const timeout = window.setTimeout(() => {
      pendingRequests.delete(id);
      reject(toBridgeError({ code: "TIMEOUT", message: `${method} timed out` }, method));
    }, timeoutMs);

    pendingRequests.set(id, { method, resolve, reject, timeout });
    try {
      webview.postMessage({ id, method, params });
    } catch (error) {
      window.clearTimeout(timeout);
      pendingRequests.delete(id);
      reject(toBridgeError(error, method));
    }
  });

  const subscribe = (eventName, listener) => {
    let listeners = eventListeners.get(eventName);
    if (!listeners) {
      listeners = new Set();
      eventListeners.set(eventName, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) eventListeners.delete(eventName);
    };
  };

  return {
    kind: "windows",
    isNative: true,
    events: { subscribe },
    system: {
      getSnapshot: () => request("system.getSnapshot"),
      getDetails: () => request("system.getDetails", {}, 30_000),
    },
    desktop: {
      listEntries: () => request("desktop.listEntries"),
    },
    explorer: {
      browse: (path = null) => request("explorer.browse", { path }),
      openFile: (path) => request("explorer.openFile", { path }),
      openInWindows: (path) => request("explorer.openInWindows", { path }),
      createFolder: (path, name) => request("explorer.createFolder", { path, name }),
      rename: (path, name) => request("explorer.rename", { path, name }),
      transfer: (paths, destinationPath, mode) => request(
        "explorer.transfer",
        { paths, destinationPath, mode },
        60_000,
      ),
      recycle: (paths) => request("explorer.recycle", { paths }, 60_000),
    },
    terminal: {
      listProfiles: () => request("terminal.listProfiles"),
      create: (profileId, columns, rows) => request(
        "terminal.create",
        { profileId, columns, rows },
        20_000,
      ),
      write: (sessionId, data) => request("terminal.write", { sessionId, data }),
      resize: (sessionId, columns, rows) => request(
        "terminal.resize",
        { sessionId, columns, rows },
      ),
      close: (sessionId) => request("terminal.close", { sessionId }),
    },
    taskbar: {
      getSnapshot: () => request("taskbar.getSnapshot"),
      toggleWindow: (windowId) => request("taskbar.toggleWindow", { windowId }),
      closeWindow: (windowId) => request("taskbar.closeWindow", { windowId }),
      showFlyout: (options) => request("taskbar.showFlyout", options),
      hideFlyout: () => request("taskbar.hideFlyout"),
    },
    taskbarMode: {
      getState: () => request("taskbarMode.getState"),
      setMode: (mode) => request("taskbarMode.setMode", { mode }),
    },
    tray: {
      getSnapshot: () => request("tray.getSnapshot"),
      setVolume: (volumePercent) => request("tray.setVolume", { volumePercent }),
      setMuted: (muted) => request("tray.setMuted", { muted }),
    },
    feed: {
      getSnapshot: () => request("feed.getSnapshot"),
      markAllRead: () => request("feed.markAllRead"),
      clear: () => request("feed.clear"),
    },
    windowAppearance: {
      getState: () => request("windowAppearance.getState"),
      setMode: (mode) => request("windowAppearance.setMode", { mode }),
    },
    shell: {
      listApplications: () => request("shell.listApplications"),
      openApplication: (applicationId) => request("shell.openApplication", { applicationId }),
      open: (value) => request("shell.open", normalizeOpenParams(value)),
    },
    lifecycle: {
      getRuntimeInfo: () => request("lifecycle.getRuntimeInfo"),
      setStartupEnabled: (enabled) => request("lifecycle.setStartupEnabled", { enabled }),
      runDiagnostics: () => request("lifecycle.runDiagnostics", {}, 120_000),
      exitToWindows: () => request("lifecycle.exitToWindows"),
      showDesktop: (options = {}) => request("lifecycle.showDesktop", options),
    },
  };
}
