import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  WORKSPACE_WINDOW_DEFINITIONS,
  constrainWindowBounds,
} from "../workspace-window-state.js";
import {
  getDockedWindowBounds,
  getLinkedWorkspaceVariant,
  isDockedWindow,
  isLinkedWindowSuppressed,
} from "../workspace-layout-mode.js";

const RESIZE_DIRECTIONS = Object.freeze([
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
  "nw",
]);

const DIRECTION_LABELS = Object.freeze({
  n: "Resize from top",
  ne: "Resize from top right",
  e: "Resize from right",
  se: "Resize from bottom right",
  s: "Resize from bottom",
  sw: "Resize from bottom left",
  w: "Resize from left",
  nw: "Resize from top left",
});

function getMaximizedBounds(viewport) {
  return {
    x: viewport.left,
    y: viewport.top,
    width: Math.max(1, viewport.width - viewport.left - viewport.right),
    height: Math.max(1, viewport.height - viewport.top - viewport.bottom),
  };
}

function resizeBounds(id, start, direction, deltaX, deltaY, viewport) {
  const candidate = { ...start };
  if (direction.includes("e")) candidate.width = start.width + deltaX;
  if (direction.includes("s")) candidate.height = start.height + deltaY;
  if (direction.includes("w")) {
    candidate.x = start.x + deltaX;
    candidate.width = start.width - deltaX;
  }
  if (direction.includes("n")) {
    candidate.y = start.y + deltaY;
    candidate.height = start.height - deltaY;
  }
  return constrainWindowBounds(id, candidate, viewport);
}

function applyPreview(element, bounds) {
  element.style.left = `${bounds.x}px`;
  element.style.top = `${bounds.y}px`;
  element.style.width = `${bounds.width}px`;
  element.style.height = `${bounds.height}px`;
}

