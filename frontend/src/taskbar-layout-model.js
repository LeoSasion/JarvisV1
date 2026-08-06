const DEFAULT_SLOT_WIDTH = 56;
const MINIMUM_VISIBLE_SLOTS = 5;

export function getTaskbarCapacity(containerWidth, slotWidth = DEFAULT_SLOT_WIDTH) {
  const safeWidth = Number.isFinite(containerWidth) && containerWidth > 0
    ? containerWidth
    : DEFAULT_SLOT_WIDTH * MINIMUM_VISIBLE_SLOTS;
  const safeSlotWidth = Number.isFinite(slotWidth) && slotWidth > 0
    ? slotWidth
    : DEFAULT_SLOT_WIDTH;
  return Math.max(MINIMUM_VISIBLE_SLOTS, Math.floor(safeWidth / safeSlotWidth));
}
