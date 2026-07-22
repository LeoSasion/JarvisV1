import {
  AddRegular,
  DismissRegular,
  SearchRegular,
  SubtractRegular,
  WindowConsoleRegular,
} from "@fluentui/react-icons";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { platform } from "../platform/index.js";

const MAX_TABS = 5;
const DEFAULT_COLUMNS = 120;
const DEFAULT_ROWS = 32;

function createLocalTab(sequence, profile) {
  return {
    localId: `terminal-tab-${sequence}`,
    profileId: profile.id,
    label: profile.label,
    status: "connecting",
    sessionId: null,
    processId: null,
  };
}

function readTerminalTheme() {
  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    background: read("--terminal-bg", "#01060d"),
    foreground: read("--terminal-fg", "#dceef6"),
    cursor: read("--glow-core", "#d9fbff"),
    cursorAccent: read("--terminal-bg", "#01060d"),
    selectionBackground: "rgba(20, 143, 224, 0.30)",
    overviewRulerBorder: "rgba(34, 207, 255, 0.18)",
    black: "#02070d",
    red: "#ed6252",
    green: "#8dd082",
    yellow: "#e3bd67",
    blue: "#4b91ff",
    magenta: "#a58cff",
    cyan: "#22cfff",
    white: "#dceef6",
    brightBlack: "#617487",
    brightRed: "#ff7b6d",
    brightGreen: "#a6e39b",
    brightYellow: "#f4d27d",
    brightBlue: "#75b2ff",
    brightMagenta: "#c1afff",
    brightCyan: "#8feaff",
    brightWhite: "#f5fdff",
  };
}

