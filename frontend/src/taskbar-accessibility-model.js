export function getTaskbarKeyboardTarget(itemCount, currentIndex, key) {
  if (!Number.isInteger(itemCount) || itemCount <= 0) return -1;
  const safeIndex = Number.isInteger(currentIndex) && currentIndex >= 0 &&
    currentIndex < itemCount ? currentIndex : 0;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  if (key === "ArrowLeft") return (safeIndex - 1 + itemCount) % itemCount;
  if (key === "ArrowRight") return (safeIndex + 1) % itemCount;
  return safeIndex;
}

export function getTaskbarAccessibleLabel(item, isActive = false) {
  const label = String(item?.label ?? "Application").trim() || "Application";
  const windows = Array.isArray(item?.windows) ? item.windows : [];
  const selectedWindow = item?.selectedWindow ?? windows[0] ?? null;
  const states = [];
  if (isActive) states.push("active");
  if (selectedWindow?.minimized) states.push("minimized");
  if (windows.length > 0) {
    states.push(`${windows.length} open window${windows.length === 1 ? "" : "s"}`);
  } else if (item?.isPinned) {
    states.push("pinned");
  } else {
    states.push("not running");
  }
  return `${label}, ${states.join(", ")}`;
}
