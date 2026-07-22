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
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useApplicationCatalog,
  useDesktopEntries,
  useTaskbarSnapshot,
} from "../hooks/usePlatformData.js";
import { createQuickSearchIndex, searchQuickIndex } from "../quick-search.js";
import { quickLaunchItems, quickSettingItems } from "../quick-search-catalog.js";
import { useDialogFocusTrap } from "../hooks/useDialogFocusTrap.js";

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

export function CommandOverlay({ open, onClose, onExecute }) {
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const [value, setValue] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const deferredValue = useDeferredValue(value);
  const applicationCatalog = useApplicationCatalog();
  const desktop = useDesktopEntries();
  const taskbar = useTaskbarSnapshot();

  useDialogFocusTrap(dialogRef, open, { initialFocusRef: inputRef, onEscape: onClose });

  const searchIndex = useMemo(() => createQuickSearchIndex({
    launchItems: quickLaunchItems,
    installedApplications: applicationCatalog.applications,
    settingItems: quickSettingItems,
    windows: taskbar.windows,
    desktopEntries: desktop.entries,
  }), [applicationCatalog.applications, desktop.entries, taskbar.windows]);

  const results = useMemo(
    () => searchQuickIndex(searchIndex, deferredValue),
    [deferredValue, searchIndex],
  );
  const selectedIndex = results.length > 0
    ? Math.min(activeIndex, results.length - 1)
    : 0;
  const selectedResult = results[selectedIndex] ?? null;

  if (!open) return null;

  const execute = (result) => {
    if (!result) return;
    setValue("");
    setActiveIndex(0);
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
      <section ref={dialogRef} className="command-palette hud-panel" role="dialog" aria-modal="true" aria-label="JARVIS quick search">
        <header className="command-header">
          <span><img src="/assets/jarvis-top-agent-ready-core-v1.png" alt="" /> JARVIS SEARCH</span>
          <small>LOCAL QUICK ACCESS</small>
          <button type="button" onClick={onClose} aria-label="Close quick search"><DismissRegular /></button>
        </header>

        <form onSubmit={(event) => { event.preventDefault(); execute(selectedResult); }}>
          <SearchRegular />
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Search apps, windows, desktop items, and settings"
            aria-label="Quick search"
            aria-controls="jarvis-quick-search-results"
            aria-activedescendant={selectedResult ? `quick-search-${selectedResult.resultId}` : undefined}
            autoComplete="off"
            spellCheck="false"
          />
          <button type="submit" className="run-command" aria-label="Open selected result" disabled={!selectedResult}><ArrowRightRegular /></button>
        </form>

        <div className="command-results-heading">
          <span>{value.trim() ? "BEST MATCHES" : "QUICK ACCESS"}</span>
          <small>{applicationCatalog.error
            ? "START MENU UNAVAILABLE"
            : applicationCatalog.loading
            ? "INDEXING START MENU"
            : desktop.loading
              ? "INDEXING DESKTOP"
              : `${results.length} RESULTS`}</small>
        </div>

        <div id="jarvis-quick-search-results" className="command-results" role="listbox" aria-label="Quick search results">
          {results.length > 0 ? results.map((result, index) => (
            <button
              id={`quick-search-${result.resultId}`}
              key={result.resultId}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className={index === selectedIndex ? "is-active" : ""}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => execute(result)}
            >
              <span className="command-result-icon" aria-hidden="true"><QuickSearchIcon result={result} /></span>
              <span className="command-result-copy">
                <strong>{result.label}</strong>
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
          <span>LOCAL INDEX · NO VOICE</span>
        </footer>
      </section>
    </div>
  );
}