function TerminalViewport({ tab, active, onSessionState, onToast }) {
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const searchAddonRef = useRef(null);
  const sessionIdRef = useRef(null);
  const activeRef = useRef(active);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    activeRef.current = active;
    if (!active || !terminalRef.current || !fitAddonRef.current) return undefined;
    const frame = window.requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit();
        terminalRef.current?.focus();
      } catch {
        // A tab can be removed while its activation frame is pending.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let mounted = true;
    let resizeFrame = 0;
    let flushTimer = 0;
    let pendingInput = "";
    let lastColumns = 0;
    let lastRows = 0;
    let lastSequence = 0;
    let writeQueue = Promise.resolve();
    let inputFailureReported = false;
    let webglAddon = null;

    const terminal = new Terminal({
      allowProposedApi: false,
      allowTransparency: true,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      cursorWidth: 2,
      disableStdin: false,
      drawBoldTextInBrightColors: true,
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 14,
      fontWeight: "400",
      fontWeightBold: "600",
      letterSpacing: 0.2,
      lineHeight: 1.14,
      minimumContrastRatio: 4.5,
      overviewRuler: { width: 8, showTopBorder: false, showBottomBorder: false },
      rightClickSelectsWord: true,
      scrollback: 6000,
      smoothScrollDuration: 80,
      theme: readTerminalTheme(),
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.open(container);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    const flushInput = () => {
      flushTimer = 0;
      const sessionId = sessionIdRef.current;
      const data = pendingInput;
      pendingInput = "";
      if (!sessionId || !data) return;
      writeQueue = writeQueue
        .then(() => platform.terminal.write(sessionId, data))
        .catch((error) => {
          if (!inputFailureReported) {
            inputFailureReported = true;
            onToast(`Terminal input failed: ${error.message}`);
          }
        });
    };

    const inputDisposable = terminal.onData((data) => {
      pendingInput += data;
      if (!flushTimer) flushTimer = window.setTimeout(flushInput, 8);
    });
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && event.ctrlKey && event.key.toLowerCase() === "f") {
        setSearchOpen(true);
        return false;
      }
      return true;
    });

    const stopOutput = platform.events.subscribe("terminal.output", (chunk) => {
      if (chunk?.sessionId !== sessionIdRef.current || !mounted) return;
      const sequence = Number(chunk.sequence ?? 0);
      if (sequence > 0 && sequence <= lastSequence) return;
      lastSequence = Math.max(lastSequence, sequence);
      terminal.write(String(chunk.data ?? ""));
    });
    const stopExit = platform.events.subscribe("terminal.exited", (exit) => {
      if (exit?.sessionId !== sessionIdRef.current || !mounted) return;
      terminal.write(`\r\n\u001b[38;2;231;73;49m[process exited${exit.exitCode == null ? "" : ` · code ${exit.exitCode}`} ]\u001b[0m\r\n`);
      terminal.options.disableStdin = true;
      onSessionState(tab.localId, { status: "exited" });
    });
    const handleThemeChange = () => {
      terminal.options.theme = readTerminalTheme();
    };
    window.addEventListener("jarvis:theme-changed", handleThemeChange);

    const fitAndResize = () => {
      resizeFrame = 0;
      if (!activeRef.current || !mounted) return;
      try {
        fitAddon.fit();
      } catch {
        return;
      }
      const columns = terminal.cols || DEFAULT_COLUMNS;
      const rows = terminal.rows || DEFAULT_ROWS;
      const sessionId = sessionIdRef.current;
      if (!sessionId || (columns === lastColumns && rows === lastRows)) return;
      lastColumns = columns;
      lastRows = rows;
      void platform.terminal.resize(sessionId, columns, rows).catch(() => {
        // A resize can race process exit; the exit event owns the visible state.
      });
    };
    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(fitAndResize);
    });
    resizeObserver.observe(container);

    void platform.terminal.create(
      tab.profileId,
      terminal.cols || DEFAULT_COLUMNS,
      terminal.rows || DEFAULT_ROWS,
    ).then((session) => {
      if (!mounted) {
        return platform.terminal.close(session.sessionId);
      }
      sessionIdRef.current = session.sessionId;
      lastColumns = session.columns;
      lastRows = session.rows;
      onSessionState(tab.localId, {
        status: "ready",
        sessionId: session.sessionId,
        processId: session.processId,
        label: session.profileLabel,
      });
      terminal.focus();
      return null;
    }).catch((error) => {
      if (!mounted) return;
      terminal.write(`\u001b[38;2;231;73;49mJARVIS TERMINAL LINK FAILED\u001b[0m\r\n${error.message}\r\n`);
      terminal.options.disableStdin = true;
      onSessionState(tab.localId, { status: "error" });
    });

    void import("@xterm/addon-webgl").then(({ WebglAddon }) => {
      if (!mounted) return;
      try {
        webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => webglAddon?.dispose());
        terminal.loadAddon(webglAddon);
      } catch {
        webglAddon = null;
        // Canvas rendering remains a supported fallback.
      }
    });

    return () => {
      mounted = false;
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      if (flushTimer) window.clearTimeout(flushTimer);
      resizeObserver.disconnect();
      stopOutput();
      stopExit();
      window.removeEventListener("jarvis:theme-changed", handleThemeChange);
      inputDisposable.dispose();
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sessionId) void platform.terminal.close(sessionId).catch(() => {});
      webglAddon?.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [onSessionState, onToast, tab.localId, tab.profileId]);

  const runSearch = useCallback((event) => {
    event.preventDefault();
    if (searchQuery) searchAddonRef.current?.findNext(searchQuery, { incremental: true });
    terminalRef.current?.focus();
  }, [searchQuery]);

  return (
    <section
      className={`terminal-viewport${active ? " is-active" : ""}`}
      aria-label={`${tab.label} terminal`}
      aria-hidden={!active}
    >
      <div ref={containerRef} className="terminal-canvas" />
      {searchOpen && active ? (
        <form className="terminal-search" onSubmit={runSearch}>
          <SearchRegular />
          <input
            autoFocus
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Find in terminal"
            aria-label="Find in terminal"
          />
          <button type="submit">NEXT</button>
          <button type="button" onClick={() => setSearchOpen(false)} aria-label="Close terminal search">
            <DismissRegular />
          </button>
        </form>
      ) : null}
    </section>
  );
}

