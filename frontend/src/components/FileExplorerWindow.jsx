import {
  ArchiveRegular,
  ArrowClockwiseRegular,
  ArrowDownloadRegular,
  ArrowLeftRegular,
  ArrowRightRegular,
  ArrowUpRegular,
  ClipboardPasteRegular,
  CodeRegular,
  CopyRegular,
  CutRegular,
  DeleteRegular,
  DesktopRegular,
  DismissRegular,
  DocumentPdfRegular,
  DocumentRegular,
  DocumentTableRegular,
  FolderAddRegular,
  FolderRegular,
  GridRegular,
  HardDriveRegular,
  HomeRegular,
  ImageRegular,
  ListRegular,
  MoreHorizontalRegular,
  MusicNote2Regular,
  OpenRegular,
  RenameRegular,
  SearchRegular,
  SlideTextRegular,
  VideoRegular,
} from "@fluentui/react-icons";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { platform } from "../platform/index.js";
import { useDialogFocusTrap } from "../hooks/useDialogFocusTrap.js";

const EMPTY_SNAPSHOT = {
  currentPath: "",
  parentPath: null,
  entries: [],
  locations: [],
  drives: [],
  breadcrumbs: [],
  warning: null,
};

const locationIcons = {
  home: HomeRegular,
  desktop: DesktopRegular,
  download: ArrowDownloadRegular,
  document: DocumentRegular,
  image: ImageRegular,
};

const entryIcons = {
  archive: ArchiveRegular,
  audio: MusicNote2Regular,
  code: CodeRegular,
  document: DocumentRegular,
  file: DocumentRegular,
  folder: FolderRegular,
  image: ImageRegular,
  pdf: DocumentPdfRegular,
  presentation: SlideTextRegular,
  spreadsheet: DocumentTableRegular,
  video: VideoRegular,
};

const modifiedDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function read(object, camelKey, pascalKey) {
  return object?.[camelKey] ?? object?.[pascalKey];
}

function normalizeSnapshot(result) {
  const entries = read(result, "entries", "Entries") ?? [];
  const locations = read(result, "locations", "Locations") ?? [];
  const drives = read(result, "drives", "Drives") ?? [];
  const breadcrumbs = read(result, "breadcrumbs", "Breadcrumbs") ?? [];

  return {
    currentPath: String(read(result, "currentPath", "CurrentPath") ?? ""),
    parentPath: read(result, "parentPath", "ParentPath") ?? null,
    warning: read(result, "warning", "Warning") ?? null,
    entries: entries.map((entry) => ({
      name: String(read(entry, "name", "Name") ?? "Unnamed item"),
      path: String(read(entry, "path", "Path") ?? ""),
      isDirectory: Boolean(read(entry, "isDirectory", "IsDirectory")),
      kind: String(read(entry, "kind", "Kind") ?? "file"),
      typeLabel: String(read(entry, "typeLabel", "TypeLabel") ?? "File"),
      extension: String(read(entry, "extension", "Extension") ?? ""),
      sizeBytes: read(entry, "sizeBytes", "SizeBytes") ?? null,
      modified: read(entry, "modified", "Modified") ?? null,
      isLinked: Boolean(read(entry, "isLinked", "IsLinked")),
    })),
    locations: locations.map((location) => ({
      id: String(read(location, "id", "Id") ?? "location"),
      label: String(read(location, "label", "Label") ?? "Location"),
      path: String(read(location, "path", "Path") ?? ""),
      kind: String(read(location, "kind", "Kind") ?? "folder"),
    })),
    drives: drives.map((drive) => ({
      id: String(read(drive, "id", "Id") ?? read(drive, "path", "Path") ?? "drive"),
      label: String(read(drive, "label", "Label") ?? "Local drive"),
      path: String(read(drive, "path", "Path") ?? ""),
      driveType: String(read(drive, "driveType", "DriveType") ?? "Fixed"),
      totalBytes: Number(read(drive, "totalBytes", "TotalBytes") ?? 0),
      freeBytes: Number(read(drive, "freeBytes", "FreeBytes") ?? 0),
    })),
    breadcrumbs: breadcrumbs.map((breadcrumb) => ({
      label: String(read(breadcrumb, "label", "Label") ?? ""),
      path: String(read(breadcrumb, "path", "Path") ?? ""),
    })),
  };
}

