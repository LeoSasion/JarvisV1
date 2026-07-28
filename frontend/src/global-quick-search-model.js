const JARVIS_PANEL_BY_TARGET = new Map([
  ["explorer.exe", "explorer"],
  ["jarvis-settings:", "settings"],
  ["jarvis-terminal:", "terminal"],
]);

export function getGlobalQuickSearchAction(result) {
  if (!result || typeof result !== "object") return null;

  if (result.kind === "window") {
    const windowId = result.window?.windowId;
    if (windowId === undefined || windowId === null) return null;
    if (result.window.active && !result.window.minimized) {
      return { type: "dismiss", restoreForeground: true };
    }
    return { type: "activate-window", windowId };
  }

  if (result.kind === "installed-app") {
    const applicationId = result.application?.applicationId;
    return applicationId
      ? { type: "open-application", applicationId }
      : null;
  }

  if (result.kind === "desktop") {
    if (result.entry?.kind === "directory") {
      return { type: "show-desktop", panel: "explorer" };
    }
    const target = result.entry?.target ?? result.entry?.path;
    return target ? { type: "open-target", target } : null;
  }

  if (result.kind === "app") {
    const target = String(result.target ?? "");
    const panel = JARVIS_PANEL_BY_TARGET.get(target.toLocaleLowerCase());
    if (panel) return { type: "show-desktop", panel };
    return target ? { type: "open-target", target } : null;
  }

  if (result.kind === "setting") {
    return result.target
      ? { type: "open-target", target: result.target }
      : null;
  }

  return null;
}
