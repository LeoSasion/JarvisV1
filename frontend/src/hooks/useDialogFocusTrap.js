import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

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
    const initial = initialFocusRef?.current ?? getFocusable()[0];
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
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [active, containerRef, initialFocusRef]);
}
