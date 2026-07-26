import { useCallback, useEffect, useMemo, useReducer } from "react";
import {
  WORKSPACE_LAYOUT_STORAGE_KEY,
  createWorkspaceWindowState,
  getWorkspaceTaskbarWindows,
  serializeWorkspaceLayout,
  workspaceWindowReducer,
} from "../workspace-window-state.js";
import { publishWorkspaceRuntime } from "../workspace-runtime-channel.js";

function readPersistedLayout() {
  try {
    return JSON.parse(window.localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

function getViewport(bottomInset) {
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight,
    top: 78,
    right: 12,
    bottom: bottomInset,
    left: 12,
  };
}

export function useWorkspaceManager({ bottomInset = 108 } = {}) {
  const [state, dispatch] = useReducer(
    workspaceWindowReducer,
    null,
    () => createWorkspaceWindowState(getViewport(bottomInset), readPersistedLayout()),
  );

  const serializedLayout = useMemo(
    () => JSON.stringify(serializeWorkspaceLayout(state)),
    [state],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        WORKSPACE_LAYOUT_STORAGE_KEY,
        serializedLayout,
      );
    } catch {
      // Private browsing or a full storage quota must not disable window management.
    }
  }, [serializedLayout]);

  useEffect(() => {
    let frame = 0;
    const reflow = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        dispatch({ type: "REFLOW", viewport: getViewport(bottomInset) });
      });
    };
    reflow();
    window.addEventListener("resize", reflow);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", reflow);
    };
  }, [bottomInset]);

  const open = useCallback((id) => dispatch({ type: "OPEN", id }), []);
  const close = useCallback((id) => dispatch({ type: "CLOSE", id }), []);
  const activate = useCallback((id) => dispatch({ type: "ACTIVATE", id }), []);
  const minimize = useCallback((id) => dispatch({ type: "MINIMIZE", id }), []);
  const restore = useCallback((id) => dispatch({ type: "RESTORE", id }), []);
  const toggleMaximize = useCallback((id) => dispatch({ type: "TOGGLE_MAXIMIZE", id }), []);
  const toggleFromTaskbar = useCallback((id) => dispatch({ type: "TASKBAR_TOGGLE", id }), []);
  const commitBounds = useCallback((id, bounds) => {
    dispatch({ type: "COMMIT_BOUNDS", id, bounds });
  }, []);
  const cycle = useCallback((direction) => {
    dispatch({ type: "CYCLE", direction });
  }, []);
  const taskbarWindows = useMemo(() => getWorkspaceTaskbarWindows(state), [state]);

  useEffect(() => {
    publishWorkspaceRuntime(taskbarWindows);
  }, [taskbarWindows]);

  return {
    state,
    taskbarWindows,
    open,
    close,
    activate,
    minimize,
    restore,
    toggleMaximize,
    toggleFromTaskbar,
    commitBounds,
    cycle,
  };
}