function normalizeOperation(result) {
  const items = read(result, "items", "Items") ?? [];
  const failures = read(result, "failures", "Failures") ?? [];
  return {
    operation: String(read(result, "operation", "Operation") ?? "operation"),
    items: items.map((item) => ({
      source: String(read(item, "source", "Source") ?? ""),
      target: String(read(item, "target", "Target") ?? ""),
      name: String(read(item, "name", "Name") ?? ""),
    })),
    failures: failures.map((failure) => ({
      source: String(read(failure, "source", "Source") ?? ""),
      code: String(read(failure, "code", "Code") ?? "OPERATION_FAILED"),
      message: String(read(failure, "message", "Message") ?? "Windows could not complete the operation."),
    })),
  };
}

function formatFileSize(bytes) {
  if (bytes === null || bytes === undefined) return "—";
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function formatModified(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return modifiedDateFormatter.format(date);
}

function getDriveUsage(drive) {
  if (!drive.totalBytes) return 0;
  return Math.min(100, Math.max(0, ((drive.totalBytes - drive.freeBytes) / drive.totalBytes) * 100));
}

function EntryIcon({ kind }) {
  const Icon = entryIcons[kind] ?? DocumentRegular;
  return <Icon aria-hidden="true" />;
}

function ExplorerCommandDialog({ dialog, busy, onCancel, onConfirm }) {
  const inputRef = useRef(null);
  const confirmRef = useRef(null);
  const dialogRef = useRef(null);
  const [value, setValue] = useState(dialog.initialValue ?? "");
  const hasInput = dialog.type !== "recycle";

  useDialogFocusTrap(dialogRef, true, {
    initialFocusRef: hasInput ? inputRef : confirmRef,
    onEscape: busy ? null : onCancel,
  });

  return (
    <div className="explorer-dialog-layer">
      <form
        ref={dialogRef}
        className={`explorer-command-dialog ${dialog.danger ? "is-danger" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={dialog.title}
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(value);
        }}
      >
        <header>
          <strong>{dialog.title}</strong>
          <button type="button" aria-label="Cancel operation" disabled={busy} onClick={onCancel}><DismissRegular /></button>
        </header>
        <p>{dialog.description}</p>
        {hasInput ? (
          <label>
            <span>{dialog.label}</span>
            <input
              ref={inputRef}
              value={value}
              maxLength={255}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
        ) : null}
        <footer>
          <button type="button" disabled={busy} onClick={onCancel}>CANCEL</button>
          <button ref={confirmRef} type="submit" className="is-primary" disabled={busy || (hasInput && !value.trim())}>
            {busy ? "PROCESSING" : dialog.confirmLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}

export function FileExplorerWindow({ open, initialPath, onClose, onToast }) {
  const requestIdRef = useRef(0);
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selectedPaths, setSelectedPaths] = useState([]);
  const [selectionAnchor, setSelectionAnchor] = useState(null);
  const [clipboard, setClipboard] = useState(null);
  const [commandDialog, setCommandDialog] = useState(null);
  const [operationBusy, setOperationBusy] = useState(null);
  const [operationNotice, setOperationNotice] = useState(null);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState("list");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());

  const browse = useCallback(async (path, options = {}) => {
    const requestId = ++requestIdRef.current;
    const clearSearch = options.clearSearch ?? true;
    const nextSelection = options.selectPaths ?? [];
    setLoading(true);
    setError(null);
    try {
      const result = normalizeSnapshot(await platform.explorer.browse(path));
      if (requestId !== requestIdRef.current) return null;
      const availablePaths = new Set(result.entries.map((entry) => entry.path));
      const validSelection = nextSelection.filter((entryPath) => availablePaths.has(entryPath));
      setSnapshot(result);
      setSelectedPaths(validSelection);
      setSelectionAnchor(validSelection.at(-1) ?? null);
      if (clearSearch) setSearch("");
      return result;
    } catch (browseError) {
      if (requestId !== requestIdRef.current) return null;
      setError(browseError);
      onToast(`Unable to open folder: ${browseError.message}`);
      return null;
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [onToast]);

  const navigate = useCallback(async (path) => {
    const result = await browse(path);
    if (!result) return;
    setOperationNotice(null);
    setCommandDialog(null);
    setHistory((current) => {
      const prefix = current.slice(0, historyIndex + 1);
      const next = [...prefix, result.currentPath];
      setHistoryIndex(next.length - 1);
      return next;
    });
  }, [browse, historyIndex]);

  const navigateHistory = useCallback(async (nextIndex) => {
    const path = history[nextIndex];
    if (!path) return;
    const result = await browse(path);
    if (result) {
      setHistoryIndex(nextIndex);
      setOperationNotice(null);
      setCommandDialog(null);
    }
  }, [browse, history]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setHistory([]);
    setHistoryIndex(-1);
    setSnapshot(EMPTY_SNAPSHOT);
    setSelectedPaths([]);
    setSelectionAnchor(null);
    setSearch("");
    setError(null);
    setOperationNotice(null);
    setCommandDialog(null);

    browse(initialPath).then((result) => {
      if (cancelled || !result) return;
      setHistory([result.currentPath]);
      setHistoryIndex(0);
    });
    return () => {
      cancelled = true;
      requestIdRef.current += 1;
    };
  }, [browse, initialPath, open]);

  const visibleEntries = useMemo(() => {
    if (!deferredSearch) return snapshot.entries;
    return snapshot.entries.filter((entry) => (
      entry.name.toLocaleLowerCase().includes(deferredSearch) ||
      entry.typeLabel.toLocaleLowerCase().includes(deferredSearch)
    ));
  }, [deferredSearch, snapshot.entries]);

  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const clipboardPathSet = useMemo(
    () => new Set(clipboard?.mode === "move" ? clipboard.paths : []),
    [clipboard],
  );
  const selectedEntries = useMemo(
    () => snapshot.entries.filter((entry) => selectedPathSet.has(entry.path)),
    [selectedPathSet, snapshot.entries],
  );
  const selectedEntry = useMemo(
    () => selectedEntries.find((entry) => entry.path === selectionAnchor) ?? selectedEntries.at(-1) ?? null,
    [selectedEntries, selectionAnchor],
  );
  const selectionSize = useMemo(
    () => selectedEntries.reduce((total, entry) => total + (entry.sizeBytes ?? 0), 0),
    [selectedEntries],
  );

  const openEntry = useCallback(async (entry) => {
    if (entry.isDirectory) {
      await navigate(entry.path);
      return;
    }

    try {
      await platform.explorer.openFile(entry.path);
      onToast(`Opening ${entry.name}`);
    } catch (openError) {
      onToast(`Unable to open ${entry.name}: ${openError.message}`);
    }
  }, [navigate, onToast]);

  const openInWindows = useCallback(async (path = snapshot.currentPath) => {
    if (!path) return;
    try {
      await platform.explorer.openInWindows(path);
      onToast(platform.isNative ? "Opened location with Windows File Explorer" : "Windows Explorer fallback requested");
    } catch (openError) {
      onToast(`Unable to open Windows Explorer: ${openError.message}`);
    }
  }, [onToast, snapshot.currentPath]);

  const selectEntry = useCallback((entry, event) => {
    const toggleSelection = event.ctrlKey || event.metaKey;
    if (event.shiftKey && selectionAnchor) {
      const anchorIndex = visibleEntries.findIndex((item) => item.path === selectionAnchor);
      const entryIndex = visibleEntries.findIndex((item) => item.path === entry.path);
      if (anchorIndex >= 0 && entryIndex >= 0) {
        const start = Math.min(anchorIndex, entryIndex);
        const end = Math.max(anchorIndex, entryIndex);
        const range = visibleEntries.slice(start, end + 1).map((item) => item.path);
        setSelectedPaths((current) => toggleSelection ? [...new Set([...current, ...range])] : range);
        return;
      }
    }

    if (toggleSelection) {
      setSelectedPaths((current) => (
        current.includes(entry.path)
          ? current.filter((path) => path !== entry.path)
          : [...current, entry.path]
      ));
      setSelectionAnchor(entry.path);
      return;
    }

    setSelectedPaths([entry.path]);
    setSelectionAnchor(entry.path);
  }, [selectionAnchor, visibleEntries]);

  const copySelection = useCallback((mode) => {
    if (selectedPaths.length === 0) return;
    setClipboard({ mode, paths: [...selectedPaths] });
    setOperationNotice({
      tone: "info",
      message: `${selectedPaths.length} item${selectedPaths.length === 1 ? "" : "s"} ${mode === "copy" ? "copied" : "cut"} to JARVIS clipboard.`,
    });
    onToast(`${mode === "copy" ? "Copied" : "Cut"} ${selectedPaths.length} item${selectedPaths.length === 1 ? "" : "s"}`);
  }, [onToast, selectedPaths]);

  const runMutation = useCallback(async (label, operation, options = {}) => {
    setOperationBusy(label);
    setOperationNotice(null);
    try {
      const result = normalizeOperation(await operation());
      const nextSelection = options.selectTargets === false
        ? []
        : result.items.map((item) => item.target);
      await browse(snapshot.currentPath, { clearSearch: false, selectPaths: nextSelection });

      if (result.failures.length > 0) {
        const completed = result.items.length;
        const message = `${completed} completed · ${result.failures.length} failed · ${result.failures[0].message}`;
        setOperationNotice({ tone: "warning", message });
        onToast(message);
      } else {
        const message = options.successMessage ?? `${result.items.length} item${result.items.length === 1 ? "" : "s"} updated`;
        setOperationNotice({ tone: "success", message });
        onToast(message);
      }
      return result;
    } catch (operationError) {
      const message = `${label} failed: ${operationError.message}`;
      setOperationNotice({ tone: "error", message });
      onToast(message);
      return null;
    } finally {
      setOperationBusy(null);
    }
  }, [browse, onToast, snapshot.currentPath]);

  const pasteClipboard = useCallback(async () => {
    if (!clipboard?.paths.length || !snapshot.currentPath || operationBusy) return;
    const result = await runMutation(
      clipboard.mode === "copy" ? "Copy" : "Move",
      () => platform.explorer.transfer(clipboard.paths, snapshot.currentPath, clipboard.mode),
      { successMessage: `${clipboard.paths.length} item${clipboard.paths.length === 1 ? "" : "s"} pasted` },
    );
    if (!result || clipboard.mode !== "move") return;
    const failedSources = new Set(result.failures.map((failure) => failure.source));
    setClipboard(failedSources.size > 0
      ? { mode: "move", paths: clipboard.paths.filter((path) => failedSources.has(path)) }
      : null);
  }, [clipboard, operationBusy, runMutation, snapshot.currentPath]);

  const openCreateDialog = useCallback(() => {
    if (!snapshot.currentPath || operationBusy) return;
    setCommandDialog({
      id: `create-${Date.now()}`,
      type: "create",
      title: "CREATE NEW FOLDER",
      description: "Create a folder in the current location.",
      label: "FOLDER NAME",
      initialValue: "New folder",
      confirmLabel: "CREATE FOLDER",
    });
  }, [operationBusy, snapshot.currentPath]);

  const openRenameDialog = useCallback(() => {
    if (selectedEntries.length !== 1 || operationBusy) return;
    const entry = selectedEntries[0];
    setCommandDialog({
      id: `rename-${entry.path}`,
      type: "rename",
      path: entry.path,
      title: "RENAME ITEM",
      description: `Rename ${entry.name}.`,
      label: "NEW NAME",
      initialValue: entry.name,
      confirmLabel: "APPLY NAME",
    });
  }, [operationBusy, selectedEntries]);

  const openRecycleDialog = useCallback(() => {
    if (selectedEntries.length === 0 || operationBusy) return;
    const preview = selectedEntries.slice(0, 3).map((entry) => entry.name).join(", ");
    const remaining = selectedEntries.length - Math.min(3, selectedEntries.length);
    setCommandDialog({
      id: `recycle-${Date.now()}`,
      type: "recycle",
      paths: selectedEntries.map((entry) => entry.path),
      title: "MOVE TO RECYCLE BIN",
      description: `${preview}${remaining > 0 ? ` and ${remaining} more` : ""} will remain recoverable from the Windows Recycle Bin.`,
      confirmLabel: "MOVE TO RECYCLE BIN",
      danger: true,
    });
  }, [operationBusy, selectedEntries]);

  const confirmCommand = useCallback(async (value) => {
    if (!commandDialog) return;
    if (commandDialog.type === "create") {
      const result = await runMutation(
        "Create folder",
        () => platform.explorer.createFolder(snapshot.currentPath, value.trim()),
        { successMessage: `Created folder ${value.trim()}` },
      );
      if (result) setCommandDialog(null);
      return;
    }

    if (commandDialog.type === "rename") {
      const result = await runMutation(
        "Rename",
        () => platform.explorer.rename(commandDialog.path, value.trim()),
        { successMessage: `Renamed item to ${value.trim()}` },
      );
      if (result) {
        const renamedItem = result.items[0];
        if (renamedItem) {
          setClipboard((current) => current
            ? {
                ...current,
                paths: current.paths.map((path) => (path === renamedItem.source ? renamedItem.target : path)),
              }
            : null);
        }
        setCommandDialog(null);
      }
      return;
    }

    const recycledPaths = new Set(commandDialog.paths);
    const result = await runMutation(
      "Recycle",
      () => platform.explorer.recycle(commandDialog.paths),
      { selectTargets: false, successMessage: `${commandDialog.paths.length} item${commandDialog.paths.length === 1 ? "" : "s"} moved to Recycle Bin` },
    );
    if (result) {
      setClipboard((current) => current
        ? { ...current, paths: current.paths.filter((path) => !recycledPaths.has(path)) }
        : null);
      setCommandDialog(null);
    }
  }, [commandDialog, runMutation, snapshot.currentPath]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (commandDialog) setCommandDialog(null);
        else onClose();
        return;
      }

      const target = event.target;
      const isEditing = target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      if (isEditing || commandDialog || operationBusy) return;

      const key = event.key.toLocaleLowerCase();
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "n") {
        event.preventDefault();
        openCreateDialog();
      } else if ((event.ctrlKey || event.metaKey) && key === "a") {
        event.preventDefault();
        const paths = visibleEntries.map((entry) => entry.path);
        setSelectedPaths(paths);
        setSelectionAnchor(paths.at(-1) ?? null);
      } else if ((event.ctrlKey || event.metaKey) && key === "c") {
        event.preventDefault();
        copySelection("copy");
      } else if ((event.ctrlKey || event.metaKey) && key === "x") {
        event.preventDefault();
        copySelection("move");
      } else if ((event.ctrlKey || event.metaKey) && key === "v") {
        event.preventDefault();
        pasteClipboard();
      } else if (event.key === "F2") {
        event.preventDefault();
        openRenameDialog();
      } else if (event.key === "Delete") {
        event.preventDefault();
        openRecycleDialog();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    commandDialog,
    copySelection,
    onClose,
    open,
    openCreateDialog,
    openRecycleDialog,
    openRenameDialog,
    operationBusy,
    pasteClipboard,
    visibleEntries,
  ]);

  if (!open) return null;

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < history.length - 1;
  const hasSelection = selectedEntries.length > 0;
  const canRename = selectedEntries.length === 1;
  const canPaste = Boolean(clipboard?.paths.length && snapshot.currentPath);

  return (
    <div className="explorer-layer" aria-hidden={false}>
      <section className="jarvis-explorer" role="dialog" aria-modal="false" aria-label="JARVIS File Explorer">
        <header className="explorer-titlebar">
          <FolderRegular aria-hidden="true" />
          <strong>FILE EXPLORER</strong>
          <span>LOCAL FILESYSTEM · RECYCLE-SAFE WRITE MODE</span>
          <div className="explorer-window-actions">
            <button type="button" aria-label="Minimize JARVIS File Explorer" onClick={onClose}>—</button>
            <button type="button" aria-label="Close JARVIS File Explorer" onClick={onClose}><DismissRegular /></button>
          </div>
        </header>

        <div className="explorer-toolbar">
          <div className="explorer-history-actions">
            <button type="button" aria-label="Back" disabled={!canGoBack || loading} onClick={() => navigateHistory(historyIndex - 1)}><ArrowLeftRegular /></button>
            <button type="button" aria-label="Forward" disabled={!canGoForward || loading} onClick={() => navigateHistory(historyIndex + 1)}><ArrowRightRegular /></button>
            <button type="button" aria-label="Up one level" disabled={!snapshot.parentPath || loading} onClick={() => navigate(snapshot.parentPath)}><ArrowUpRegular /></button>
            <button type="button" aria-label="Refresh" disabled={!snapshot.currentPath || loading} onClick={() => browse(snapshot.currentPath, { clearSearch: false })}><ArrowClockwiseRegular /></button>
          </div>

          <nav className="explorer-breadcrumbs" aria-label="Current path">
            {snapshot.breadcrumbs.map((breadcrumb, index) => (
              <button key={breadcrumb.path} type="button" disabled={loading} onClick={() => navigate(breadcrumb.path)}>
                <span>{breadcrumb.label}</span>
                {index < snapshot.breadcrumbs.length - 1 ? <small>›</small> : null}
              </button>
            ))}
            {loading ? <span className="explorer-scan-line">SCANNING</span> : null}
          </nav>

          <label className="explorer-search">
            <SearchRegular aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search current folder" aria-label="Search current folder" />
          </label>

          <div className="explorer-view-actions">
            <button type="button" className={viewMode === "list" ? "is-active" : ""} aria-label="Details view" onClick={() => setViewMode("list")}><ListRegular /></button>
            <button type="button" className={viewMode === "grid" ? "is-active" : ""} aria-label="Grid view" onClick={() => setViewMode("grid")}><GridRegular /></button>
            <button type="button" aria-label="Open current folder with Windows File Explorer" onClick={() => openInWindows()}><MoreHorizontalRegular /></button>
          </div>
        </div>

        <div className="explorer-commandbar" role="toolbar" aria-label="File operations">
          <button type="button" disabled={!snapshot.currentPath || Boolean(operationBusy)} onClick={openCreateDialog}><FolderAddRegular /><span>NEW FOLDER</span><kbd>CTRL+SHIFT+N</kbd></button>
          <button type="button" disabled={!canRename || Boolean(operationBusy)} onClick={openRenameDialog}><RenameRegular /><span>RENAME</span><kbd>F2</kbd></button>
          <button type="button" disabled={!hasSelection || Boolean(operationBusy)} onClick={() => copySelection("copy")}><CopyRegular /><span>COPY</span><kbd>CTRL+C</kbd></button>
          <button type="button" disabled={!hasSelection || Boolean(operationBusy)} onClick={() => copySelection("move")}><CutRegular /><span>CUT</span><kbd>CTRL+X</kbd></button>
          <button type="button" disabled={!canPaste || Boolean(operationBusy)} onClick={pasteClipboard}><ClipboardPasteRegular /><span>PASTE</span><kbd>CTRL+V</kbd></button>
          <button type="button" className="is-danger" disabled={!hasSelection || Boolean(operationBusy)} onClick={openRecycleDialog}><DeleteRegular /><span>RECYCLE</span><kbd>DEL</kbd></button>
          <div className="explorer-clipboard-status" aria-live="polite">
            <span>JARVIS CLIPBOARD</span>
            <strong>{clipboard?.paths.length ? `${clipboard.mode.toUpperCase()} · ${clipboard.paths.length} ITEM${clipboard.paths.length === 1 ? "" : "S"}` : "EMPTY"}</strong>
          </div>
        </div>

        <div className="explorer-body">
          <aside className="explorer-navigation" aria-label="Explorer locations">
            <h2>LOCATIONS</h2>
            {snapshot.locations.map((location) => {
              const Icon = locationIcons[location.kind] ?? FolderRegular;
              const active = snapshot.currentPath === location.path;
              return (
                <button key={location.id} type="button" className={active ? "is-active" : ""} onClick={() => navigate(location.path)}>
                  <Icon aria-hidden="true" /><span>{location.label}</span>
                </button>
              );
            })}
            <h2>DRIVES</h2>
            {snapshot.drives.map((drive) => {
              const usage = getDriveUsage(drive);
              const active = snapshot.currentPath.toLocaleLowerCase().startsWith(drive.path.toLocaleLowerCase());
              return (
                <button key={drive.id} type="button" className={`explorer-drive ${active ? "is-active" : ""}`} onClick={() => navigate(drive.path)}>
                  <HardDriveRegular aria-hidden="true" />
                  <span><strong>{drive.label}</strong><small>{formatFileSize(drive.freeBytes)} FREE</small><i style={{ "--drive-usage": `${usage}%` }} /></span>
                </button>
              );
            })}
          </aside>

          <section className={`explorer-files is-${viewMode}`} aria-label="Folder contents">
            {viewMode === "list" ? (
              <div className="explorer-list-heading" aria-hidden="true">
                <span>NAME</span><span>TYPE</span><span>MODIFIED</span><span>SIZE</span>
              </div>
            ) : null}

            <div
              className="explorer-file-viewport"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setSelectedPaths([]);
                  setSelectionAnchor(null);
                }
              }}
            >
              {error ? <div className="explorer-empty"><strong>ACCESS INTERRUPTED</strong><span>{error.message}</span></div> : null}
              {!error && !loading && visibleEntries.length === 0 ? (
                <div className="explorer-empty"><FolderRegular /><strong>NO MATCHING ITEMS</strong><span>{deferredSearch ? "Clear the search filter to view this folder." : "This folder is empty."}</span></div>
              ) : null}
              {!error ? visibleEntries.map((entry) => {
                const selected = selectedPathSet.has(entry.path);
                return (
                  <button
                    key={entry.path}
                    type="button"
                    className={`explorer-entry ${selected ? "is-selected" : ""} ${clipboardPathSet.has(entry.path) ? "is-cut" : ""}`}
                    title={entry.path}
                    aria-pressed={selected}
                    onClick={(event) => selectEntry(entry, event)}
                    onDoubleClick={() => openEntry(entry)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") openEntry(entry);
                    }}
                  >
                    <span className="explorer-entry-name"><EntryIcon kind={entry.kind} /><strong>{entry.name}</strong></span>
                    <span>{entry.typeLabel}</span>
                    <span>{formatModified(entry.modified)}</span>
                    <span>{formatFileSize(entry.sizeBytes)}</span>
                  </button>
                );
              }) : null}
            </div>
          </section>

          <aside className="explorer-inspector" aria-label="Selected item details">
            {selectedEntries.length > 1 ? (
              <>
                <div className="explorer-preview-icon is-multiple"><CopyRegular /></div>
                <h2>{selectedEntries.length} ITEMS SELECTED</h2>
                <p>{formatFileSize(selectionSize)} · MULTI-SELECTION</p>
                <dl>
                  <div><dt>FILES</dt><dd>{selectedEntries.filter((entry) => !entry.isDirectory).length}</dd></div>
                  <div><dt>FOLDERS</dt><dd>{selectedEntries.filter((entry) => entry.isDirectory).length}</dd></div>
                  <div><dt>LOCATION</dt><dd title={snapshot.currentPath}>{snapshot.currentPath}</dd></div>
                </dl>
                <div className="explorer-inspector-actions">
                  <button type="button" onClick={() => copySelection("copy")}><CopyRegular />COPY SELECTION</button>
                  <button type="button" onClick={() => copySelection("move")}><CutRegular />CUT SELECTION</button>
                  <button type="button" className="is-danger" onClick={openRecycleDialog}><DeleteRegular />MOVE TO RECYCLE BIN</button>
                </div>
              </>
            ) : selectedEntry ? (
              <>
                <div className={`explorer-preview-icon is-${selectedEntry.kind}`}><EntryIcon kind={selectedEntry.kind} /></div>
                <h2>{selectedEntry.name}</h2>
                <p>{selectedEntry.typeLabel} · {formatFileSize(selectedEntry.sizeBytes)}</p>
                <dl>
                  <div><dt>MODIFIED</dt><dd>{formatModified(selectedEntry.modified)}</dd></div>
                  <div><dt>LOCATION</dt><dd title={snapshot.currentPath}>{snapshot.currentPath}</dd></div>
                  <div><dt>EXTENSION</dt><dd>{selectedEntry.extension || "—"}</dd></div>
                  <div><dt>LINKED</dt><dd>{selectedEntry.isLinked ? "YES" : "NO"}</dd></div>
                </dl>
                <div className="explorer-inspector-actions">
                  <button type="button" onClick={() => openEntry(selectedEntry)}><OpenRegular />{selectedEntry.isDirectory ? "OPEN FOLDER" : "OPEN FILE"}</button>
                  <button type="button" onClick={openRenameDialog}><RenameRegular />RENAME</button>
                  <button type="button" onClick={() => openInWindows(selectedEntry.path)}><FolderRegular />OPEN IN WINDOWS</button>
                  <button type="button" className="is-danger" onClick={openRecycleDialog}><DeleteRegular />MOVE TO RECYCLE BIN</button>
                </div>
              </>
            ) : (
              <div className="explorer-inspector-empty">
                <img src="/assets/jarvis-right-core-status-v1.png" alt="" />
                <strong>SELECT AN ITEM</strong>
                <span>Ctrl/Shift enables multi-selection. File operations remain recoverable where possible.</span>
              </div>
            )}
          </aside>
        </div>

        <footer className="explorer-statusbar">
          <span>{visibleEntries.length} ITEMS</span>
          {deferredSearch ? <span>FILTERED FROM {snapshot.entries.length}</span> : null}
          {selectedEntries.length > 0 ? <span>{selectedEntries.length} SELECTED · {formatFileSize(selectionSize)}</span> : <span>NO SELECTION</span>}
          {operationNotice ? <strong className={`is-${operationNotice.tone}`}>{operationNotice.message}</strong> : null}
          {!operationNotice && snapshot.warning ? <strong>{snapshot.warning}</strong> : null}
          <small>{operationBusy ? `${operationBusy.toUpperCase()} IN PROGRESS` : "LOCAL FILESYSTEM · READ / WRITE · RECYCLE SAFE"}</small>
        </footer>

        {commandDialog ? (
          <ExplorerCommandDialog
            key={commandDialog.id}
            dialog={commandDialog}
            busy={Boolean(operationBusy)}
            onCancel={() => setCommandDialog(null)}
            onConfirm={confirmCommand}
          />
        ) : null}
      </section>
    </div>
  );
}
