import {
  ArrowRightRegular,
  DismissRegular,
  DocumentRegular,
  FolderRegular,
  SearchRegular,
  WindowAppsRegular,
} from "@fluentui/react-icons";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useApplicationCatalog,
  useDesktopEntries,
  useTaskbarSnapshot,
} from "../hooks/usePlatformData.js";
import {
  createQuickSearchIndex,
  searchQuickIndex,
  segmentSearchMatch,
} from "../quick-search.js";
import { quickLaunchItems, quickSettingItems } from "../quick-search-catalog.js";
import { useDialogFocusTrap } from "../hooks/useDialogFocusTrap.js";
import { useRecentApplicationIds } from "../hooks/useRecentApplications.js";

function QuickSearchIcon({ result }) {
  if (result.iconDataUrl) {
    return <img src={result.iconDataUrl} alt="" />;
  }

  if (result.Icon) {
    const Icon = result.Icon;
    return <Icon />;
  }

  if (result.kind === "window" || result.kind === "installed-app") return <WindowAppsRegular />;
  if (result.entry?.kind === "directory") return <FolderRegular />;
  return <DocumentRegular />;
}

function QuickSearchLabel({ label, query }) {
  return segmentSearchMatch(label, query).map((segment, index) => (
    segment.match
      ? <mark key={`${segment.text}-${index}`}>{segment.text}</mark>
      : <span key={`${segment.text}-${index}`}>{segment.text}</span>
  ));
}

function getQuickSearchOptionId(resultId) {
  return `quick-search-${encodeURIComponent(resultId)}`;
}

export function CommandOverlay({
  open,
  onClose,
  onExecute,
  busy = false,
  statusMessage = null,
  surfaceLabel = "LOCAL QUICK ACCESS",
}) {
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const [value, setValue] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const deferredValue = useDeferredValue(value);
  const applicationCatalog = useApplicationCatalog();
  const desktop = useDesktopEntries();
  const taskbar = useTaskbarSnapshot();
  const recentApplicationIds = useRecentApplicationIds();

  useDialogFocusTrap(dialogRef, open, { initialFocusRef: inputRef, onEscape: onClose });

  const searchIndex = useMemo(() => createQuickSearchIndex({
    launchItems: quickLaunchItems,
    installedApplications: applicationCatalog.applications,
    recentApplicationIds,
    settingItems: quickSettingItems,
    windows: taskbar.windows,
    desktopEntries: desktop.entries,
  }), [
    applicationCatalog.applications,
    desktop.entries,
    recentApplicationIds,
    taskbar.windows,
  ]);

  const results = useMemo(
    () => searchQuickIndex(searchIndex, deferredValue),
    [deferredValue, searchIndex],
  );
  const selectedIndex = results.length > 0
    ? Math.min(activeIndex, results.length - 1)
    : 0;
  const selectedResult = results[selectedIndex] ?? null;
  const selectedOptionId = selectedResult
    ? getQuickSearchOptionId(selectedResult.resultId)
    : undefined;
  const resultStatus = applicationCatalog.error
    ? "START MENU UNAVAILABLE"
    : applicationCatalog.loading
      ? "INDEXING START MENU"
      : desktop.loading
        ? "INDEXING DESKTOP"
        : `${results.length} RESULTS`;

  useEffect(() => {
    if (!open || !selectedOptionId) return;
    document.getElementById(selectedOptionId)?.scrollIntoView({ block: "nearest" });
  }, [open, selectedOptionId]);

  if (!open) return null;

  const execute = (result) => {
    if (!result || busy) return;
    onExecute(result);
  };

  const handleInputKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => results.length > 0 ? (current + 1) % results.length : 0);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => results.length > 0
        ? (current - 1 + results.length) % results.length
        : 0);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, results.length - 1));
    }
  };

  return (
    <div className="overlay-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={dialogRef}
        className={`command-palette hud-panel${busy ? " is-busy" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="JARVIS quick search"
        aria-busy={busy}
      >
        <header className="command-header">
          <span><img src="/assets/jarvis-top-agent-ready-core-v1.png" alt="" /> JARVIS SEARCH</span>
          <small>{surfaceLabel}</small>
          <button type="button" onClick={onClose} aria-label="Close quick search" disabled={busy}><DismissRegular /></button>
        </header>

        <form onSubmit={(event) => { event.preventDefault(); execute(selectedResult); }}>
          <SearchRegular />
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => {
              setValue(event.target.value.slice(0, 160));
              setActiveIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Search apps, windows, desktop items, and settings"
            aria-label="Quick search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-haspopup="listbox"
            aria-controls="jarvis-quick-search-results"
            aria-describedby="jarvis-quick-search-status"
            aria-activedescendant={selectedOptionId}
            autoComplete="off"
            spellCheck="false"
            maxLength={160}
            disabled={busy}
          />
          <button type="submit" className="run-command" aria-label="Open selected result" disabled={!selectedResult || busy}><ArrowRightRegular /></button>
        </form>

        <div className="command-results-heading">
          <span>{value.trim() ? "BEST MATCHES" : "QUICK ACCESS"}</span>
          <small id="jarvis-quick-search-status" aria-live="polite" aria-atomic="true">
            {resultStatus}
          </small>
        </div>

        <div
          id="jarvis-quick-search-results"
          className="command-results"
          role="listbox"
          aria-label="Quick search results"
          aria-busy={applicationCatalog.loading || desktop.loading}
        >
          {results.length > 0 ? results.map((result, index) => (
            <button
              id={getQuickSearchOptionId(result.resultId)}
              key={result.resultId}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className={index === selectedIndex ? "is-active" : ""}
              disabled={busy}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => execute(result)}
            >
              <span className="command-result-icon" aria-hidden="true"><QuickSearchIcon result={result} /></span>
              <span className="command-result-copy">
                <strong><QuickSearchLabel label={result.label} query={deferredValue} /></strong>
                <small>{result.detail}</small>
              </span>
              <span className="command-result-category">{result.category}</span>
              <ArrowRightRegular className="command-result-arrow" aria-hidden="true" />
            </button>
          )) : (
            <div className="command-empty-state" role="status">
              <SearchRegular />
              <span><strong>No local result</strong><small>Try an application, open window, desktop item, or Windows setting.</small></span>
            </div>
          )}
        </div>

        <footer>
          <span>↑ ↓ NAVIGATE</span>
          <span>ENTER OPEN</span>
          <span>ESC CLOSE</span>
          {statusMessage ? <strong role="status" aria-live="polite">{statusMessage}</strong> : null}
          <span>{busy ? "VERIFYING CAPABILITY" : "LOCAL INDEX · NO VOICE"}</span>
        </footer>
      </section>
    </div>
  );
}