export function TerminalWorkbench({ open, onClose, onToast }) {
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState("powershell");
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [minimized, setMinimized] = useState(false);
  const sequenceRef = useRef(0);

  const addTab = useCallback((profileId = selectedProfileId, sourceProfiles = profiles) => {
    if (tabs.length >= MAX_TABS) {
      onToast(`Terminal tab limit reached (${MAX_TABS})`);
      return;
    }
    const profile = sourceProfiles.find((candidate) => candidate.id === profileId && candidate.available)
      ?? sourceProfiles.find((candidate) => candidate.available);
    if (!profile) {
      onToast("No terminal profile is available");
      return;
    }
    const tab = createLocalTab(++sequenceRef.current, profile);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.localId);
  }, [onToast, profiles, selectedProfileId, tabs.length]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    platform.terminal.listProfiles()
      .then((result) => {
        if (!active) return;
        const availableProfiles = (result.profiles ?? []).filter((profile) => profile.available);
        setProfiles(result.profiles ?? []);
        setSelectedProfileId(result.defaultProfileId ?? availableProfiles[0]?.id ?? "powershell");
        if (!result.conPtyAvailable && platform.isNative) {
          onToast("ConPTY is unavailable on this Windows version");
          return;
        }
        if (availableProfiles.length > 0) {
          const initialProfile = availableProfiles.find((profile) => profile.id === result.defaultProfileId)
            ?? availableProfiles[0];
          const tab = createLocalTab(++sequenceRef.current, initialProfile);
          setTabs([tab]);
          setActiveTabId(tab.localId);
        }
      })
      .catch((error) => onToast(`Terminal profiles unavailable: ${error.message}`));
    return () => {
      active = false;
    };
  }, [onToast, open]);

  const updateSessionState = useCallback((localId, patch) => {
    setTabs((current) => current.map((tab) => (
      tab.localId === localId ? { ...tab, ...patch } : tab
    )));
  }, []);

  const closeTab = useCallback((localId) => {
    const index = tabs.findIndex((tab) => tab.localId === localId);
    if (index < 0) return;
    const next = tabs.filter((tab) => tab.localId !== localId);
    setTabs(next);
    if (activeTabId === localId) {
      setActiveTabId(next[Math.min(index, next.length - 1)]?.localId ?? null);
    }
    if (next.length === 0) window.queueMicrotask(onClose);
  }, [activeTabId, onClose, tabs]);

  if (!open) return null;

  return (
    <div className={`terminal-layer${minimized ? " is-minimized" : ""}`} role="presentation">
      <section className="terminal-workbench" role="dialog" aria-modal="false" aria-label="JARVIS Terminal Workbench">
        <header className="terminal-titlebar">
          <span className="terminal-titlemark"><WindowConsoleRegular /></span>
          <span className="terminal-titlecopy">
            <small>CONPTY SECURE CHANNEL</small>
            <strong>TERMINAL WORKBENCH</strong>
          </span>
          <span className="terminal-link-status"><i />LOCAL HOST · {platform.isNative ? "NATIVE" : "SIMULATION"}</span>
          <button type="button" onClick={() => setMinimized((current) => !current)} aria-label={minimized ? "Restore terminal" : "Minimize terminal"}>
            <SubtractRegular />
          </button>
          <button type="button" onClick={onClose} aria-label="Close terminal"><DismissRegular /></button>
        </header>

        <>
          <div className="terminal-tabbar" role="tablist" aria-label="Terminal sessions">
              <div className="terminal-tabs">
                {tabs.map((tab, index) => (
                  <div key={tab.localId} className={`terminal-tab${activeTabId === tab.localId ? " is-active" : ""}`}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeTabId === tab.localId}
                      onClick={() => setActiveTabId(tab.localId)}
                    >
                      <i className={`is-${tab.status}`} />
                      <span>{tab.label}</span>
                      <small>{String(index + 1).padStart(2, "0")}</small>
                    </button>
                    <button type="button" onClick={() => closeTab(tab.localId)} aria-label={`Close ${tab.label}`}>
                      <DismissRegular />
                    </button>
                  </div>
                ))}
              </div>
              <select
                value={selectedProfileId}
                onChange={(event) => setSelectedProfileId(event.target.value)}
                aria-label="New terminal profile"
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id} disabled={!profile.available}>
                    {profile.label}{profile.available ? "" : " · unavailable"}
                  </option>
                ))}
              </select>
              <button type="button" className="terminal-new-tab" onClick={() => addTab()} disabled={tabs.length >= MAX_TABS}>
                <AddRegular /><span>NEW SESSION</span>
              </button>
          </div>

          <div className="terminal-stage">
            <div className="terminal-stage-grid" aria-hidden="true" />
            {tabs.map((tab) => (
              <TerminalViewport
                key={tab.localId}
                tab={tab}
                active={!minimized && activeTabId === tab.localId}
                onSessionState={updateSessionState}
                onToast={onToast}
              />
            ))}
            {tabs.length === 0 ? <div className="terminal-empty">ESTABLISHING CONPTY CHANNEL…</div> : null}
          </div>

          <footer className="terminal-statusbar">
            <span><i />UTF-8</span>
            <span>VT SEQUENCES</span>
            <span>CTRL+F · SEARCH</span>
            <span>SCROLLBACK · 6000</span>
            <strong>{tabs.find((tab) => tab.localId === activeTabId)?.status?.toUpperCase() ?? "STANDBY"}</strong>
          </footer>
        </>
      </section>
    </div>
  );
}
