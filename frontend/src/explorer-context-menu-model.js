const MENU_MARGIN = 8;
export const EXPLORER_CONTEXT_MENU_WIDTH = 272;

function boundedCount(value) {
  return Math.max(0, Math.min(10_000, Math.floor(Number(value) || 0)));
}

export function resolveExplorerContextSelection(selectedPaths, targetPath) {
  const selected = Array.isArray(selectedPaths)
    ? selectedPaths.filter((path) => typeof path === "string" && path)
    : [];
  if (typeof targetPath !== "string" || !targetPath) return [];
  return selected.includes(targetPath)
    ? [...new Set(selected)]
    : [targetPath];
}

export function getExplorerContextMenuActions(options = {}) {
  const selectionCount = boundedCount(options.selectionCount);
  const singleSelection = selectionCount === 1;
  const blocked = Boolean(options.busy || options.transferActive);

  if (options.kind === "item") {
    return Object.freeze([
      { id: "open", label: "OPEN", shortcut: "ENTER", group: "open", disabled: !singleSelection },
      { id: "open-in-windows", label: "OPEN IN WINDOWS", group: "open", disabled: !singleSelection },
      { id: "copy", label: "COPY", shortcut: "CTRL+C", group: "clipboard", disabled: selectionCount === 0 || blocked },
      { id: "cut", label: "CUT", shortcut: "CTRL+X", group: "clipboard", disabled: selectionCount === 0 || blocked },
      { id: "copy-path", label: "COPY PATH", shortcut: "CTRL+SHIFT+C", group: "clipboard", disabled: selectionCount === 0 },
      { id: "rename", label: "RENAME", shortcut: "F2", group: "manage", disabled: !singleSelection || blocked },
      { id: "properties", label: "PROPERTIES", shortcut: "ALT+ENTER", group: "manage", disabled: !singleSelection },
      { id: "recycle", label: "MOVE TO RECYCLE BIN", shortcut: "DEL", group: "danger", disabled: selectionCount === 0 || blocked, danger: true },
    ]);
  }

  const hasCurrentPath = Boolean(options.hasCurrentPath);
  return Object.freeze([
    { id: "new-folder", label: "NEW FOLDER", shortcut: "CTRL+SHIFT+N", group: "create", disabled: !hasCurrentPath || blocked },
    { id: "paste", label: "PASTE", shortcut: "CTRL+V", group: "create", disabled: !options.canPaste || Boolean(options.busy) },
    { id: "refresh", label: "REFRESH", shortcut: "F5", group: "location", disabled: !hasCurrentPath || Boolean(options.loading) },
    { id: "open-in-windows", label: "OPEN IN WINDOWS", group: "location", disabled: !hasCurrentPath },
  ]);
}

export function getExplorerContextMenuEstimatedHeight(actions) {
  const source = Array.isArray(actions) ? actions : [];
  let groupChanges = 0;
  for (let index = 1; index < source.length; index += 1) {
    if (source[index]?.group !== source[index - 1]?.group) groupChanges += 1;
  }
  // Includes the measured frame/header/padding plus a small rendering safety
  // margin so the last command never touches the viewport edge.
  return 61 + source.length * 36 + groupChanges * 9;
}

export function getExplorerContextMenuPosition({
  clientX,
  clientY,
  viewportWidth,
  viewportHeight,
  menuWidth = EXPLORER_CONTEXT_MENU_WIDTH,
  menuHeight,
}) {
  const width = Math.max(1, Number(menuWidth) || EXPLORER_CONTEXT_MENU_WIDTH);
  const height = Math.max(1, Number(menuHeight) || 240);
  const viewportX = Math.max(MENU_MARGIN * 2 + width, Number(viewportWidth) || 0);
  const viewportY = Math.max(MENU_MARGIN * 2 + height, Number(viewportHeight) || 0);
  return Object.freeze({
    x: Math.min(
      Math.max(MENU_MARGIN, Number(clientX) || 0),
      viewportX - width - MENU_MARGIN,
    ),
    y: Math.min(
      Math.max(MENU_MARGIN, Number(clientY) || 0),
      viewportY - height - MENU_MARGIN,
    ),
  });
}

export function isExplorerContextMenuTrigger(eventLike) {
  if (!eventLike || eventLike.ctrlKey || eventLike.altKey || eventLike.metaKey) {
    return false;
  }
  return eventLike.key === "ContextMenu" ||
    (eventLike.key === "F10" && eventLike.shiftKey === true);
}

function enabledIndexes(actions) {
  return (Array.isArray(actions) ? actions : [])
    .map((action, index) => action?.disabled ? -1 : index)
    .filter((index) => index >= 0);
}

export function getExplorerContextMenuKeyboardTarget(
  actions,
  currentIndex,
  key,
) {
  const enabled = enabledIndexes(actions);
  if (enabled.length === 0) return -1;
  if (key === "Home") return enabled[0];
  if (key === "End") return enabled.at(-1);
  if (!["ArrowUp", "ArrowDown"].includes(key)) {
    return enabled.includes(currentIndex) ? currentIndex : enabled[0];
  }
  const currentEnabledIndex = enabled.indexOf(currentIndex);
  if (currentEnabledIndex < 0) {
    return key === "ArrowUp" ? enabled.at(-1) : enabled[0];
  }
  const delta = key === "ArrowUp" ? -1 : 1;
  return enabled[
    (currentEnabledIndex + delta + enabled.length) % enabled.length
  ];
}
