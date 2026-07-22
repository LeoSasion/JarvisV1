export function normalizeProcessName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\.exe$/, "");
}

export function getRunningGroupKey(window) {
  const applicationId = String(window.applicationId ?? "").trim();
  if (applicationId) return `application:${applicationId}`;

  const processName = normalizeProcessName(window.processName);
  if (processName !== "applicationframehost") return processName;

  const title = String(window.title ?? "").trim().toLocaleLowerCase();
  const titleKey = encodeURIComponent(title).slice(0, 180);
  return `${processName}:${titleKey || window.pid || window.windowId}`;
}

export function doesWindowMatchPinnedApplication(window, application) {
  const windowApplicationId = String(window.applicationId ?? "").trim();
  const pinnedApplicationId = String(application.applicationId ?? "").trim();
  if (windowApplicationId && pinnedApplicationId) {
    return windowApplicationId === pinnedApplicationId;
  }

  const windowProcessName = normalizeProcessName(window.processName);
  return Boolean(windowProcessName) && (application.processes ?? [])
    .some((processName) => normalizeProcessName(processName) === windowProcessName);
}

export function partitionWindowsByPinnedApplications(windows, applications) {
  const consumedWindowIds = new Set();
  const matchedWindowsByApplication = applications.map(() => []);

  applications.forEach((application, applicationIndex) => {
    const applicationId = String(application.applicationId ?? "").trim();
    if (!applicationId) return;
    windows.forEach((window) => {
      if (consumedWindowIds.has(window.windowId) ||
          String(window.applicationId ?? "").trim() !== applicationId) return;
      consumedWindowIds.add(window.windowId);
      matchedWindowsByApplication[applicationIndex].push(window);
    });
  });

  applications.forEach((application, applicationIndex) => {
    windows.forEach((window) => {
      if (consumedWindowIds.has(window.windowId) ||
          !doesWindowMatchPinnedApplication(window, application)) return;
      consumedWindowIds.add(window.windowId);
      matchedWindowsByApplication[applicationIndex].push(window);
    });
  });

  return {
    matchedWindowsByApplication,
    unmatchedWindows: windows.filter((window) => !consumedWindowIds.has(window.windowId)),
  };
}

export function reconcileRunningTaskbarOrder(previousOrder, currentIds) {
  const currentIdSet = new Set(currentIds);
  const nextOrder = previousOrder.filter((id) => currentIdSet.has(id));
  const seen = new Set(nextOrder);
  currentIds.forEach((id) => {
    if (seen.has(id)) return;
    seen.add(id);
    nextOrder.push(id);
  });

  return nextOrder.length === previousOrder.length &&
    nextOrder.every((id, index) => id === previousOrder[index])
    ? previousOrder
    : nextOrder;
}

export function getTaskbarContextActionIds(item) {
  const actions = [];
  if (item?.isPinned) actions.push("launch");
  if ((item?.windows?.length ?? 0) > 0) actions.push("close");
  if (item?.isPinned) actions.push("unpin");
  return actions;
}
