const DEFAULT_SLOT_WIDTH = 56;
const MINIMUM_VISIBLE_SLOTS = 5;
export const TASKBAR_ICON_SLOT_WIDTH = 48;
export const TASKBAR_MINIMUM_FULL_WIDTH = 64;

function normalizeWidth(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : fallback;
}

function prepareItem(item) {
  const fullWidth = Math.max(
    TASKBAR_MINIMUM_FULL_WIDTH,
    normalizeWidth(item?.fullWidth, DEFAULT_SLOT_WIDTH),
  );
  return {
    id: String(item?.id ?? ""),
    fullWidth,
    compactWidth: item?.canUseIconOnly ? TASKBAR_ICON_SLOT_WIDTH : fullWidth,
    canUseIconOnly: Boolean(item?.canUseIconOnly),
  };
}

function sumWidths(items, key) {
  return items.reduce((total, item) => total + item[key], 0);
}

/**
 * Plans taskbar density without clipping labels or splitting application groups.
 * Full labels are preferred, recognizable icons compact next, and a stable prefix
 * is retained when an overflow control is required.
 */
export function getTaskbarLayoutPlan(items = [], containerWidth) {
  const prepared = items.map(prepareItem).filter((item) => item.id);
  const availableWidth = normalizeWidth(containerWidth, DEFAULT_SLOT_WIDTH * MINIMUM_VISIBLE_SLOTS);
  const fullWidth = sumWidths(prepared, "fullWidth");

  if (fullWidth <= availableWidth) {
    return {
      mode: "full",
      visible: prepared.map((item) => ({ id: item.id, density: "full", width: item.fullWidth })),
      overflowIds: [],
    };
  }

  const compactWidth = sumWidths(prepared, "compactWidth");
  if (compactWidth <= availableWidth) {
    return {
      mode: prepared.every((item) => item.canUseIconOnly) ? "compact" : "mixed",
      visible: prepared.map((item) => ({
        id: item.id,
        density: item.canUseIconOnly ? "icon" : "full",
        width: item.compactWidth,
      })),
      overflowIds: [],
    };
  }

  const visible = [];
  let occupiedWidth = 0;
  for (const item of prepared) {
    if (occupiedWidth + item.compactWidth + TASKBAR_ICON_SLOT_WIDTH > availableWidth) break;
    visible.push({
      id: item.id,
      density: item.canUseIconOnly ? "icon" : "full",
      width: item.compactWidth,
    });
    occupiedWidth += item.compactWidth;
  }
  const visibleIds = new Set(visible.map((item) => item.id));
  return {
    mode: "overflow",
    visible,
    overflowIds: prepared.filter((item) => !visibleIds.has(item.id)).map((item) => item.id),
  };
}

export function getTaskbarCapacity(containerWidth, slotWidth = DEFAULT_SLOT_WIDTH) {
  const safeWidth = Number.isFinite(containerWidth) && containerWidth > 0
    ? containerWidth
    : DEFAULT_SLOT_WIDTH * MINIMUM_VISIBLE_SLOTS;
  const safeSlotWidth = Number.isFinite(slotWidth) && slotWidth > 0
    ? slotWidth
    : DEFAULT_SLOT_WIDTH;
  return Math.max(MINIMUM_VISIBLE_SLOTS, Math.floor(safeWidth / safeSlotWidth));
}
