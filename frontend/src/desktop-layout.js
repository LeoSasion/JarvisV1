export const DESKTOP_ICON_CELL_WIDTH = 96;
export const DESKTOP_ICON_CELL_HEIGHT = 88;
export const DESKTOP_ICON_GRID_PADDING = 18;

export const DESKTOP_ICON_SIZES = {
  small: {
    cellWidth: 80,
    cellHeight: 74,
    iconSize: 34,
    labelSize: 11,
  },
  medium: {
    cellWidth: DESKTOP_ICON_CELL_WIDTH,
    cellHeight: DESKTOP_ICON_CELL_HEIGHT,
    iconSize: 44,
    labelSize: 13,
  },
  large: {
    cellWidth: 120,
    cellHeight: 108,
    iconSize: 58,
    labelSize: 13,
  },
};

export function clampDesktopCoordinate(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function getDesktopIconMetrics(size = "medium") {
  return DESKTOP_ICON_SIZES[size] ?? DESKTOP_ICON_SIZES.medium;
}

export function getDesktopFallbackPosition(index, height, metrics = DESKTOP_ICON_SIZES.medium) {
  const availableHeight = Math.max(
    metrics.cellHeight,
    height - DESKTOP_ICON_GRID_PADDING * 2,
  );
  const rowCount = Math.max(
    1,
    Math.floor(availableHeight / metrics.cellHeight),
  );
  return {
    x: DESKTOP_ICON_GRID_PADDING +
      Math.floor(index / rowCount) * metrics.cellWidth,
    y: DESKTOP_ICON_GRID_PADDING +
      (index % rowCount) * metrics.cellHeight,
  };
}

export function sortDesktopEntries(entries, sortMode = "none") {
  if (sortMode === "none") return entries;
  const compare = (left, right) => String(left ?? "").localeCompare(
    String(right ?? ""),
    undefined,
    { numeric: true, sensitivity: "base" },
  );
  const compareLabel = (left, right) => compare(left.label, right.label);
  return [...entries].sort((left, right) => {
    if (sortMode === "type") {
      return compare(left.kind, right.kind) ||
        compare(left.extension, right.extension) ||
        compareLabel(left, right);
    }
    if (sortMode === "source") {
      return compare(left.source, right.source) ||
        compareLabel(left, right);
    }
    return compareLabel(left, right);
  });
}

export function snapDesktopPosition(position, metrics, containerSize) {
  const maximumX = Math.max(0, containerSize.width - metrics.cellWidth);
  const maximumY = Math.max(0, containerSize.height - metrics.cellHeight);
  const gridX = Math.round(
    (position.x - DESKTOP_ICON_GRID_PADDING) / metrics.cellWidth,
  ) * metrics.cellWidth + DESKTOP_ICON_GRID_PADDING;
  const gridY = Math.round(
    (position.y - DESKTOP_ICON_GRID_PADDING) / metrics.cellHeight,
  ) * metrics.cellHeight + DESKTOP_ICON_GRID_PADDING;
  return {
    x: clampDesktopCoordinate(gridX, 0, maximumX),
    y: clampDesktopCoordinate(gridY, 0, maximumY),
  };
}

export function getDesktopContextMenuPosition({
  clientX,
  clientY,
  viewportWidth,
  viewportHeight,
  kind = "desktop",
}) {
  const menuWidth = 248;
  const menuHeight = kind === "item" ? 226 : 326;
  const margin = 8;
  const x = clampDesktopCoordinate(clientX, margin, viewportWidth - menuWidth - margin);
  const y = clampDesktopCoordinate(clientY, margin, viewportHeight - menuHeight - margin);
  const submenuSide = x + menuWidth * 2 + margin <= viewportWidth ? "right" : "left";
  return { x, y, submenuSide };
}
