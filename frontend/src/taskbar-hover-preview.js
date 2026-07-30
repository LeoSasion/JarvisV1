export const TASKBAR_HOVER_PREVIEW_DELAY_MS = 450;
export const TASKBAR_HOVER_DISMISS_DELAY_MS = 700;

export function getTaskbarHoverPreviewTarget(item, platformKind) {
  if (
    !item
    || typeof item.id !== "string"
    || !item.id
    || !Array.isArray(item.windows)
    || item.windows.length === 0
  ) {
    return null;
  }

  const windowIds = [];
  const seenWindowIds = new Set();
  let includesInternalWindow = false;
  for (const window of item.windows) {
    if (window?.internalWindowId) {
      includesInternalWindow = true;
    }
    if (
      typeof window?.windowId !== "string"
      || !window.windowId
      || seenWindowIds.has(window.windowId)
    ) {
      continue;
    }

    seenWindowIds.add(window.windowId);
    windowIds.push(window.windowId);
    if (windowIds.length === 24) break;
  }

  if (
    windowIds.length === 0
    || (platformKind !== "mock" && includesInternalWindow)
  ) {
    return null;
  }

  return {
    itemId: item.id,
    kind: platformKind === "mock" ? "mock" : "native",
    windowIds,
  };
}

export function acceptsTaskbarHoverPointer(pointerType, draggedPinnedId) {
  return pointerType === "mouse" && !draggedPinnedId;
}
