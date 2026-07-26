export const WORKSPACE_LAYOUT_VERSION = 1;
export const WORKSPACE_LAYOUT_STORAGE_KEY = "jarvis.workspace.windows.v1";

export const WORKSPACE_WINDOW_DEFINITIONS = Object.freeze({
  explorer: Object.freeze({
    id: "explorer",
    label: "JARVIS File Explorer",
    processName: "jarvis-explorer",
    taskbarItemId: "builtin:explorer",
    minimumWidth: 720,
    minimumHeight: 460,
    widthRatio: 0.72,
    heightRatio: 0.72,
    widthLimit: 1240,
    heightLimit: 820,
    offsetX: -70,
    offsetY: -10,
    order: 1,
  }),
  terminal: Object.freeze({
    id: "terminal",
    label: "JARVIS Terminal Workbench",
    processName: "jarvis-terminal",
    taskbarItemId: "builtin:terminal",
    minimumWidth: 660,
    minimumHeight: 420,
    widthRatio: 0.66,
    heightRatio: 0.64,
    widthLimit: 1120,
    heightLimit: 720,
    offsetX: 42,
    offsetY: 32,
    order: 2,
  }),
  inspector: Object.freeze({
    id: "inspector",
    label: "System Inspector",
    processName: "jarvis-inspector",
    taskbarItemId: "internal:inspector",
    minimumWidth: 600,
    minimumHeight: 420,
    widthRatio: 0.5,
    heightRatio: 0.66,
    widthLimit: 840,
    heightLimit: 760,
    offsetX: 168,
    offsetY: 12,
    order: 3,
  }),
});

export const WORKSPACE_WINDOW_IDS = Object.freeze(
  Object.keys(WORKSPACE_WINDOW_DEFINITIONS),
);

