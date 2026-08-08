export function isHelpShortcut(eventLike = {}) {
  return eventLike.key === "F1"
    && eventLike.altKey !== true
    && eventLike.ctrlKey !== true
    && eventLike.metaKey !== true
    && eventLike.shiftKey !== true
    && eventLike.repeat !== true
    && eventLike.defaultPrevented !== true;
}
