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
import {
  canReplaceAllConflicts,
  getTransferSummary,
  isTransferTerminal,
  normalizeTransferPreflight,
  normalizeTransferSnapshot,
} from "../file-transfer-state.js";
import {
  getFileDropMode,
  hasFileDrag,
  parseFileDrag,
  writeFileDrag,
} from "../file-drag-model.js";
import {
  formatExplorerCopyPath,
  getExplorerEscapeAction,
  getExplorerGridColumnCount,
  getExplorerKeyboardCommand,
  getExplorerKeyboardTarget,
  getExplorerSearchSummary,
  normalizeExplorerAddress,
  normalizeExplorerSearchQuery,
  readExplorerPreferences,
  segmentExplorerSearchMatch,
  sortExplorerEntries,
  writeExplorerPreferences,
} from "../explorer-interaction-model.js";

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
  const skipped = read(result, "skipped", "Skipped") ?? [];
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
    skipped: skipped.map((failure) => ({
      source: String(read(failure, "source", "Source") ?? ""),
      code: String(read(failure, "code", "Code") ?? "OPERATION_SKIPPED"),
      message: String(read(failure, "message", "Message") ?? "The operation was skipped."),
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

function ExplorerSearchLabel({ value, query }) {
  return segmentExplorerSearchMatch(value, query).map((segment, index) => (
    segment.match
      ? <mark key={`${segment.text}-${index}`}>{segment.text}</mark>
      : <span key={`${segment.text}-${index}`}>{segment.text}</span>
  ));
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

function ExplorerConflictDialog({ pending, busy, onCancel, onChoose }) {
  const dialogRef = useRef(null);
  const primaryRef = useRef(null);
  const replaceAllowed = canReplaceAllConflicts(pending.preflight);
  const conflictCount = pending.preflight.conflicts.length;
  const preview = pending.preflight.conflicts
    .slice(0, 3)
    .map((conflict) => conflict.name)
    .join(", ");

  useDialogFocusTrap(dialogRef, true, {
    initialFocusRef: primaryRef,
    onEscape: busy ? null : onCancel,
  });

  return (
    <div className="explorer-dialog-layer">
      <section
        ref={dialogRef}
        className="explorer-command-dialog explorer-conflict-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="explorer-conflict-title"
      >
        <header>
          <strong id="explorer-conflict-title">NAME CONFLICT DETECTED</strong>
          <button type="button" aria-label="Cancel transfer" disabled={busy} onClick={onCancel}><DismissRegular /></button>
        </header>
        <p>
          {conflictCount} of {pending.preflight.itemCount} item{pending.preflight.itemCount === 1 ? "" : "s"} already {pending.preflight.itemCount === 1 ? "exists" : "exist"}
          in this folder: {preview}{conflictCount > 3 ? ` and ${conflictCount - 3} more` : ""}.
        </p>
        {pending.preflight.crossesVolumes && pending.mode === "move" ? (
          <div className="explorer-conflict-note">
            CROSS-VOLUME MOVE · JARVIS WILL COPY, VERIFY, THEN DELETE THE SOURCE
          </div>
        ) : null}
        <div className="explorer-conflict-choices">
          <button ref={primaryRef} type="button" disabled={busy} onClick={() => onChoose("rename")}>
            <strong>KEEP BOTH</strong>
            <span>Generate a unique Windows-style name.</span>
          </button>
          <button type="button" disabled={busy} onClick={() => onChoose("skip")}>
            <strong>SKIP CONFLICTS</strong>
            <span>Transfer only items whose names are free.</span>
          </button>
          <button type="button" className="is-danger" disabled={busy || !replaceAllowed} onClick={() => onChoose("replace")}>
            <strong>REPLACE</strong>
            <span>{replaceAllowed ? "Protect the existing target with rollback until complete." : "Unavailable when source and target are the same item."}</span>
          </button>
        </div>
        <footer>
          <button type="button" disabled={busy} onClick={onCancel}>CANCEL TRANSFER</button>
        </footer>
      </section>
    </div>
  );
}

function ExplorerTransferPanel({ transfer, onCancel, onDismiss }) {
  if (!transfer) return null;
  const terminal = isTransferTerminal(transfer.status);
  const tone = transfer.status === "completed"
    ? "success"
    : transfer.status === "failed" || transfer.status === "completed-with-errors"
      ? "error"
      : transfer.status === "cancelled"
        ? "warning"
        : "info";

  return (
    <section className={`explorer-transfer-panel is-${tone}`} aria-label="File transfer status" aria-live={terminal ? "polite" : "off"}>
      <header>
        <span>{transfer.mode === "move" ? "MOVE OPERATION" : "COPY OPERATION"}</span>
        <strong>{transfer.status.replaceAll("-", " ").toUpperCase()}</strong>
      </header>
      <div className="explorer-transfer-summary">
        <span>{getTransferSummary(transfer)}</span>
        <b>{Math.round(transfer.percent)}%</b>
      </div>
      <div
        className="explorer-transfer-progress"
        role="progressbar"
        aria-label={`${transfer.mode} progress`}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(transfer.percent)}
      >
        <i style={{ "--transfer-progress": `${transfer.percent}%` }} />
      </div>
      <footer>
        <small>
          {formatFileSize(transfer.bytesTransferred)} / {formatFileSize(transfer.totalBytes)}
          {" · "}{transfer.completedItems}/{transfer.totalItems} complete
        </small>
        {terminal ? (
          <button type="button" onClick={onDismiss}>DISMISS</button>
        ) : (
          <button type="button" disabled={transfer.status === "cancelling"} onClick={onCancel}>
            {transfer.status === "cancelling" ? "CANCELLING" : "CANCEL"}
          </button>
        )}
      </footer>
    </section>
  );
}

export function FileExplorerWindow({
  open,
  active,
  initialPath,
  requestSequence,
  maximized,
  onClose,
  onMinimize,
  onToggleMaximize,
  onToast,
}) {
  const requestIdRef = useRef(0);
  const currentPathRef = useRef("");
  const addressRef = useRef(null);
  const searchRef = useRef(null);
  const fileViewportRef = useRef(null);
  const entryRefs = useRef(new Map());
  const pendingSearchFocusPathRef = useRef(null);
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selectedPaths, setSelectedPaths] = useState([]);
  const [selectionAnchor, setSelectionAnchor] = useState(null);
  const [clipboard, setClipboard] = useState(null);
  const [commandDialog, setCommandDialog] = useState(null);
  const [pendingTransfer, setPendingTransfer] = useState(null);
  const [transfer, setTransfer] = useState(null);
  const [operationBusy, setOperationBusy] = useState(null);
  const [operationNotice, setOperationNotice] = useState(null);
  const [search, setSearch] = useState("");
  const [addressEditing, setAddressEditing] = useState(false);
  const [addressValue, setAddressValue] = useState("");
  const [focusedPath, setFocusedPath] = useState(null);
  const [explorerPreferences, setExplorerPreferences] = useState(readExplorerPreferences);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const handledTerminalTransfersRef = useRef(new Set());
  const dismissedTransfersRef = useRef(new Set());
  const deferredSearchValue = useDeferredValue(search);
  const deferredSearch = useMemo(
    () => normalizeExplorerSearchQuery(deferredSearchValue),
    [deferredSearchValue],
  );
  const {
    viewMode,
    sortKey,
    sortDirection,
  } = explorerPreferences;

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
      currentPathRef.current = result.currentPath;
      setAddressValue(result.currentPath);
      setAddressEditing(false);
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

  useEffect(() => {
    writeExplorerPreferences(explorerPreferences);
  }, [explorerPreferences]);

  const navigate = useCallback(async (path) => {
    const result = await browse(path);
    if (!result) return;
    setOperationNotice(null);
    setCommandDialog(null);
    setPendingTransfer(null);
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
    currentPathRef.current = "";
    setSelectedPaths([]);
    setSelectionAnchor(null);
    setSearch("");
    setAddressEditing(false);
    setAddressValue("");
    setFocusedPath(null);
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
  }, [browse, initialPath, open, requestSequence]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    platform.clipboard.read()
      .then((state) => {
        if (cancelled) return;
        const paths = Array.isArray(state?.paths) ? state.paths : [];
        setClipboard(paths.length > 0
          ? { paths, mode: state?.mode === "move" ? "move" : "copy" }
          : null);
      })
      .catch(() => {
        if (!cancelled) setClipboard(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let disposed = false;
    const applyTransfer = async (rawSnapshot) => {
      const nextTransfer = normalizeTransferSnapshot(rawSnapshot);
      if (!nextTransfer || disposed) return;
      if (isTransferTerminal(nextTransfer.status) &&
          dismissedTransfersRef.current.has(nextTransfer.jobId)) {
        return;
      }
      setTransfer(nextTransfer);
      if (!isTransferTerminal(nextTransfer.status) ||
          handledTerminalTransfersRef.current.has(nextTransfer.jobId)) {
        return;
      }

      handledTerminalTransfersRef.current.add(nextTransfer.jobId);
      const message = getTransferSummary(nextTransfer);
      const tone = nextTransfer.status === "completed"
        ? "success"
        : nextTransfer.status === "cancelled"
          ? "warning"
          : "error";
      setOperationNotice({ tone, message });
      onToast(message);

      if (nextTransfer.mode === "move") {
        const completedSources = new Set(nextTransfer.result.items.map((item) => item.source));
        const clipboardState = await platform.clipboard.read().catch(() => null);
        const remainingMovePaths = clipboardState?.mode === "move"
          ? (clipboardState.paths ?? []).filter((path) => !completedSources.has(path))
          : [];
        setClipboard(remainingMovePaths.length > 0
          ? { mode: "move", paths: remainingMovePaths }
          : null);
        if (remainingMovePaths.length > 0) {
          await platform.clipboard.write(remainingMovePaths, "move");
        } else {
          await platform.clipboard.clear();
        }
      }

      if (currentPathRef.current) {
        await browse(currentPathRef.current, {
          clearSearch: false,
          selectPaths: nextTransfer.result.items.map((item) => item.target),
        });
      }
    };

    const unsubscribe = platform.events.subscribe("explorer.transferChanged", applyTransfer);
    platform.explorer.getTransfers?.()
      .then((result) => {
        const jobs = read(result, "jobs", "Jobs") ?? [];
        const activeJob = jobs
          .map(normalizeTransferSnapshot)
          .find((job) => job && !isTransferTerminal(job.status));
        if (activeJob) applyTransfer(activeJob);
      })
      .catch(() => {
        // Older hosts simply start with an empty transfer center.
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [browse, onToast, open]);

  const sortedEntries = useMemo(
    () => sortExplorerEntries(snapshot.entries, explorerPreferences),
    [explorerPreferences, snapshot.entries],
  );
  const visibleEntries = useMemo(() => {
    if (!deferredSearch) return sortedEntries;
    return sortedEntries.filter((entry) => (
      entry.name.toLocaleLowerCase().includes(deferredSearch) ||
      entry.typeLabel.toLocaleLowerCase().includes(deferredSearch)
    ));
  }, [deferredSearch, sortedEntries]);

  useEffect(() => {
    setFocusedPath((current) => {
      if (visibleEntries.some((entry) => entry.path === current)) return current;
      if (visibleEntries.some((entry) => entry.path === selectionAnchor)) {
        return selectionAnchor;
      }
      return visibleEntries[0]?.path ?? null;
    });
  }, [selectionAnchor, visibleEntries]);

  useEffect(() => {
    const targetPath = pendingSearchFocusPathRef.current;
    if (deferredSearch || !targetPath) return;
    const target = entryRefs.current.get(targetPath);
    if (!target) return;
    pendingSearchFocusPathRef.current = null;
    target.focus();
  }, [deferredSearch, visibleEntries]);

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
    setFocusedPath(entry.path);
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

  const focusEntryAt = useCallback((index, additive = false) => {
    const entry = visibleEntries[index];
    if (!entry) return;
    setFocusedPath(entry.path);
    setSelectionAnchor(entry.path);
    setSelectedPaths((current) => (
      additive ? [...new Set([...current, entry.path])] : [entry.path]
    ));
    window.requestAnimationFrame(() => {
      entryRefs.current.get(entry.path)?.focus();
    });
  }, [visibleEntries]);

  const beginAddressEdit = useCallback(() => {
    setAddressValue(snapshot.currentPath);
    setAddressEditing(true);
    window.requestAnimationFrame(() => {
      addressRef.current?.focus();
      addressRef.current?.select();
    });
  }, [snapshot.currentPath]);

  const clearExplorerSearch = useCallback(() => {
    const targetPath = selectionAnchor && snapshot.entries.some((entry) =>
      entry.path === selectionAnchor)
      ? selectionAnchor
      : sortedEntries[0]?.path ?? null;
    pendingSearchFocusPathRef.current = targetPath;
    setSearch("");
    setFocusedPath(targetPath);
  }, [selectionAnchor, snapshot.entries, sortedEntries]);

  const submitAddress = useCallback(async () => {
    const address = normalizeExplorerAddress(addressValue);
    if (!address) {
      setAddressEditing(false);
      setAddressValue(snapshot.currentPath);
      return;
    }
    await navigate(address);
  }, [addressValue, navigate, snapshot.currentPath]);

  const copySelectedPaths = useCallback(async () => {
    const text = formatExplorerCopyPath(selectedPaths);
    if (!text) {
      onToast("Select one or more items to copy their paths");
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Text clipboard is unavailable");
      }
      await navigator.clipboard.writeText(text);
      setOperationNotice({
        tone: "success",
        message: `${selectedPaths.length} path${selectedPaths.length === 1 ? "" : "s"} copied`,
      });
      onToast(`Copied ${selectedPaths.length} path${selectedPaths.length === 1 ? "" : "s"}`);
    } catch (clipboardError) {
      onToast(`Unable to copy path: ${clipboardError.message}`);
    }
  }, [onToast, selectedPaths]);

  const copySelection = useCallback(async (mode) => {
    if (selectedPaths.length === 0 || (transfer && !isTransferTerminal(transfer.status))) return;
    const nextClipboard = { mode, paths: [...selectedPaths] };
    try {
      await platform.clipboard.write(nextClipboard.paths, mode);
      setClipboard(nextClipboard);
      setOperationNotice({
        tone: "info",
        message: `${selectedPaths.length} item${selectedPaths.length === 1 ? "" : "s"} ${mode === "copy" ? "copied" : "cut"} to Windows clipboard.`,
      });
      onToast(`${mode === "copy" ? "Copied" : "Cut"} ${selectedPaths.length} item${selectedPaths.length === 1 ? "" : "s"}`);
    } catch (clipboardError) {
      const message = `Windows clipboard unavailable: ${clipboardError.message}`;
      setOperationNotice({ tone: "error", message });
      onToast(message);
    }
  }, [onToast, selectedPaths, transfer]);

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

  const startTransfer = useCallback(async (request, conflictPolicy) => {
    setOperationBusy("Start transfer");
    setOperationNotice(null);
    try {
      const started = normalizeTransferSnapshot(await platform.explorer.startTransfer(
        request.paths,
        request.destinationPath,
        request.mode,
        conflictPolicy,
      ));
      handledTerminalTransfersRef.current.delete(started.jobId);
      dismissedTransfersRef.current.delete(started.jobId);
      setTransfer(started);
      setPendingTransfer(null);
      setOperationNotice({
        tone: "info",
        message: `${request.mode === "move" ? "Move" : "Copy"} queued · ${request.paths.length} item${request.paths.length === 1 ? "" : "s"}`,
      });
    } catch (transferError) {
      const message = `Transfer failed to start: ${transferError.message}`;
      setOperationNotice({ tone: "error", message });
      onToast(message);
    } finally {
      setOperationBusy(null);
    }
  }, [onToast]);

  const queueTransfer = useCallback(async (paths, destinationPath, mode) => {
    if (!paths?.length || !destinationPath || operationBusy ||
        (transfer && !isTransferTerminal(transfer.status))) return;
    setOperationBusy("Transfer preflight");
    setOperationNotice(null);
    const request = {
      paths: [...paths],
      destinationPath,
      mode,
    };
    try {
      const preflight = normalizeTransferPreflight(await platform.explorer.preflightTransfer(
        request.paths,
        request.destinationPath,
        request.mode,
      ));
      if (preflight.conflicts.length > 0) {
        setPendingTransfer({ ...request, preflight });
        return;
      }
      await startTransfer({ ...request, preflight }, "rename");
    } catch (preflightError) {
      const message = `Transfer preflight failed: ${preflightError.message}`;
      setOperationNotice({ tone: "error", message });
      onToast(message);
    } finally {
      setOperationBusy(null);
    }
  }, [onToast, operationBusy, startTransfer, transfer]);

  const pasteClipboard = useCallback(async () => {
    try {
      const state = await platform.clipboard.read();
      const paths = Array.isArray(state?.paths) ? state.paths : [];
      const mode = state?.mode === "move" ? "move" : "copy";
      setClipboard(paths.length > 0 ? { paths, mode } : null);
      await queueTransfer(paths, snapshot.currentPath, mode);
    } catch (clipboardError) {
      const message = `Unable to read Windows clipboard: ${clipboardError.message}`;
      setOperationNotice({ tone: "error", message });
      onToast(message);
    }
  }, [onToast, queueTransfer, snapshot.currentPath]);

  const allowFileDrop = useCallback((event) => {
    if (!hasFileDrag(event.dataTransfer) ||
        operationBusy ||
        (transfer && !isTransferTerminal(transfer.status))) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = getFileDropMode(event);
  }, [operationBusy, transfer]);

  const dropFiles = useCallback((event, destinationPath = snapshot.currentPath) => {
    const payload = parseFileDrag(event.dataTransfer);
    if (!payload || !destinationPath) return;
    event.preventDefault();
    event.stopPropagation();
    void queueTransfer(payload.paths, destinationPath, getFileDropMode(event));
  }, [queueTransfer, snapshot.currentPath]);

  useEffect(() => {
    if (!open) return undefined;
    return platform.events.subscribe("desktop.externalDrop", (payload) => {
      if (!Number.isFinite(payload?.clientX) || !Number.isFinite(payload?.clientY)) return;
      const target = document.elementFromPoint(payload.clientX, payload.clientY);
      if (!target?.closest(".jarvis-explorer")) return;
      const paths = Array.isArray(payload.paths) ? payload.paths : [];
      void queueTransfer(paths, snapshot.currentPath, "copy");
    });
  }, [open, queueTransfer, snapshot.currentPath]);

  const cancelTransfer = useCallback(async () => {
    if (!transfer || isTransferTerminal(transfer.status)) return;
    try {
      const cancelled = normalizeTransferSnapshot(await platform.explorer.cancelTransfer(transfer.jobId));
      setTransfer(cancelled);
    } catch (cancelError) {
      const message = `Unable to cancel transfer: ${cancelError.message}`;
      setOperationNotice({ tone: "error", message });
      onToast(message);
    }
  }, [onToast, transfer]);

  const openCreateDialog = useCallback(() => {
    if (!snapshot.currentPath || operationBusy || (transfer && !isTransferTerminal(transfer.status))) return;
    setCommandDialog({
      id: `create-${Date.now()}`,
      type: "create",
      title: "CREATE NEW FOLDER",
      description: "Create a folder in the current location.",
      label: "FOLDER NAME",
      initialValue: "New folder",
      confirmLabel: "CREATE FOLDER",
    });
  }, [operationBusy, snapshot.currentPath, transfer]);

  const openRenameDialog = useCallback(() => {
    if (selectedEntries.length !== 1 || operationBusy || (transfer && !isTransferTerminal(transfer.status))) return;
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
  }, [operationBusy, selectedEntries, transfer]);

  const openRecycleDialog = useCallback(() => {
    if (selectedEntries.length === 0 || operationBusy || (transfer && !isTransferTerminal(transfer.status))) return;
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
  }, [operationBusy, selectedEntries, transfer]);

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
    if (!open || !active) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        const action = getExplorerEscapeAction({
          addressEditing,
          pendingTransfer,
          commandDialog,
          search,
          selectionCount: selectedPaths.length,
        });
        if (action === "cancel-address") {
          setAddressEditing(false);
          setAddressValue(snapshot.currentPath);
        } else if (action === "cancel-transfer") {
          setPendingTransfer(null);
        } else if (action === "cancel-dialog") {
          setCommandDialog(null);
        } else if (action === "clear-search") {
          clearExplorerSearch();
        } else if (action === "clear-selection") {
          setSelectedPaths([]);
          setSelectionAnchor(null);
        } else {
          onClose();
        }
        return;
      }

      const explorerCommand = getExplorerKeyboardCommand(event);
      if (explorerCommand) {
        event.preventDefault();
        if (explorerCommand === "focus-address") {
          beginAddressEdit();
        } else if (explorerCommand === "focus-search") {
          searchRef.current?.focus();
          searchRef.current?.select();
        } else if (explorerCommand === "copy-path") {
          void copySelectedPaths();
        } else if (explorerCommand === "back" && historyIndex > 0) {
          void navigateHistory(historyIndex - 1);
        } else if (explorerCommand === "forward" && historyIndex < history.length - 1) {
          void navigateHistory(historyIndex + 1);
        } else if (explorerCommand === "up" && snapshot.parentPath) {
          void navigate(snapshot.parentPath);
        } else if (explorerCommand === "refresh" && snapshot.currentPath) {
          void browse(snapshot.currentPath, { clearSearch: false });
        }
        return;
      }

      const target = event.target;
      const isEditing = target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      if (isEditing || commandDialog || pendingTransfer || operationBusy) return;

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
    addressEditing,
    beginAddressEdit,
    browse,
    clearExplorerSearch,
    commandDialog,
    copySelectedPaths,
    copySelection,
    active,
    history,
    historyIndex,
    navigate,
    navigateHistory,
    onClose,
    open,
    openCreateDialog,
    openRecycleDialog,
    openRenameDialog,
    operationBusy,
    pasteClipboard,
    pendingTransfer,
    search,
    selectedPaths.length,
    snapshot.currentPath,
    snapshot.parentPath,
    visibleEntries,
  ]);

  if (!open) return null;

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < history.length - 1;
  const hasSelection = selectedEntries.length > 0;
  const canRename = selectedEntries.length === 1;
  const transferActive = Boolean(transfer && !isTransferTerminal(transfer.status));
  const canPaste = Boolean(clipboard?.paths.length && snapshot.currentPath && !transferActive);
  const searchSummary = getExplorerSearchSummary(
    snapshot.entries.length,
    visibleEntries.length,
    deferredSearch,
  );

  return (
    <div className="explorer-layer" aria-hidden={false}>
      <section className="jarvis-explorer" role="dialog" aria-modal="false" aria-label="JARVIS File Explorer">
        <header
          className="explorer-titlebar"
          data-window-drag-handle
          aria-keyshortcuts="Alt+F4 Alt+F9 Alt+F10"
        >
          <FolderRegular aria-hidden="true" />
          <strong>FILE EXPLORER</strong>
          <span>LOCAL FILESYSTEM · RECYCLE-SAFE WRITE MODE</span>
          <div className="explorer-window-actions" data-no-window-drag>
            <button type="button" aria-label="Minimize JARVIS File Explorer" onClick={onMinimize}>—</button>
            <button
              type="button"
              aria-label={maximized ? "Restore JARVIS File Explorer" : "Maximize JARVIS File Explorer"}
              onClick={onToggleMaximize}
            >
              {maximized ? "❐" : "□"}
            </button>
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

          {addressEditing ? (
            <form
              className="explorer-address-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitAddress();
              }}
            >
              <input
                ref={addressRef}
                value={addressValue}
                maxLength={2_048}
                aria-label="Explorer address"
                spellCheck="false"
                autoComplete="off"
                onChange={(event) => setAddressValue(event.target.value)}
              />
              <button type="submit" disabled={loading}>GO</button>
            </form>
          ) : (
            <nav
              className="explorer-breadcrumbs"
              aria-label="Current path"
              onDoubleClick={beginAddressEdit}
            >
              {snapshot.breadcrumbs.map((breadcrumb, index) => (
                <button key={breadcrumb.path} type="button" disabled={loading} onClick={() => navigate(breadcrumb.path)}>
                  <span>{breadcrumb.label}</span>
                  {index < snapshot.breadcrumbs.length - 1 ? <small>›</small> : null}
                </button>
              ))}
              {loading ? <span className="explorer-scan-line">SCANNING</span> : null}
              <button
                type="button"
                className="explorer-address-trigger"
                onClick={beginAddressEdit}
                title="Edit address · Ctrl+L"
                aria-label="Edit Explorer address"
              >
                PATH
              </button>
            </nav>
          )}

          <div className="explorer-search">
            <SearchRegular aria-hidden="true" />
            <input
              ref={searchRef}
              value={search}
              maxLength={96}
              onChange={(event) => setSearch(event.target.value.slice(0, 96))}
              placeholder="Search current folder"
              aria-label="Search current folder"
            />
            {search ? (
              <button
                type="button"
                className="explorer-search-clear"
                aria-label="Clear Explorer search"
                title="Clear search · Escape"
                onClick={clearExplorerSearch}
              >
                <DismissRegular />
              </button>
            ) : null}
          </div>

          <div className="explorer-view-actions">
            <select
              value={sortKey}
              aria-label="Sort folder contents"
              title="Sort folder contents"
              onChange={(event) => setExplorerPreferences((current) => ({
                ...current,
                sortKey: event.target.value,
              }))}
            >
              <option value="name">Name</option>
              <option value="type">Type</option>
              <option value="modified">Modified</option>
              <option value="size">Size</option>
            </select>
            <button
              type="button"
              aria-label={`Sort ${sortDirection === "ascending" ? "descending" : "ascending"}`}
              title={`Sort ${sortDirection === "ascending" ? "descending" : "ascending"}`}
              onClick={() => setExplorerPreferences((current) => ({
                ...current,
                sortDirection: current.sortDirection === "ascending"
                  ? "descending"
                  : "ascending",
              }))}
            >
              {sortDirection === "ascending" ? "↑" : "↓"}
            </button>
            <button type="button" className={viewMode === "list" ? "is-active" : ""} aria-label="Details view" onClick={() => setExplorerPreferences((current) => ({ ...current, viewMode: "list" }))}><ListRegular /></button>
            <button type="button" className={viewMode === "grid" ? "is-active" : ""} aria-label="Grid view" onClick={() => setExplorerPreferences((current) => ({ ...current, viewMode: "grid" }))}><GridRegular /></button>
            <button type="button" aria-label="Open current folder with Windows File Explorer" onClick={() => openInWindows()}><MoreHorizontalRegular /></button>
          </div>
        </div>

        <div className="explorer-commandbar" role="toolbar" aria-label="File operations">
          <button type="button" disabled={!snapshot.currentPath || Boolean(operationBusy) || transferActive} onClick={openCreateDialog}><FolderAddRegular /><span>NEW FOLDER</span><kbd>CTRL+SHIFT+N</kbd></button>
          <button type="button" disabled={!canRename || Boolean(operationBusy) || transferActive} onClick={openRenameDialog}><RenameRegular /><span>RENAME</span><kbd>F2</kbd></button>
          <button type="button" disabled={!hasSelection || Boolean(operationBusy) || transferActive} onClick={() => copySelection("copy")}><CopyRegular /><span>COPY</span><kbd>CTRL+C</kbd></button>
          <button type="button" disabled={!hasSelection} onClick={() => void copySelectedPaths()}><CodeRegular /><span>COPY PATH</span><kbd>CTRL+SHIFT+C</kbd></button>
          <button type="button" disabled={!hasSelection || Boolean(operationBusy) || transferActive} onClick={() => copySelection("move")}><CutRegular /><span>CUT</span><kbd>CTRL+X</kbd></button>
          <button type="button" disabled={!canPaste || Boolean(operationBusy)} onClick={pasteClipboard}><ClipboardPasteRegular /><span>PASTE</span><kbd>CTRL+V</kbd></button>
          <button type="button" className="is-danger" disabled={!hasSelection || Boolean(operationBusy) || transferActive} onClick={openRecycleDialog}><DeleteRegular /><span>RECYCLE</span><kbd>DEL</kbd></button>
          <div className="explorer-clipboard-status" aria-live="polite">
            <span>WINDOWS CLIPBOARD</span>
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
              ref={fileViewportRef}
              className="explorer-file-viewport"
              onDragOver={allowFileDrop}
              onDrop={(event) => dropFiles(event)}
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setSelectedPaths([]);
                  setSelectionAnchor(null);
                }
              }}
            >
              {error ? <div className="explorer-empty"><strong>ACCESS INTERRUPTED</strong><span>{error.message}</span></div> : null}
              {!error && !loading && visibleEntries.length === 0 ? (
                <div className="explorer-empty">
                  {deferredSearch ? <SearchRegular /> : <FolderRegular />}
                  <strong>{deferredSearch ? "NO SEARCH MATCH" : "FOLDER EMPTY"}</strong>
                  <span>{deferredSearch
                    ? `No item in this folder matches “${search.trim()}”.`
                    : "This folder does not contain any items."}</span>
                  {deferredSearch ? (
                    <button type="button" onClick={clearExplorerSearch}>CLEAR SEARCH</button>
                  ) : null}
                </div>
              ) : null}
              {!error ? visibleEntries.map((entry) => {
                const selected = selectedPathSet.has(entry.path);
                return (
                  <button
                    key={entry.path}
                    ref={(element) => {
                      if (element) entryRefs.current.set(entry.path, element);
                      else entryRefs.current.delete(entry.path);
                    }}
                    type="button"
                    className={`explorer-entry ${selected ? "is-selected" : ""} ${clipboardPathSet.has(entry.path) ? "is-cut" : ""}`}
                    title={entry.path}
                    aria-pressed={selected}
                    tabIndex={focusedPath === entry.path ? 0 : -1}
                    draggable
                    onFocus={() => setFocusedPath(entry.path)}
                    onClick={(event) => selectEntry(entry, event)}
                    onDoubleClick={() => openEntry(entry)}
                    onDragStart={(event) => {
                      const paths = selected && selectedPaths.length > 0
                        ? selectedPaths
                        : [entry.path];
                      writeFileDrag(event.dataTransfer, paths, "explorer");
                    }}
                    onDragOver={entry.isDirectory ? allowFileDrop : undefined}
                    onDrop={entry.isDirectory
                      ? (event) => dropFiles(event, entry.path)
                      : undefined}
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
                        const columns = getExplorerGridColumnCount(
                          fileViewportRef.current?.clientWidth,
                          viewMode,
                        );
                        focusEntryAt(
                          getExplorerKeyboardTarget(
                            visibleEntries.length,
                            visibleEntries.indexOf(entry),
                            event.key,
                            columns,
                          ),
                          event.shiftKey,
                        );
                      } else if (event.key === "Enter") {
                        event.preventDefault();
                        void openEntry(entry);
                      }
                    }}
                  >
                    <span className="explorer-entry-name">
                      <EntryIcon kind={entry.kind} />
                      <strong><ExplorerSearchLabel value={entry.name} query={deferredSearch} /></strong>
                    </span>
                    <span><ExplorerSearchLabel value={entry.typeLabel} query={deferredSearch} /></span>
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
          <span>{searchSummary.label}</span>
          {deferredSearch ? <span>FILTER · {search.trim()}</span> : null}
          {selectedEntries.length > 0 ? <span>{selectedEntries.length} SELECTED · {formatFileSize(selectionSize)}</span> : <span>NO SELECTION</span>}
          {operationNotice ? <strong className={`is-${operationNotice.tone}`}>{operationNotice.message}</strong> : null}
          {!operationNotice && snapshot.warning ? <strong>{snapshot.warning}</strong> : null}
          <small>{operationBusy ? `${operationBusy.toUpperCase()} IN PROGRESS` : transferActive ? "BACKGROUND TRANSFER ACTIVE · CANCELLATION SAFE" : "LOCAL FILESYSTEM · READ / WRITE · RECYCLE SAFE"}</small>
        </footer>

        <ExplorerTransferPanel
          transfer={transfer}
          onCancel={cancelTransfer}
          onDismiss={() => {
            if (transfer) dismissedTransfersRef.current.add(transfer.jobId);
            setTransfer(null);
          }}
        />

        {pendingTransfer ? (
          <ExplorerConflictDialog
            pending={pendingTransfer}
            busy={Boolean(operationBusy)}
            onCancel={() => setPendingTransfer(null)}
            onChoose={(policy) => startTransfer(pendingTransfer, policy)}
          />
        ) : null}

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
