const TYPEAHEAD_TIMEOUT_MS = 900;

function normalizeLabel(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
}

export function getDesktopKeyboardTarget(items, currentIndex, key) {
  if (!Array.isArray(items) || items.length === 0) return -1;
  const safeIndex = Number.isInteger(currentIndex) && currentIndex >= 0 &&
    currentIndex < items.length ? currentIndex : 0;
  if (key === "Home") return 0;
  if (key === "End") return items.length - 1;
  const origin = items[safeIndex];
  if (!origin || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) {
    return safeIndex;
  }

  let bestIndex = safeIndex;
  let bestScore = Number.POSITIVE_INFINITY;
  items.forEach((item, index) => {
    if (index === safeIndex || !item) return;
    const deltaX = Number(item.x) - Number(origin.x);
    const deltaY = Number(item.y) - Number(origin.y);
    const primary = key === "ArrowLeft"
      ? -deltaX
      : key === "ArrowRight"
        ? deltaX
        : key === "ArrowUp"
          ? -deltaY
          : deltaY;
    if (!(primary > 0)) return;
    const secondary = key === "ArrowLeft" || key === "ArrowRight"
      ? Math.abs(deltaY)
      : Math.abs(deltaX);
    const score = primary + secondary * 4;
    if (score < bestScore || (score === bestScore && index < bestIndex)) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestIndex;
}

export function advanceDesktopTypeahead(
  entries,
  currentIndex,
  previousState,
  key,
  now = Date.now(),
) {
  const character = normalizeLabel(key);
  if (!character || [...character].length !== 1) {
    return { query: "", timestamp: now, index: currentIndex };
  }
  const previousQuery = normalizeLabel(previousState?.query);
  const withinWindow = Number.isFinite(previousState?.timestamp) &&
    now - previousState.timestamp <= TYPEAHEAD_TIMEOUT_MS;
  const repeatedSingleCharacter = withinWindow &&
    previousQuery.length === 1 &&
    previousQuery === character;
  const query = withinWindow && !repeatedSingleCharacter
    ? `${previousQuery}${character}`
    : character;
  if (!Array.isArray(entries) || entries.length === 0) {
    return { query, timestamp: now, index: -1 };
  }
  const startIndex = Number.isInteger(currentIndex) && currentIndex >= 0
    ? currentIndex
    : -1;
  for (let offset = 1; offset <= entries.length; offset += 1) {
    const index = (startIndex + offset) % entries.length;
    if (normalizeLabel(entries[index]?.label ?? entries[index]?.name).startsWith(query)) {
      return { query, timestamp: now, index };
    }
  }
  return { query, timestamp: now, index: startIndex };
}
