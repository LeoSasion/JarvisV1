import { useEffect, useMemo, useState } from "react";
import { mockTaskbarSnapshot } from "./platform/mock-platform.js";
import {
  advanceWindowSwitcherState,
  getVisibleWindowSwitcherEntries,
  getWindowInitials,
  normalizeWindowSwitcherState,
} from "./window-switcher-model.js";
import { JarvisMark } from "./components/VectorMarks.jsx";

function createPreviewState() {
  const requestedIndex = Number.parseInt(
    new URLSearchParams(window.location.search).get("selected") ?? "1",
    10,
  );
  return normalizeWindowSwitcherState({
    windows: mockTaskbarSnapshot.windows,
    selectedIndex: Number.isFinite(requestedIndex) ? requestedIndex : 1,
    reverse: false,
  });
}

function WindowIcon({ entry }) {
  if (entry.iconDataUrl) {
    return <img src={entry.iconDataUrl} alt="" />;
  }
  return <span aria-hidden="true">{getWindowInitials(entry.processName)}</span>;
}

export function WindowSwitcherSurface() {
  const [state, setState] = useState(createPreviewState);
  const visibleEntries = useMemo(
    () => getVisibleWindowSwitcherEntries(state),
    [state],
  );
  const selectedWindow = state.selectedIndex >= 0
    ? state.windows[state.selectedIndex]
    : null;

  useEffect(() => {
    const handleNativeState = (event) => {
      setState(normalizeWindowSwitcherState(event.detail));
    };
    window.addEventListener("jarvis:window-switcher-state", handleNativeState);
    return () => window.removeEventListener("jarvis:window-switcher-state", handleNativeState);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== "Tab") return;
      event.preventDefault();
      setState((current) => advanceWindowSwitcherState(current, event.shiftKey));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <main className="jarvis-window-switcher" aria-label="JARVIS window switcher">
      <div className="window-switcher-field" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <section className="window-switcher-chassis" aria-live="polite">
        <header className="window-switcher-header">
          <div className="window-switcher-brand">
            <JarvisMark />
            <div>
              <span>JARVIS WINDOW CHANNEL</span>
              <small>FOREGROUND ROUTING · SECURE LOCAL CONTROL</small>
            </div>
          </div>
          <div className="window-switcher-counter">
            <strong>{String(Math.max(0, state.selectedIndex + 1)).padStart(2, "0")}</strong>
            <span>/</span>
            <small>{String(state.windows.length).padStart(2, "0")}</small>
          </div>
        </header>

        <div className="window-switcher-rail" role="listbox" aria-label="Open windows">
          {visibleEntries.map(({ window: entry, index, selected }) => (
            <button
              key={entry.windowId}
              type="button"
              className={`window-switcher-card ${selected ? "is-selected" : ""}`}
              role="option"
              aria-selected={selected}
              onClick={() => setState((current) => ({
                ...normalizeWindowSwitcherState(current),
                selectedIndex: index,
              }))}
            >
              <span className="window-switcher-card-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="window-switcher-icon">
                <WindowIcon entry={entry} />
              </span>
              <span className="window-switcher-copy">
                <strong>{entry.title}</strong>
                <small>
                  {entry.processName.toUpperCase()}
                  <i aria-hidden="true">·</i>
                  {entry.minimized ? "SUSPENDED" : entry.active ? "ACTIVE" : "READY"}
                </small>
              </span>
              <span className="window-switcher-corners" aria-hidden="true" />
            </button>
          ))}
        </div>

        <footer className="window-switcher-footer">
          <div className="window-switcher-selected">
            <span>SELECTED TARGET</span>
            <strong>{selectedWindow?.title ?? "NO ELIGIBLE WINDOW"}</strong>
          </div>
          <div className="window-switcher-progress" aria-hidden="true">
            {state.windows.slice(0, 12).map((entry, index) => (
              <span
                key={entry.windowId}
                className={index === state.selectedIndex ? "is-current" : ""}
              />
            ))}
          </div>
          <div className="window-switcher-instructions">
            <kbd>ALT</kbd>
            <span>RELEASE TO ACTIVATE</span>
            <i />
            <kbd>SHIFT + TAB</kbd>
            <span>REVERSE</span>
          </div>
        </footer>
      </section>
    </main>
  );
}
