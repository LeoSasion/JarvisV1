import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function getFocusLoopTargetIndex(activeIndex, itemCount, reverse = false) {
  if (!Number.isInteger(itemCount) || itemCount <= 0) return -1;
  if (!Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= itemCount) {
    return reverse ? itemCount - 1 : 0;
  }
  if (reverse && activeIndex === 0) return itemCount - 1;
  if (!reverse && activeIndex === itemCount - 1) return 0;
  return -1;
}

export function useDialogFocusTrap(containerRef, active, { initialFocusRef = null, onEscape = null } = {}) {
  const escapeHandlerRef = useRef(onEscape);
  escapeHandlerRef.current = onEscape;

  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const previous = document.activeElement;
    const getFocusable = () => [...container.querySelectorAll(FOCUSABLE_SELECTOR)]
      .filter((element) => element.getClientRects().length > 0);
    const initial = initialFocusRef?.current ??
      container.querySelector("[data-dialog-initial-focus='true']") ??
      getFocusable()[0];
    initial?.focus();
    initial?.select?.();

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && escapeHandlerRef.current) {
        event.preventDefault();
        escapeHandlerRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const activeIndex = focusable.indexOf(document.activeElement);
      const targetIndex = getFocusLoopTargetIndex(
        activeIndex,
        focusable.length,
        event.shiftKey,
      );
      if (targetIndex >= 0) {
        event.preventDefault();
        focusable[targetIndex].focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [active, containerRef, initialFocusRef]);
}
