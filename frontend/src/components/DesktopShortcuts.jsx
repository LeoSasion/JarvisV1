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
  advanceDesktopTypeahead,
  getDesktopKeyboardTarget,
} from "../desktop-keyboard-model.js";
import {
  refreshDesktopEntries,
  useDesktopEntries,
} from "../hooks/usePlatformData.js";
import {
  getFileDropMode,
  hasFileDrag,
  parseFileDrag,
  writeFileDrag,
} from "../file-drag-model.js";
import { platform } from "../platform/index.js";
import { DesktopContextMenu } from "./DesktopContextMenu.jsx";
import { DesktopOperationDialog } from "./DesktopOperationDialog.jsx";

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
  const {
    entries,
    userDesktopPath,
  } = useDesktopEntries();
  const containerRef = useRef(null);
  const menuRef = useRef(null);
  const shortcutRefs = useRef(new Map());
  const dragRef = useRef(null);
  const selectionAnchorRef = useRef(null);
  const marqueeRef = useRef(null);
  const suppressClickRef = useRef(null);
  const typeaheadRef = useRef({ query: "", timestamp: 0 });
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
  const [selectedIds, setSelectedIds] = useState(() => selectedId ? [selectedId] : []);
  const [focusedId, setFocusedId] = useState(selectedId ?? null);
  const [operationDialog, setOperationDialog] = useState(null);
  const [clipboardState, setClipboardState] = useState({ paths: [], mode: "copy" });
  const [marquee, setMarquee] = useState(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const iconMetrics = useMemo(() => getDesktopIconMetrics(iconSize), [iconSize]);
  const orderedEntries = useMemo(
    () => sortDesktopEntries(entries, sortMode),
    [entries, sortMode],
  );
  const selectedShortcuts = useMemo(
    () => orderedEntries.filter((entry) => selectedIds.includes(entry.id)),
    [orderedEntries, selectedIds],
  );
  const selectedPaths = useMemo(
    () => selectedShortcuts.map((entry) => entry.path).filter(Boolean),
    [selectedShortcuts],
  );
  const keyboardPositions = useMemo(
    () => orderedEntries.map((entry, index) => {
      const position = autoArrange
        ? getFallbackPosition(index, containerSize.height, iconMetrics)
        : manualPositions[entry.id] ??
          getFallbackPosition(index, containerSize.height, iconMetrics);
      return { id: entry.id, x: position.x, y: position.y };
    }),
    [
      autoArrange,
      containerSize.height,
      iconMetrics,
      manualPositions,
      orderedEntries,
    ],
  );

  useEffect(() => {
    setSelectedIds((current) => {
      const availableIds = new Set(orderedEntries.map((entry) => entry.id));
      const next = current.filter((id) => availableIds.has(id));
      if (next.length > 0 || !selectedId || !availableIds.has(selectedId)) return next;
      return [selectedId];
    });
  }, [orderedEntries, selectedId]);

  useEffect(() => {
    if (orderedEntries.length === 0) {
      setFocusedId(null);
      return;
    }
    setFocusedId((current) => (
      orderedEntries.some((entry) => entry.id === current)
        ? current
        : selectedId && orderedEntries.some((entry) => entry.id === selectedId)
          ? selectedId
          : orderedEntries[0].id
    ));
  }, [orderedEntries, selectedId]);

  const focusShortcutByIndex = useCallback((index, additive = false) => {
    const shortcut = orderedEntries[index];
    if (!shortcut) return;
    setFocusedId(shortcut.id);
    selectionAnchorRef.current = shortcut.id;
    setSelectedIds((current) => (
      additive ? [...new Set([...current, shortcut.id])] : [shortcut.id]
    ));
    onSelect(shortcut.id);
    window.requestAnimationFrame(() => shortcutRefs.current.get(shortcut.id)?.focus());
  }, [onSelect, orderedEntries]);

  const refreshClipboardState = useCallback(async () => {
    try {
      const state = await platform.clipboard.read();
      setClipboardState({
        paths: Array.isArray(state?.paths) ? state.paths : [],
        mode: state?.mode === "move" ? "move" : "copy",
      });
    } catch {
      setClipboardState({ paths: [], mode: "copy" });
    }
  }, []);

  useEffect(() => {
    void refreshClipboardState();
  }, [refreshClipboardState]);

  useEffect(() => {
    if (contextMenu?.kind === "desktop") void refreshClipboardState();
  }, [contextMenu?.kind, refreshClipboardState]);

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

  const selectShortcut = useCallback((event, shortcutId, index) => {
    const toggle = event.ctrlKey || event.metaKey;
    if (event.shiftKey && selectionAnchorRef.current !== null) {
      const anchorIndex = orderedEntries.findIndex(
        (entry) => entry.id === selectionAnchorRef.current,
      );
      if (anchorIndex >= 0) {
        const [start, end] = [anchorIndex, index].sort((a, b) => a - b);
        const range = orderedEntries.slice(start, end + 1).map((entry) => entry.id);
        setSelectedIds((current) => toggle ? [...new Set([...current, ...range])] : range);
        onSelect(shortcutId);
        return;
      }
    }
    selectionAnchorRef.current = shortcutId;
    setSelectedIds((current) => {
      if (!toggle) return [shortcutId];
      return current.includes(shortcutId)
        ? current.filter((id) => id !== shortcutId)
        : [...current, shortcutId];
    });
    onSelect(shortcutId);
  }, [onSelect, orderedEntries]);

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

  useEffect(() => {
    const beginMarquee = (event) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (!event.target.closest(".desktop-workspace")) return;
      if (event.target.closest(
        ".desktop-shortcut, .telemetry-rail, .core-voice-button, .desktop-context-menu, "
        + ".desktop-operation-dialog, .explorer-window, button, input, [role='dialog'], [role='menu']",
      )) return;
      const container = containerRef.current;
      const bounds = container?.getBoundingClientRect();
      if (!bounds ||
          event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) return;
      const originX = event.clientX - bounds.left;
      const originY = event.clientY - bounds.top;
      marqueeRef.current = {
        originX,
        originY,
        additive: event.ctrlKey || event.metaKey,
        baseline: selectedIds,
      };
      if (!marqueeRef.current.additive) {
        setSelectedIds([]);
        onSelect(null);
      }
      setContextMenu(null);
      setMarquee({ left: originX, top: originY, width: 0, height: 0 });
    };

    const moveMarquee = (event) => {
      const drag = marqueeRef.current;
      const container = containerRef.current;
      if (!drag || !container) return;
      const bounds = container.getBoundingClientRect();
      const currentX = clamp(event.clientX - bounds.left, 0, bounds.width);
      const currentY = clamp(event.clientY - bounds.top, 0, bounds.height);
      const rectangle = {
        left: Math.min(drag.originX, currentX),
        top: Math.min(drag.originY, currentY),
        width: Math.abs(currentX - drag.originX),
        height: Math.abs(currentY - drag.originY),
      };
      setMarquee(rectangle);
      const right = rectangle.left + rectangle.width;
      const bottom = rectangle.top + rectangle.height;
      const intersected = orderedEntries.filter((entry) => {
        const element = shortcutRefs.current.get(entry.id);
        if (!element) return false;
        const item = element.getBoundingClientRect();
        const itemLeft = item.left - bounds.left;
        const itemTop = item.top - bounds.top;
        return itemLeft < right &&
          itemLeft + item.width > rectangle.left &&
          itemTop < bottom &&
          itemTop + item.height > rectangle.top;
      }).map((entry) => entry.id);
      setSelectedIds(drag.additive
        ? [...new Set([...drag.baseline, ...intersected])]
        : intersected);
    };

    const finishMarquee = () => {
      if (!marqueeRef.current) return;
      marqueeRef.current = null;
      setMarquee(null);
    };

    window.addEventListener("pointerdown", beginMarquee);
    window.addEventListener("pointermove", moveMarquee);
    window.addEventListener("pointerup", finishMarquee);
    window.addEventListener("pointercancel", finishMarquee);
    return () => {
      window.removeEventListener("pointerdown", beginMarquee);
      window.removeEventListener("pointermove", moveMarquee);
      window.removeEventListener("pointerup", finishMarquee);
      window.removeEventListener("pointercancel", finishMarquee);
    };
  }, [onSelect, orderedEntries, selectedIds]);

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

  const startDesktopTransfer = useCallback(async (paths, mode = "copy") => {
    if (!userDesktopPath) {
      throw new Error("Windows 桌面目录当前不可用。");
    }
    const normalizedPaths = [...new Set(paths.filter(Boolean))]
      .filter((path) => path.toLocaleLowerCase() !== userDesktopPath.toLocaleLowerCase());
    if (normalizedPaths.length === 0) return null;
    await platform.explorer.preflightTransfer(normalizedPaths, userDesktopPath, mode);
    const job = await platform.explorer.startTransfer(
      normalizedPaths,
      userDesktopPath,
      mode,
      "rename",
    );
    onNotify(`${mode === "move" ? "移动" : "复制"}任务已启动 · ${normalizedPaths.length} 项`);
    return job;
  }, [onNotify, userDesktopPath]);

  const writeClipboard = useCallback(async (mode) => {
    if (selectedPaths.length === 0) return;
    try {
      await platform.clipboard.write(selectedPaths, mode);
      await refreshClipboardState();
      setContextMenu(null);
      onNotify(`${mode === "move" ? "已剪切" : "已复制"} ${selectedPaths.length} 项`);
    } catch (error) {
      onNotify(error?.message ?? "Windows 剪贴板暂时不可用");
    }
  }, [onNotify, refreshClipboardState, selectedPaths]);

  const pasteDesktop = useCallback(async () => {
    setContextMenu(null);
    const state = await platform.clipboard.read();
    const paths = Array.isArray(state?.paths) ? state.paths : [];
    if (paths.length === 0) {
      onNotify("剪贴板中没有可粘贴的文件");
      return;
    }
    await startDesktopTransfer(paths, state?.mode === "move" ? "move" : "copy");
    if (state?.mode === "move") {
      await platform.clipboard.clear();
      await refreshClipboardState();
    }
  }, [onNotify, refreshClipboardState, startDesktopTransfer]);

  const showNewFolderDialog = useCallback(() => {
    setContextMenu(null);
    setOperationDialog({
      type: "new-folder",
      title: "新建文件夹",
      inputLabel: "名称",
      initialValue: "新建文件夹",
    });
  }, []);

  const showRenameDialog = useCallback((shortcut) => {
    if (!shortcut?.path) return;
    setContextMenu(null);
    setOperationDialog({
      type: "rename",
      title: "重命名",
      inputLabel: "新名称",
      initialValue: shortcut.name ?? shortcut.label,
      shortcut,
    });
  }, []);

  const showDeleteDialog = useCallback(() => {
    if (selectedPaths.length === 0) return;
    setContextMenu(null);
    setOperationDialog({
      type: "delete",
      title: "移到回收站",
      description: `将 ${selectedPaths.length} 个项目移到 Windows 回收站？`,
      confirmLabel: "移到回收站",
      danger: true,
    });
  }, [selectedPaths.length]);

  const confirmOperation = useCallback(async (value) => {
    if (!operationDialog) return;
    if (operationDialog.type === "new-folder") {
      if (!userDesktopPath) throw new Error("Windows 桌面目录当前不可用。");
      await platform.explorer.createFolder(userDesktopPath, value);
      onNotify(`文件夹已创建 · ${value}`);
    } else if (operationDialog.type === "rename") {
      await platform.explorer.rename(operationDialog.shortcut.path, value);
      onNotify(`已重命名为 ${value}`);
    } else if (operationDialog.type === "delete") {
      await platform.explorer.recycle(selectedPaths);
      setSelectedIds([]);
      onNotify(`${selectedPaths.length} 项已移到回收站`);
    }
    setOperationDialog(null);
    await refreshDesktopEntries();
  }, [onNotify, operationDialog, selectedPaths, userDesktopPath]);

  useEffect(() => {
    const isDesktopDrop = (event) => (
      event.target instanceof Element &&
      event.target.closest(".desktop-workspace") &&
      !event.target.closest(".explorer-window")
    );
    const handleDragOver = (event) => {
      if (!isDesktopDrop(event) || !hasFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = getFileDropMode(event);
    };
    const handleDrop = (event) => {
      if (!isDesktopDrop(event)) return;
      const payload = parseFileDrag(event.dataTransfer);
      if (!payload) return;
      event.preventDefault();
      void startDesktopTransfer(payload.paths, getFileDropMode(event)).catch((error) => {
        onNotify(error?.message ?? "拖放操作失败");
      });
    };
    const stopExternalDrop = platform.events.subscribe("desktop.externalDrop", (payload) => {
      const paths = Array.isArray(payload?.paths) ? payload.paths : [];
      const dropTarget = Number.isFinite(payload?.clientX) && Number.isFinite(payload?.clientY)
        ? document.elementFromPoint(payload.clientX, payload.clientY)
        : null;
      if (dropTarget?.closest(".jarvis-explorer")) return;
      void startDesktopTransfer(paths, "copy").catch((error) => {
        onNotify(error?.message ?? "Windows 拖放操作失败");
      });
    });
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
    return () => {
      stopExternalDrop();
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, [onNotify, startDesktopTransfer]);

  useEffect(() => {
    const handleDesktopKeys = (event) => {
      if (!(event.target instanceof Element) ||
          event.target.closest(
            "input, textarea, [contenteditable='true'], [role='dialog'], .explorer-layer, .shell-panel-layer",
          )) return;
      if (!event.target.closest(".jarvis-shell") && event.target !== document.body) return;
      const key = event.key.toLocaleLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "a") {
        event.preventDefault();
        setSelectedIds(orderedEntries.map((entry) => entry.id));
      } else if ((event.ctrlKey || event.metaKey) && key === "c") {
        event.preventDefault();
        void writeClipboard("copy");
      } else if ((event.ctrlKey || event.metaKey) && key === "x") {
        event.preventDefault();
        void writeClipboard("move");
      } else if ((event.ctrlKey || event.metaKey) && key === "v") {
        event.preventDefault();
        void pasteDesktop().catch((error) => onNotify(error?.message ?? "粘贴失败"));
      } else if (event.key === "Delete") {
        event.preventDefault();
        showDeleteDialog();
      } else if (event.key === "F2" && selectedShortcuts.length === 1) {
        event.preventDefault();
        showRenameDialog(selectedShortcuts[0]);
      }
    };
    window.addEventListener("keydown", handleDesktopKeys);
    return () => window.removeEventListener("keydown", handleDesktopKeys);
  }, [
    onNotify,
    orderedEntries,
    pasteDesktop,
    selectedShortcuts,
    showDeleteDialog,
    showRenameDialog,
    writeClipboard,
  ]);

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
    ? orderedEntries.find((entry) => entry.id === contextMenu.shortcutId) ?? selectedShortcuts[0] ?? null
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
        const selected = selectedIds.includes(shortcut.id);
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
            className={[
              "desktop-shortcut",
              selected ? "is-selected" : "",
              clipboardState.mode === "move" &&
                clipboardState.paths.some((path) =>
                  path.toLocaleLowerCase() === shortcut.path?.toLocaleLowerCase())
                ? "is-cut"
                : "",
            ].filter(Boolean).join(" ")}
            aria-pressed={selected}
            title={shortcut.label}
            tabIndex={focusedId === shortcut.id ? 0 : -1}
            draggable={Boolean(shortcut.path)}
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
              setFocusedId(shortcut.id);
              selectShortcut(event, shortcut.id, index);
            }}
            onDoubleClick={() => onOpen(shortcut)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!selectedIds.includes(shortcut.id)) {
                setSelectedIds([shortcut.id]);
                selectionAnchorRef.current = shortcut.id;
                onSelect(shortcut.id);
              }
              setFocusedId(shortcut.id);
              openContextMenu(event.clientX, event.clientY, "item", shortcut.id);
            }}
            onDragStart={(event) => {
              const paths = selected && selectedPaths.length > 0
                ? selectedPaths
                : shortcut.path ? [shortcut.path] : [];
              if (!writeFileDrag(event.dataTransfer, paths, "desktop")) {
                event.preventDefault();
              }
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
              if ([
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
              ].includes(event.key)) {
                event.preventDefault();
                const targetIndex = getDesktopKeyboardTarget(
                  keyboardPositions,
                  index,
                  event.key,
                );
                focusShortcutByIndex(targetIndex, event.shiftKey);
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                onOpen(shortcut);
                return;
              }
              if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                event.preventDefault();
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                if (!selectedIds.includes(shortcut.id)) {
                  setSelectedIds([shortcut.id]);
                  selectionAnchorRef.current = shortcut.id;
                  onSelect(shortcut.id);
                }
                openContextMenu(
                  rect.left + Math.min(rect.width, 48),
                  rect.top + Math.min(rect.height, 48),
                  "item",
                  shortcut.id,
                );
                return;
              }
              if (!event.ctrlKey &&
                  !event.metaKey &&
                  !event.altKey &&
                  event.key.length === 1) {
                const next = advanceDesktopTypeahead(
                  orderedEntries,
                  index,
                  typeaheadRef.current,
                  event.key,
                  Date.now(),
                );
                typeaheadRef.current = next;
                if (next.index >= 0 && next.index !== index) {
                  event.preventDefault();
                  focusShortcutByIndex(next.index);
                }
              }
            }}
          >
            <span className="shortcut-icon" aria-hidden="true"><Icon /></span>
            <span className="shortcut-label">{shortcut.label}</span>
          </button>
        );
      })}
      {marquee ? (
        <span
          className="desktop-selection-marquee"
          aria-hidden="true"
          style={{
            left: `${marquee.left}px`,
            top: `${marquee.top}px`,
            width: `${marquee.width}px`,
            height: `${marquee.height}px`,
          }}
        />
      ) : null}
      {contextMenu ? (
        <DesktopContextMenu
          alignToGrid={alignToGrid}
          autoArrange={autoArrange}
          iconSize={iconSize}
          menu={contextMenu}
          menuRef={menuRef}
          onClose={closeContextMenu}
          onCopy={() => void writeClipboard("copy")}
          onCopyPath={(shortcut) => runItemAction(onCopyPath, shortcut)}
          onCut={() => void writeClipboard("move")}
          onDelete={showDeleteDialog}
          onNewFolder={showNewFolderDialog}
          onOpen={(shortcut) => runItemAction(onOpen, shortcut)}
          onOpenLocation={(shortcut) => runItemAction(onOpenLocation, shortcut)}
          onOpenSettings={() => {
            setContextMenu(null);
            onOpenSettings();
          }}
          onPaste={() => void pasteDesktop().catch((error) => {
            onNotify(error?.message ?? "粘贴失败");
          })}
          onProperties={(shortcut) => {
            setContextMenu(null);
            if (shortcut?.path) {
              void platform.explorer.showProperties(shortcut.path).catch((error) => {
                onNotify(error?.message ?? "无法打开属性");
              });
            }
          }}
          onRefresh={refreshDesktop}
          onRename={showRenameDialog}
          onSetIconSize={setDesktopIconSize}
          onSetSortMode={setDesktopSortMode}
          onToggleAlignToGrid={toggleAlignToGrid}
          onToggleAutoArrange={toggleAutoArrange}
          shortcut={selectedContextShortcut}
          selectionCount={selectedShortcuts.length}
          sortMode={sortMode}
          canPaste={clipboardState.paths.length > 0 && Boolean(userDesktopPath)}
        />
      ) : null}
      {operationDialog ? (
        <DesktopOperationDialog
          confirmLabel={operationDialog.confirmLabel}
          danger={operationDialog.danger}
          description={operationDialog.description}
          initialValue={operationDialog.initialValue}
          inputLabel={operationDialog.inputLabel}
          onCancel={() => setOperationDialog(null)}
          onConfirm={confirmOperation}
          title={operationDialog.title}
        />
      ) : null}
    </nav>
  );
}