const DEFAULT_VIEWPORT = Object.freeze({
  width: 1440,
  height: 900,
  top: 78,
  right: 12,
  bottom: 86,
  left: 12,
});

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum, maximum) {
  if (maximum < minimum) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeWorkspaceViewport(viewport = {}) {
  const width = Math.max(320, Math.round(finiteNumber(viewport.width, DEFAULT_VIEWPORT.width)));
  const height = Math.max(240, Math.round(finiteNumber(viewport.height, DEFAULT_VIEWPORT.height)));
  const left = clamp(Math.round(finiteNumber(viewport.left, DEFAULT_VIEWPORT.left)), 0, width - 1);
  const right = clamp(Math.round(finiteNumber(viewport.right, DEFAULT_VIEWPORT.right)), 0, width - left - 1);
  const top = clamp(Math.round(finiteNumber(viewport.top, DEFAULT_VIEWPORT.top)), 0, height - 1);
  const bottom = clamp(Math.round(finiteNumber(viewport.bottom, DEFAULT_VIEWPORT.bottom)), 0, height - top - 1);

  return { width, height, top, right, bottom, left };
}

function availableWorkspace(viewport) {
  return {
    x: viewport.left,
    y: viewport.top,
    width: Math.max(1, viewport.width - viewport.left - viewport.right),
    height: Math.max(1, viewport.height - viewport.top - viewport.bottom),
  };
}

export function getDefaultWindowBounds(id, viewportInput) {
  const definition = WORKSPACE_WINDOW_DEFINITIONS[id];
  if (!definition) throw new Error(`Unknown workspace window: ${id}`);
  const viewport = normalizeWorkspaceViewport(viewportInput);
  const available = availableWorkspace(viewport);
  const minimumWidth = Math.min(definition.minimumWidth, available.width);
  const minimumHeight = Math.min(definition.minimumHeight, available.height);
  const width = clamp(
    Math.round(available.width * definition.widthRatio),
    minimumWidth,
    Math.min(definition.widthLimit, available.width),
  );
  const height = clamp(
    Math.round(available.height * definition.heightRatio),
    minimumHeight,
    Math.min(definition.heightLimit, available.height),
  );
  const centeredX = available.x + Math.round((available.width - width) / 2);
  const centeredY = available.y + Math.round((available.height - height) / 2);

  return constrainWindowBounds(id, {
    x: centeredX + definition.offsetX,
    y: centeredY + definition.offsetY,
    width,
    height,
  }, viewport);
}

export function constrainWindowBounds(id, boundsInput, viewportInput) {
  const definition = WORKSPACE_WINDOW_DEFINITIONS[id];
  if (!definition) throw new Error(`Unknown workspace window: ${id}`);
  const viewport = normalizeWorkspaceViewport(viewportInput);
  const available = availableWorkspace(viewport);
  const fallback = {
    x: available.x,
    y: available.y,
    width: Math.min(definition.widthLimit, available.width),
    height: Math.min(definition.heightLimit, available.height),
  };
  const bounds = boundsInput && typeof boundsInput === "object" ? boundsInput : fallback;
  const minimumWidth = Math.min(definition.minimumWidth, available.width);
  const minimumHeight = Math.min(definition.minimumHeight, available.height);
  const width = clamp(
    Math.round(finiteNumber(bounds.width, fallback.width)),
    minimumWidth,
    available.width,
  );
  const height = clamp(
    Math.round(finiteNumber(bounds.height, fallback.height)),
    minimumHeight,
    available.height,
  );
  const x = clamp(
    Math.round(finiteNumber(bounds.x, fallback.x)),
    available.x,
    available.x + available.width - width,
  );
  const y = clamp(
    Math.round(finiteNumber(bounds.y, fallback.y)),
    available.y,
    available.y + available.height - height,
  );

  return { x, y, width, height };
}

function normalizePersistedLayout(value) {
  if (!value || typeof value !== "object" || value.version !== WORKSPACE_LAYOUT_VERSION) {
    return null;
  }
  if (!value.windows || typeof value.windows !== "object") return null;
  return value.windows;
}

export function createWorkspaceWindowState(viewportInput, persistedLayout = null) {
  const viewport = normalizeWorkspaceViewport(viewportInput);
  const persistedWindows = normalizePersistedLayout(persistedLayout);
  const windows = {};

  WORKSPACE_WINDOW_IDS.forEach((id) => {
    const definition = WORKSPACE_WINDOW_DEFINITIONS[id];
    const persisted = persistedWindows?.[id];
    const defaultBounds = getDefaultWindowBounds(id, viewport);
    const bounds = constrainWindowBounds(id, persisted?.bounds ?? defaultBounds, viewport);
    const restoreBounds = persisted?.restoreBounds
      ? constrainWindowBounds(id, persisted.restoreBounds, viewport)
      : null;
    windows[id] = {
      id,
      open: false,
      minimized: false,
      maximized: persisted?.maximized === true,
      bounds,
      restoreBounds,
      zIndex: definition.order,
    };
  });

  return {
    version: WORKSPACE_LAYOUT_VERSION,
    activeId: null,
    nextZ: WORKSPACE_WINDOW_IDS.length + 1,
    viewport,
    windows,
  };
}

function getHighestVisibleWindowId(windows, excludedId = null) {
  return Object.values(windows)
    .filter((windowState) => (
      windowState.id !== excludedId &&
      windowState.open &&
      !windowState.minimized
    ))
    .sort((left, right) => right.zIndex - left.zIndex)[0]?.id ?? null;
}

function activateWindow(state, id, patch = {}) {
  const current = state.windows[id];
  if (!current) return state;
  const zIndex = state.nextZ;
  return {
    ...state,
    activeId: id,
    nextZ: zIndex + 1,
    windows: {
      ...state.windows,
      [id]: {
        ...current,
        ...patch,
        open: true,
        minimized: false,
        zIndex,
      },
    },
  };
}

function hideWindow(state, id, patch) {
  const current = state.windows[id];
  if (!current) return state;
  const windows = {
    ...state.windows,
    [id]: { ...current, ...patch },
  };
  return {
    ...state,
    activeId: state.activeId === id
      ? getHighestVisibleWindowId(windows, id)
      : state.activeId,
    windows,
  };
}

export function workspaceWindowReducer(state, action) {
  const id = action?.id;
  switch (action?.type) {
    case "OPEN":
      return activateWindow(state, id);
    case "ACTIVATE":
    case "RESTORE":
      return activateWindow(state, id);
    case "CLOSE":
      return hideWindow(state, id, { open: false, minimized: false });
    case "MINIMIZE":
      return hideWindow(state, id, { minimized: true });
    case "TASKBAR_TOGGLE": {
      const current = state.windows[id];
      if (!current) return state;
      if (current.open && state.activeId === id && !current.minimized) {
        return hideWindow(state, id, { minimized: true });
      }
      return activateWindow(state, id);
    }
    case "TOGGLE_MAXIMIZE": {
      const current = state.windows[id];
      if (!current) return state;
      if (current.maximized) {
        return activateWindow(state, id, {
          maximized: false,
          bounds: constrainWindowBounds(
            id,
            current.restoreBounds ?? current.bounds,
            state.viewport,
          ),
          restoreBounds: null,
        });
      }
      return activateWindow(state, id, {
        maximized: true,
        restoreBounds: current.bounds,
      });
    }
    case "COMMIT_BOUNDS": {
      const current = state.windows[id];
      if (!current) return state;
      return activateWindow(state, id, {
        maximized: false,
        restoreBounds: null,
        bounds: constrainWindowBounds(id, action.bounds, state.viewport),
      });
    }
    case "REFLOW": {
      const viewport = normalizeWorkspaceViewport(action.viewport);
      const windows = Object.fromEntries(WORKSPACE_WINDOW_IDS.map((windowId) => {
        const current = state.windows[windowId];
        return [windowId, {
          ...current,
          bounds: constrainWindowBounds(windowId, current.bounds, viewport),
          restoreBounds: current.restoreBounds
            ? constrainWindowBounds(windowId, current.restoreBounds, viewport)
            : null,
        }];
      }));
      return { ...state, viewport, windows };
    }
    case "CYCLE": {
      const visibleIds = Object.values(state.windows)
        .filter((windowState) => windowState.open && !windowState.minimized)
        .sort((left, right) => left.zIndex - right.zIndex)
        .map((windowState) => windowState.id);
      if (visibleIds.length === 0) return state;
      const currentIndex = visibleIds.indexOf(state.activeId);
      const direction = action.direction === -1 ? -1 : 1;
      const nextIndex = currentIndex < 0
        ? (direction > 0 ? 0 : visibleIds.length - 1)
        : (currentIndex + direction + visibleIds.length) % visibleIds.length;
      return activateWindow(state, visibleIds[nextIndex]);
    }
    default:
      return state;
  }
}

export function serializeWorkspaceLayout(state) {
  return {
    version: WORKSPACE_LAYOUT_VERSION,
    windows: Object.fromEntries(WORKSPACE_WINDOW_IDS.map((id) => {
      const windowState = state.windows[id];
      return [id, {
        bounds: windowState.bounds,
        restoreBounds: windowState.restoreBounds,
        maximized: windowState.maximized,
      }];
    })),
  };
}

export function getWorkspaceTaskbarWindows(state) {
  return WORKSPACE_WINDOW_IDS
    .map((id) => {
      const definition = WORKSPACE_WINDOW_DEFINITIONS[id];
      const windowState = state.windows[id];
      if (!windowState.open) return null;
      return {
        windowId: `jarvis:${id}`,
        internalWindowId: id,
        taskbarItemId: definition.taskbarItemId,
        title: definition.label,
        processName: definition.processName,
        active: state.activeId === id && !windowState.minimized,
        minimized: windowState.minimized,
        canClose: true,
      };
    })
    .filter(Boolean);
}
