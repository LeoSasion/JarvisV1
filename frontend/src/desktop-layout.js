export const DESKTOP_ICON_CELL_WIDTH = 96;
export const DESKTOP_ICON_CELL_HEIGHT = 88;
export const DESKTOP_ICON_GRID_PADDING = 18;

export function clampDesktopCoordinate(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function getDesktopFallbackPosition(index, height) {
  const availableHeight = Math.max(
    DESKTOP_ICON_CELL_HEIGHT,
    height - DESKTOP_ICON_GRID_PADDING * 2,
  );
  const rowCount = Math.max(
    1,
    Math.floor(availableHeight / DESKTOP_ICON_CELL_HEIGHT),
  );
  return {
    x: DESKTOP_ICON_GRID_PADDING +
      Math.floor(index / rowCount) * DESKTOP_ICON_CELL_WIDTH,
    y: DESKTOP_ICON_GRID_PADDING +
      (index % rowCount) * DESKTOP_ICON_CELL_HEIGHT,
  };
}
