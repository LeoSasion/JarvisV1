export const JARVIS_FILE_DRAG_MIME = "application/x-jarvis-file-paths";
const MAX_DRAG_ITEMS = 128;

export function normalizeDraggedPaths(paths) {
  if (!Array.isArray(paths)) return [];
  const unique = new Set();
  for (const path of paths) {
    const normalized = String(path ?? "").trim();
    if (!normalized || normalized.length > 32_767) continue;
    unique.add(normalized);
    if (unique.size >= MAX_DRAG_ITEMS) break;
  }
  return [...unique];
}

export function serializeFileDrag(paths, source = "jarvis") {
  const normalizedPaths = normalizeDraggedPaths(paths);
  if (normalizedPaths.length === 0) return "";
  return JSON.stringify({
    version: 1,
    source,
    paths: normalizedPaths,
  });
}

export function parseFileDrag(dataTransfer) {
  if (!dataTransfer) return null;
  const rawPayload = dataTransfer.getData(JARVIS_FILE_DRAG_MIME);
  if (!rawPayload) return null;
  try {
    const payload = JSON.parse(rawPayload);
    const paths = normalizeDraggedPaths(payload?.paths);
    if (payload?.version !== 1 || paths.length === 0) return null;
    return {
      source: String(payload.source ?? "jarvis"),
      paths,
    };
  } catch {
    return null;
  }
}

export function hasFileDrag(dataTransfer) {
  if (!dataTransfer?.types) return false;
  return Array.from(dataTransfer.types).includes(JARVIS_FILE_DRAG_MIME);
}

export function getFileDropMode(event) {
  return event?.shiftKey ? "move" : "copy";
}

export function writeFileDrag(dataTransfer, paths, source) {
  const payload = serializeFileDrag(paths, source);
  if (!payload || !dataTransfer) return false;
  dataTransfer.effectAllowed = "copyMove";
  dataTransfer.setData(JARVIS_FILE_DRAG_MIME, payload);
  dataTransfer.setData("text/plain", normalizeDraggedPaths(paths).join("\r\n"));
  return true;
}
