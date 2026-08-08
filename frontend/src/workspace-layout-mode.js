export const WORKSPACE_LAYOUT_MODES = Object.freeze({
  DESKTOP: "desktop",
  EXPLORER_FOCUS: "explorer-focus",
  EXPLORER_AGENT_LINKED: "explorer-agent-linked",
  FLOATING: "floating",
});

export const LINKED_WORKSPACE_VARIANTS = Object.freeze({
  THREE_PANE: "three-pane",
  TWO_PANE: "two-pane",
  DRAWER: "drawer",
  SINGLE_PANE: "single-pane",
});

function visibleWindowIds(windows = {}) {
  return Object.values(windows)
    .filter((windowState) => windowState?.open && !windowState.minimized)
    .map((windowState) => windowState.id)
    .sort();
}

export function getWorkspaceLayoutMode(windows) {
  const visibleIds = visibleWindowIds(windows);
  if (visibleIds.length === 0) return WORKSPACE_LAYOUT_MODES.DESKTOP;
  if (visibleIds.length === 1 && visibleIds[0] === "explorer") {
    return WORKSPACE_LAYOUT_MODES.EXPLORER_FOCUS;
  }
  if (
    visibleIds.length === 2
    && visibleIds[0] === "agent"
    && visibleIds[1] === "explorer"
  ) {
    return WORKSPACE_LAYOUT_MODES.EXPLORER_AGENT_LINKED;
  }
  return WORKSPACE_LAYOUT_MODES.FLOATING;
}

function availableBounds(viewport) {
  return {
    x: viewport.left,
    y: viewport.top,
    width: Math.max(1, viewport.width - viewport.left - viewport.right),
    height: Math.max(1, viewport.height - viewport.top - viewport.bottom),
  };
}

export function getLinkedWorkspaceVariant(viewport) {
  const width = availableBounds(viewport).width;
  if (width >= 1440) return LINKED_WORKSPACE_VARIANTS.THREE_PANE;
  if (width >= 1180) return LINKED_WORKSPACE_VARIANTS.TWO_PANE;
  if (width >= 920) return LINKED_WORKSPACE_VARIANTS.DRAWER;
  return LINKED_WORKSPACE_VARIANTS.SINGLE_PANE;
}

export function getDockedWindowBounds(id, mode, viewport) {
  const available = availableBounds(viewport);
  if (mode === WORKSPACE_LAYOUT_MODES.EXPLORER_FOCUS && id === "explorer") {
    return available;
  }
  if (mode !== WORKSPACE_LAYOUT_MODES.EXPLORER_AGENT_LINKED) return null;

  const variant = getLinkedWorkspaceVariant(viewport);
  if (variant === LINKED_WORKSPACE_VARIANTS.SINGLE_PANE) return available;
  if (variant === LINKED_WORKSPACE_VARIANTS.DRAWER) {
    if (id === "explorer") return available;
    if (id === "agent") {
      const agentWidth = Math.round(available.width * 0.46);
      return {
        ...available,
        x: available.x + available.width - agentWidth,
        width: agentWidth,
      };
    }
    return null;
  }

  const explorerRatio = variant === LINKED_WORKSPACE_VARIANTS.THREE_PANE ? 0.532 : 0.58;
  const agentRatio = variant === LINKED_WORKSPACE_VARIANTS.THREE_PANE ? 0.317 : 0.42;
  const explorerWidth = Math.round(available.width * explorerRatio);
  const agentWidth = variant === LINKED_WORKSPACE_VARIANTS.TWO_PANE
    ? available.width - explorerWidth
    : Math.round(available.width * agentRatio);
  if (id === "explorer") {
    return { ...available, width: explorerWidth };
  }
  if (id === "agent") {
    return {
      ...available,
      x: available.x + explorerWidth + 1,
      width: Math.max(1, agentWidth - 1),
    };
  }
  return null;
}

export function isDockedWindow(id, mode) {
  return (
    (mode === WORKSPACE_LAYOUT_MODES.EXPLORER_FOCUS && id === "explorer")
    || (
      mode === WORKSPACE_LAYOUT_MODES.EXPLORER_AGENT_LINKED
      && (id === "explorer" || id === "agent")
    )
  );
}

export function isLinkedWindowSuppressed(id, variant, active) {
  if (active) return false;
  if (variant === LINKED_WORKSPACE_VARIANTS.SINGLE_PANE) {
    return id === "explorer" || id === "agent";
  }
  return variant === LINKED_WORKSPACE_VARIANTS.DRAWER && id === "agent";
}

export function isCompactLinkedVariant(variant) {
  return variant === LINKED_WORKSPACE_VARIANTS.DRAWER
    || variant === LINKED_WORKSPACE_VARIANTS.SINGLE_PANE;
}

export function getLinkedPaneToggleTarget(activeId, variant) {
  if (!isCompactLinkedVariant(variant)) return null;
  return activeId === "agent" ? "explorer" : "agent";
}

export function isLinkedPaneToggleShortcut(eventLike = {}) {
  return eventLike.key === "F8"
    && eventLike.altKey === true
    && eventLike.ctrlKey !== true
    && eventLike.metaKey !== true
    && eventLike.shiftKey !== true
    && eventLike.repeat !== true
    && eventLike.defaultPrevented !== true;
}

export function getSystemNoticePlacement({
  workspaceMode,
  linkedVariant,
  activeId,
  noticeSource,
  shellPanel,
  commandOpen = false,
} = {}) {
  if (shellPanel || commandOpen) return "shell-top";
  if (workspaceMode === WORKSPACE_LAYOUT_MODES.EXPLORER_AGENT_LINKED) {
    const sourcePane = noticeSource === "agent" || noticeSource === "explorer"
      ? noticeSource
      : activeId;
    if (sourcePane === "explorer") return "workspace-top-start";
    if (sourcePane === "agent") return "workspace-top-end";
    return isCompactLinkedVariant(linkedVariant) ? "workspace-top-end" : "workspace-top-start";
  }
  if (workspaceMode === WORKSPACE_LAYOUT_MODES.EXPLORER_FOCUS) {
    return "workspace-top-end";
  }
  if (workspaceMode === WORKSPACE_LAYOUT_MODES.FLOATING) {
    return "workspace-top-end";
  }
  return "desktop-bottom-end";
}