export function ManagedWorkspaceWindow({
  id,
  windowState,
  viewport,
  active,
  layoutMode,
  onActivate,
  onCommitBounds,
  onToggleMaximize,
  children,
}) {
  const frameRef = useRef(null);
  const gestureRef = useRef(null);
  const definition = WORKSPACE_WINDOW_DEFINITIONS[id];
  const docked = isDockedWindow(id, layoutMode);
  const linkedVariant = getLinkedWorkspaceVariant(viewport);
  const layoutSuppressed = layoutMode === "explorer-agent-linked"
    && isLinkedWindowSuppressed(id, linkedVariant, active);
  const renderedBounds = getDockedWindowBounds(id, layoutMode, viewport)
    ?? (windowState.maximized ? getMaximizedBounds(viewport) : windowState.bounds);
  const style = useMemo(() => ({
    left: renderedBounds.x,
    top: renderedBounds.y,
    width: renderedBounds.width,
    height: renderedBounds.height,
    zIndex: docked ? (active ? 82 : 81) : 60 + windowState.zIndex,
  }), [
    active,
    docked,
    renderedBounds.height,
    renderedBounds.width,
    renderedBounds.x,
    renderedBounds.y,
    windowState.zIndex,
  ]);

  const stopGesture = useCallback((commit = true) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    gestureRef.current = null;
    window.cancelAnimationFrame(gesture.frame);
    window.removeEventListener("pointermove", gesture.onMove);
    window.removeEventListener("pointerup", gesture.onEnd);
    window.removeEventListener("pointercancel", gesture.onCancel);
    frameRef.current?.classList.remove("is-manipulating");
    if (commit && gesture.latestBounds) {
      onCommitBounds(id, gesture.latestBounds);
    } else if (frameRef.current && gesture.startBounds) {
      applyPreview(frameRef.current, gesture.startBounds);
    }
  }, [id, onCommitBounds]);

  useEffect(() => () => stopGesture(false), [stopGesture]);

  useEffect(() => {
    stopGesture(false);
  }, [
    layoutMode,
    stopGesture,
    viewport.bottom,
    viewport.height,
    viewport.left,
    viewport.right,
    viewport.top,
    viewport.width,
  ]);

  const beginGesture = useCallback((event) => {
    if (!event.isPrimary || event.button !== 0) return;
    onActivate(id);
    const target = event.target;
    if (!(target instanceof Element)) return;
    const resizeHandle = target.closest("[data-window-resize]");
    const dragHandle = target.closest("[data-window-drag-handle]");
    const blocked = target.closest("button, input, select, textarea, a, [data-no-window-drag]");
    const mode = resizeHandle ? "resize" : dragHandle && !blocked ? "drag" : null;
    if (!mode || windowState.maximized || docked) return;

    event.preventDefault();
    stopGesture(false);
    const startBounds = { ...windowState.bounds };
    const direction = resizeHandle?.getAttribute("data-window-resize") ?? "";
    const startX = event.clientX;
    const startY = event.clientY;
    const gesture = {
      frame: 0,
      startBounds,
      latestBounds: startBounds,
      onMove: null,
      onEnd: null,
      onCancel: null,
    };

    gesture.onMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      gesture.latestBounds = mode === "drag"
        ? constrainWindowBounds(id, {
          ...startBounds,
          x: startBounds.x + deltaX,
          y: startBounds.y + deltaY,
        }, viewport)
        : resizeBounds(id, startBounds, direction, deltaX, deltaY, viewport);
      window.cancelAnimationFrame(gesture.frame);
      gesture.frame = window.requestAnimationFrame(() => {
        if (frameRef.current) applyPreview(frameRef.current, gesture.latestBounds);
      });
    };
    gesture.onEnd = () => stopGesture(true);
    gesture.onCancel = () => stopGesture(false);
    gestureRef.current = gesture;
    frameRef.current?.classList.add("is-manipulating");
    window.addEventListener("pointermove", gesture.onMove, { passive: true });
    window.addEventListener("pointerup", gesture.onEnd, { once: true });
    window.addEventListener("pointercancel", gesture.onCancel, { once: true });
  }, [
    id,
    docked,
    onActivate,
    stopGesture,
    viewport,
    windowState.bounds,
    windowState.maximized,
  ]);

  const handleDoubleClick = useCallback((event) => {
    if (docked) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest("[data-window-drag-handle]")) return;
    if (target.closest("button, input, select, textarea, a, [data-no-window-drag]")) return;
    event.preventDefault();
    onToggleMaximize(id);
  }, [docked, id, onToggleMaximize]);

  const resizeWithKeyboard = useCallback((event, direction) => {
    if (windowState.maximized || docked) return;
    const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!horizontal && !vertical) return;
    event.preventDefault();
    const step = event.shiftKey ? 32 : 12;
    onCommitBounds(
      id,
      resizeBounds(
        id,
        windowState.bounds,
        direction,
        horizontal * step,
        vertical * step,
        viewport,
      ),
    );
  }, [docked, id, onCommitBounds, viewport, windowState.bounds, windowState.maximized]);

  return (
    <div
      ref={frameRef}
      id={`workspace-window-${id}`}
      className={[
        "workspace-window",
        `is-${id}`,
        active ? "is-active" : "",
        windowState.maximized ? "is-maximized" : "",
        windowState.minimized ? "is-minimized" : "",
        docked ? "is-docked" : "",
        layoutMode ? `is-layout-${layoutMode}` : "",
        layoutMode === "explorer-agent-linked" ? `is-linked-${linkedVariant}` : "",
        layoutSuppressed ? "is-layout-suppressed" : "",
      ].filter(Boolean).join(" ")}
      style={style}
      hidden={windowState.minimized || layoutSuppressed}
      aria-hidden={windowState.minimized || layoutSuppressed}
      inert={layoutSuppressed || undefined}
      data-window-id={id}
      data-window-active={active ? "true" : "false"}
      data-window-layout={layoutMode}
      data-linked-variant={layoutMode === "explorer-agent-linked" ? linkedVariant : undefined}
      data-window-layout-suppressed={layoutSuppressed ? "true" : "false"}
      onPointerDownCapture={beginGesture}
      onDoubleClick={handleDoubleClick}
    >
      {children}
      {!windowState.maximized && !docked ? RESIZE_DIRECTIONS.map((direction) => (
        <span
          key={direction}
          className={`workspace-resize-handle is-${direction}`}
          role="separator"
          tabIndex={0}
          aria-label={`${DIRECTION_LABELS[direction]} ${definition.label}`}
          aria-orientation={direction === "n" || direction === "s" ? "horizontal" : "vertical"}
          data-window-resize={direction}
          onKeyDown={(event) => resizeWithKeyboard(event, direction)}
        />
      )) : null}
    </div>
  );
}
