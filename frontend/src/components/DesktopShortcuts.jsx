import {
  ArrowDownloadRegular,
  CodeRegular,
  DeleteRegular,
  DesktopRegular,
  DocumentRegular,
  FolderRegular,
  HardDriveRegular,
  NotepadRegular,
  SettingsRegular,
  WindowConsoleRegular,
} from "@fluentui/react-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDesktopEntries } from "../hooks/usePlatformData.js";

const AUTO_ARRANGE_STORAGE_KEY = "jarvis.desktop.auto-arrange.v1";
const MANUAL_POSITIONS_STORAGE_KEY = "jarvis.desktop.icon-positions.v1";
const ICON_CELL_WIDTH = 96;
const ICON_CELL_HEIGHT = 88;
const ICON_GRID_PADDING = 18;

function readAutoArrangePreference() {
  try {
    return window.localStorage.getItem(AUTO_ARRANGE_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function readManualPositions() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MANUAL_POSITIONS_STORAGE_KEY) ?? "null");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function getFallbackPosition(index, height) {
  const availableHeight = Math.max(ICON_CELL_HEIGHT, height - ICON_GRID_PADDING * 2);
  const rowCount = Math.max(1, Math.floor(availableHeight / ICON_CELL_HEIGHT));
  return {
    x: ICON_GRID_PADDING + Math.floor(index / rowCount) * ICON_CELL_WIDTH,
    y: ICON_GRID_PADDING + (index % rowCount) * ICON_CELL_HEIGHT,
  };
}

const iconMap = {
  desktop: DesktopRegular,
  folder: FolderRegular,
  drive: HardDriveRegular,
  download: ArrowDownloadRegular,
  terminal: WindowConsoleRegular,
  recycle: DeleteRegular,
  document: DocumentRegular,
  code: CodeRegular,
  notes: NotepadRegular,
  settings: SettingsRegular,
};

export function DesktopShortcuts({ selectedId, onSelect, onOpen }) {
  const { entries } = useDesktopEntries();
  const containerRef = useRef(null);
  const menuRef = useRef(null);
  const shortcutRefs = useRef(new Map());
  const dragRef = useRef(null);
  const suppressClickRef = useRef(null);
  const [autoArrange, setAutoArrange] = useState(readAutoArrangePreference);
  const [manualPositions, setManualPositions] = useState(readManualPositions);
  const [contextMenu, setContextMenu] = useState(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const openContextMenu = useCallback((clientX, clientY) => {
    setContextMenu({
      x: clamp(clientX, 8, window.innerWidth - 232),
      y: clamp(clientY, 8, window.innerHeight - 104),
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const updateSize = () => {
      const next = { width: container.clientWidth, height: container.clientHeight };
      setContainerSize((current) =>
        current.width === next.width && current.height === next.height ? current : next);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(AUTO_ARRANGE_STORAGE_KEY, String(autoArrange));
    } catch {
      // Desktop layout remains usable when browser storage is unavailable.
    }
  }, [autoArrange]);

  useEffect(() => {
    if (autoArrange) return;
    const persistTimer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(MANUAL_POSITIONS_STORAGE_KEY, JSON.stringify(manualPositions));
      } catch {
        // Manual positions can remain session-only when storage is unavailable.
      }
    }, 120);
    return () => window.clearTimeout(persistTimer);
  }, [autoArrange, manualPositions]);

  useEffect(() => {
    if (autoArrange || containerSize.width <= 0 || containerSize.height <= 0) return;
    const maximumX = containerSize.width - ICON_CELL_WIDTH;
    const maximumY = containerSize.height - ICON_CELL_HEIGHT;
    setManualPositions((current) => {
      let changed = false;
      const next = { ...current };
      entries.forEach((entry, index) => {
        const position = current[entry.id] ?? getFallbackPosition(index, containerSize.height);
        const clampedPosition = {
          x: clamp(position.x, 0, maximumX),
          y: clamp(position.y, 0, maximumY),
        };
        if (position.x !== clampedPosition.x || position.y !== clampedPosition.y) changed = true;
        next[entry.id] = clampedPosition;
      });
      return changed ? next : current;
    });
  }, [autoArrange, containerSize.height, containerSize.width, entries]);

  useEffect(() => {
    const openDesktopMenu = (event) => {
      if (!(event.target instanceof Element)) return;
      const workspace = event.target.closest(".desktop-workspace");
      const isInteractive = event.target.closest(
        ".desktop-shortcut, .telemetry-rail, button, input, [role='dialog'], [role='menu']",
      );
      if (!workspace || isInteractive) return;
      event.preventDefault();
      openContextMenu(event.clientX, event.clientY);
    };
    const closeDesktopMenu = (event) => {
      if (!menuRef.current?.contains(event.target)) setContextMenu(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    const closeOnResize = () => setContextMenu(null);
    window.addEventListener("contextmenu", openDesktopMenu);
    window.addEventListener("pointerdown", closeDesktopMenu);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnResize);
    return () => {
      window.removeEventListener("contextmenu", openDesktopMenu);
      window.removeEventListener("pointerdown", closeDesktopMenu);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [openContextMenu]);

  const captureArrangedPositions = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const nextPositions = {};
    entries.forEach((entry) => {
      const shortcut = shortcutRefs.current.get(entry.id);
      if (!shortcut) return;
      const rect = shortcut.getBoundingClientRect();
      nextPositions[entry.id] = {
        x: rect.left - containerRect.left,
        y: rect.top - containerRect.top,
      };
    });
    setManualPositions(nextPositions);
  }, [entries]);

  const toggleAutoArrange = useCallback(() => {
    if (autoArrange) captureArrangedPositions();
    setAutoArrange((current) => !current);
    setContextMenu(null);
  }, [autoArrange, captureArrangedPositions]);

  const moveShortcut = useCallback((event, shortcutId) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== shortcutId || drag.pointerId !== event.pointerId) return;
    const shortcut = shortcutRefs.current.get(shortcutId);
    const maximumX = containerSize.width - (shortcut?.offsetWidth ?? ICON_CELL_WIDTH);
    const maximumY = containerSize.height - (shortcut?.offsetHeight ?? ICON_CELL_HEIGHT);
    const deltaX = event.clientX - drag.pointerX;
    const deltaY = event.clientY - drag.pointerY;
    if (!drag.moved && Math.abs(deltaX) + Math.abs(deltaY) <= 3) return;
    drag.moved = true;
    drag.currentX = clamp(drag.originX + deltaX, 0, maximumX);
    drag.currentY = clamp(drag.originY + deltaY, 0, maximumY);
    if (shortcut) {
      shortcut.style.left = `${drag.currentX}px`;
      shortcut.style.top = `${drag.currentY}px`;
    }
  }, [containerSize.height, containerSize.width]);

  const finishShortcutMove = useCallback((event, shortcutId) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== shortcutId || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      if (event.type === "pointerup") suppressClickRef.current = shortcutId;
      setManualPositions((current) => ({
        ...current,
        [shortcutId]: { x: drag.currentX, y: drag.currentY },
      }));
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return (
    <nav
      ref={containerRef}
      className={`desktop-shortcuts ${autoArrange ? "is-auto-arranged" : "is-manual"}`}
      aria-label="Desktop shortcuts"
      data-auto-arrange={autoArrange ? "on" : "off"}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        const rect = containerRef.current?.getBoundingClientRect();
        openContextMenu((rect?.left ?? 0) + 24, (rect?.top ?? 0) + 24);
      }}
    >
      {entries.map((shortcut, index) => {
        const Icon = iconMap[shortcut.icon] ?? DocumentRegular;
        const selected = selectedId === shortcut.id;
        const manualPosition = manualPositions[shortcut.id]
          ?? getFallbackPosition(index, containerSize.height);
        return (
          <button
            key={shortcut.id}
            ref={(element) => {
              if (element) shortcutRefs.current.set(shortcut.id, element);
              else shortcutRefs.current.delete(shortcut.id);
            }}
            type="button"
            className={`desktop-shortcut ${selected ? "is-selected" : ""}`}
            aria-pressed={selected}
            title={shortcut.label}
            style={autoArrange ? undefined : {
              left: `${manualPosition.x}px`,
              top: `${manualPosition.y}px`,
            }}
            onClick={(event) => {
              if (suppressClickRef.current === shortcut.id) {
                suppressClickRef.current = null;
                event.preventDefault();
                return;
              }
              onSelect(shortcut.id);
            }}
            onDoubleClick={() => onOpen(shortcut)}
            onPointerDown={(event) => {
              if (autoArrange || event.button !== 0) return;
              const position = manualPositions[shortcut.id]
                ?? getFallbackPosition(index, containerSize.height);
              dragRef.current = {
                id: shortcut.id,
                pointerId: event.pointerId,
                pointerX: event.clientX,
                pointerY: event.clientY,
                originX: position.x,
                originY: position.y,
                currentX: position.x,
                currentY: position.y,
                moved: false,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => moveShortcut(event, shortcut.id)}
            onPointerUp={(event) => finishShortcutMove(event, shortcut.id)}
            onPointerCancel={(event) => finishShortcutMove(event, shortcut.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onOpen(shortcut);
              }
            }}
          >
            <span className="shortcut-icon" aria-hidden="true"><Icon /></span>
            <span className="shortcut-label">{shortcut.label}</span>
          </button>
        );
      })}
      {contextMenu ? (
        <section
          ref={menuRef}
          className="desktop-context-menu"
          role="menu"
          aria-label="Desktop commands"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
        >
          <header><span>DESKTOP</span><small>ICON LAYOUT</small></header>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={autoArrange}
            onClick={toggleAutoArrange}
          >
            <span className="desktop-menu-check" aria-hidden="true">{autoArrange ? "✓" : ""}</span>
            <span>自动排列图标</span>
          </button>
        </section>
      ) : null}
    </nav>
  );
}
