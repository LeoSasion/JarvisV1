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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clampDesktopCoordinate as clamp,
  getDesktopContextMenuPosition,
  getDesktopFallbackPosition as getFallbackPosition,
  getDesktopIconMetrics,
  snapDesktopPosition,
  sortDesktopEntries,
} from "../desktop-layout.js";
import {
  refreshDesktopEntries,
  useDesktopEntries,
} from "../hooks/usePlatformData.js";
import { DesktopContextMenu } from "./DesktopContextMenu.jsx";

const AUTO_ARRANGE_STORAGE_KEY = "jarvis.desktop.auto-arrange.v1";
const MANUAL_POSITIONS_STORAGE_KEY = "jarvis.desktop.icon-positions.v1";
const ALIGN_TO_GRID_STORAGE_KEY = "jarvis.desktop.align-to-grid.v1";
const ICON_SIZE_STORAGE_KEY = "jarvis.desktop.icon-size.v1";
const SORT_MODE_STORAGE_KEY = "jarvis.desktop.sort-mode.v1";

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

function readBooleanPreference(key, fallback) {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : stored !== "false";
  } catch {
    return fallback;
  }
}

function readEnumPreference(key, choices, fallback) {
  try {
    const stored = window.localStorage.getItem(key);
    return choices.includes(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
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

export function DesktopShortcuts({
  selectedId,
  onSelect,
  onOpen,
  onOpenLocation,
  onCopyPath,
  onOpenSettings,
  onNotify,
}) {
  const { entries } = useDesktopEntries();
  const containerRef = useRef(null);
  const menuRef = useRef(null);
  const shortcutRefs = useRef(new Map());
  const dragRef = useRef(null);
  const suppressClickRef = useRef(null);
  const [autoArrange, setAutoArrange] = useState(readAutoArrangePreference);
  const [alignToGrid, setAlignToGrid] = useState(
    () => readBooleanPreference(ALIGN_TO_GRID_STORAGE_KEY, true),
  );
  const [iconSize, setIconSize] = useState(
    () => readEnumPreference(ICON_SIZE_STORAGE_KEY, ["small", "medium", "large"], "medium"),
  );
  const [sortMode, setSortMode] = useState(
    () => readEnumPreference(SORT_MODE_STORAGE_KEY, ["none", "name", "type", "source"], "none"),
  );
  const [manualPositions, setManualPositions] = useState(readManualPositions);
  const [contextMenu, setContextMenu] = useState(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const iconMetrics = useMemo(() => getDesktopIconMetrics(iconSize), [iconSize]);
  const orderedEntries = useMemo(
    () => sortDesktopEntries(entries, sortMode),
    [entries, sortMode],
  );

  const openContextMenu = useCallback((clientX, clientY, kind = "desktop", shortcutId = null) => {
    setContextMenu({
      ...getDesktopContextMenuPosition({
        clientX,
        clientY,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        kind,
      }),
      kind,
      shortcutId,
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
    try {
      window.localStorage.setItem(ALIGN_TO_GRID_STORAGE_KEY, String(alignToGrid));
      window.localStorage.setItem(ICON_SIZE_STORAGE_KEY, iconSize);
      window.localStorage.setItem(SORT_MODE_STORAGE_KEY, sortMode);
    } catch {
      // Desktop preferences remain available for the current session.
    }
  }, [alignToGrid, iconSize, sortMode]);

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
    const maximumX = containerSize.width - iconMetrics.cellWidth;
    const maximumY = containerSize.height - iconMetrics.cellHeight;
    setManualPositions((current) => {
      let changed = false;
      const next = { ...current };
      orderedEntries.forEach((entry, index) => {
        const position = current[entry.id]
          ?? getFallbackPosition(index, containerSize.height, iconMetrics);
        const nextPosition = alignToGrid
          ? snapDesktopPosition(position, iconMetrics, containerSize)
          : {
              x: clamp(position.x, 0, maximumX),
              y: clamp(position.y, 0, maximumY),
            };
        if (position.x !== nextPosition.x || position.y !== nextPosition.y) changed = true;
        next[entry.id] = nextPosition;
      });
      return changed ? next : current;
    });
  }, [
    alignToGrid,
    autoArrange,
    containerSize,
    iconMetrics,
    orderedEntries,
  ]);

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
    orderedEntries.forEach((entry) => {
      const shortcut = shortcutRefs.current.get(entry.id);
      if (!shortcut) return;
      const rect = shortcut.getBoundingClientRect();
      nextPositions[entry.id] = {
        x: rect.left - containerRect.left,
        y: rect.top - containerRect.top,
      };
    });
    setManualPositions(nextPositions);
  }, [orderedEntries]);

  const toggleAutoArrange = useCallback(() => {
    if (autoArrange) captureArrangedPositions();
    setAutoArrange((current) => !current);
    setContextMenu(null);
  }, [autoArrange, captureArrangedPositions]);

  const toggleAlignToGrid = useCallback(() => {
    const nextAlignToGrid = !alignToGrid;
    if (nextAlignToGrid && !autoArrange) {
      setManualPositions((current) => Object.fromEntries(
        Object.entries(current).map(([id, position]) => [
          id,
          snapDesktopPosition(position, iconMetrics, containerSize),
        ]),
      ));
    }
    setAlignToGrid(nextAlignToGrid);
    setContextMenu(null);
  }, [alignToGrid, autoArrange, containerSize, iconMetrics]);

  const setDesktopIconSize = useCallback((size) => {
    setIconSize(size);
    setContextMenu(null);
  }, []);

  const setDesktopSortMode = useCallback((mode) => {
    setSortMode(mode);
    setAutoArrange(true);
    setContextMenu(null);
  }, []);

  const refreshDesktop = useCallback(async () => {
    setContextMenu(null);
    await refreshDesktopEntries();
    onNotify("桌面已刷新");
  }, [onNotify]);

  const moveShortcut = useCallback((event, shortcutId) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== shortcutId || drag.pointerId !== event.pointerId) return;
    const shortcut = shortcutRefs.current.get(shortcutId);
    const maximumX = containerSize.width - (shortcut?.offsetWidth ?? iconMetrics.cellWidth);
    const maximumY = containerSize.height - (shortcut?.offsetHeight ?? iconMetrics.cellHeight);
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
  }, [containerSize.height, containerSize.width, iconMetrics.cellHeight, iconMetrics.cellWidth]);

  const finishShortcutMove = useCallback((event, shortcutId) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== shortcutId || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      if (event.type === "pointerup") suppressClickRef.current = shortcutId;
      const position = alignToGrid
        ? snapDesktopPosition(
            { x: drag.currentX, y: drag.currentY },
            iconMetrics,
            containerSize,
          )
        : { x: drag.currentX, y: drag.currentY };
      const shortcut = shortcutRefs.current.get(shortcutId);
      if (shortcut) {
        shortcut.style.left = `${position.x}px`;
        shortcut.style.top = `${position.y}px`;
      }
      setManualPositions((current) => ({
        ...current,
        [shortcutId]: position,
      }));
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [alignToGrid, containerSize, iconMetrics]);

  const selectedContextShortcut = contextMenu?.kind === "item"
    ? orderedEntries.find((entry) => entry.id === contextMenu.shortcutId) ?? null
    : null;

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const runItemAction = useCallback((action, shortcut) => {
    setContextMenu(null);
    if (shortcut) void action(shortcut);
  }, []);

  return (
    <nav
      ref={containerRef}
      className={`desktop-shortcuts ${autoArrange ? "is-auto-arranged" : "is-manual"}`}
      aria-label="Desktop shortcuts"
      data-auto-arrange={autoArrange ? "on" : "off"}
      data-align-to-grid={alignToGrid ? "on" : "off"}
      data-icon-size={iconSize}
      data-sort-mode={sortMode}
      style={{
        "--desktop-icon-cell-width": `${iconMetrics.cellWidth}px`,
        "--desktop-icon-cell-height": `${iconMetrics.cellHeight}px`,
        "--desktop-icon-size": `${iconMetrics.iconSize}px`,
        "--desktop-label-size": `${iconMetrics.labelSize}px`,
      }}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        const rect = containerRef.current?.getBoundingClientRect();
        openContextMenu((rect?.left ?? 0) + 24, (rect?.top ?? 0) + 24);
      }}
    >
      {orderedEntries.map((shortcut, index) => {
        const Icon = iconMap[shortcut.icon] ?? DocumentRegular;
        const selected = selectedId === shortcut.id;
        const manualPosition = manualPositions[shortcut.id]
          ?? getFallbackPosition(index, containerSize.height, iconMetrics);
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
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelect(shortcut.id);
              openContextMenu(event.clientX, event.clientY, "item", shortcut.id);
            }}
            onPointerDown={(event) => {
              if (autoArrange || event.button !== 0) return;
              const position = manualPositions[shortcut.id]
                ?? getFallbackPosition(index, containerSize.height, iconMetrics);
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
                return;
              }
              if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                event.preventDefault();
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                onSelect(shortcut.id);
                openContextMenu(
                  rect.left + Math.min(rect.width, 48),
                  rect.top + Math.min(rect.height, 48),
                  "item",
                  shortcut.id,
                );
              }
            }}
          >
            <span className="shortcut-icon" aria-hidden="true"><Icon /></span>
            <span className="shortcut-label">{shortcut.label}</span>
          </button>
        );
      })}
      {contextMenu ? (
        <DesktopContextMenu
          alignToGrid={alignToGrid}
          autoArrange={autoArrange}
          iconSize={iconSize}
          menu={contextMenu}
          menuRef={menuRef}
          onClose={closeContextMenu}
          onCopyPath={(shortcut) => runItemAction(onCopyPath, shortcut)}
          onOpen={(shortcut) => runItemAction(onOpen, shortcut)}
          onOpenLocation={(shortcut) => runItemAction(onOpenLocation, shortcut)}
          onOpenSettings={() => {
            setContextMenu(null);
            onOpenSettings();
          }}
          onRefresh={refreshDesktop}
          onSetIconSize={setDesktopIconSize}
          onSetSortMode={setDesktopSortMode}
          onToggleAlignToGrid={toggleAlignToGrid}
          onToggleAutoArrange={toggleAutoArrange}
          shortcut={selectedContextShortcut}
          sortMode={sortMode}
        />
      ) : null}
    </nav>
  );
}
