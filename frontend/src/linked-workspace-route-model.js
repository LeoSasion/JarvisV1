const DEFAULT_MIN_LEAD = 18;

export function roundRouteCoordinate(value) {
  return Math.round(Number(value) * 10) / 10;
}

function finitePoint(point) {
  return Boolean(point)
    && Number.isFinite(Number(point.x))
    && Number.isFinite(Number(point.y));
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function createThreeSegmentRoute(start, end, preferredCorridorX = null) {
  if (!finitePoint(start) || !finitePoint(end)) return "";

  const startX = roundRouteCoordinate(start.x);
  const startY = roundRouteCoordinate(start.y);
  const endX = roundRouteCoordinate(end.x);
  const endY = roundRouteCoordinate(end.y);
  const direction = endX >= startX ? 1 : -1;
  const distance = Math.abs(endX - startX);
  const minimum = Math.min(startX, endX);
  const maximum = Math.max(startX, endX);
  const lead = Math.min(DEFAULT_MIN_LEAD, distance / 2);
  const fallback = startX + ((endX - startX) / 2);
  const preferred = Number.isFinite(Number(preferredCorridorX))
    ? Number(preferredCorridorX)
    : fallback;
  const corridorX = distance === 0
    ? startX
    : roundRouteCoordinate(clamp(
      preferred,
      minimum + lead,
      maximum - lead,
    ));

  if (direction < 0 && corridorX > startX) return "";
  return `M ${startX} ${startY} H ${corridorX} V ${endY} H ${endX}`;
}

export function isRouteAnchorVisible(rect, viewportRect) {
  if (!rect || !viewportRect) return false;
  const centerX = rect.left + (rect.width / 2);
  const centerY = rect.top + (rect.height / 2);
  return centerX >= viewportRect.left
    && centerX <= viewportRect.right
    && centerY >= viewportRect.top
    && centerY <= viewportRect.bottom;
}

export function routeGeometryKey(geometry) {
  if (!geometry?.visible) return "hidden";
  return [
    geometry.path,
    geometry.start?.x,
    geometry.start?.y,
    geometry.end?.x,
    geometry.end?.y,
  ].join("|");
}
