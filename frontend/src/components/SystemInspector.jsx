import {
  ArrowClockwiseRegular,
  DesktopRegular,
  DismissRegular,
  HardDriveRegular,
  PulseRegular,
  SearchRegular,
  WindowAppsRegular,
} from "@fluentui/react-icons";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useSystemSnapshot } from "../hooks/usePlatformData.js";
import { platform } from "../platform/index.js";
import { SparklineCanvas } from "./SparklineCanvas.jsx";

let sharedDetailsRequest = null;

function requestSystemDetails() {
  if (!sharedDetailsRequest) {
    sharedDetailsRequest = platform.system.getDetails().finally(() => {
      sharedDetailsRequest = null;
    });
  }
  return sharedDetailsRequest;
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes >= 1_000_000_000_000) return `${(bytes / 1_000_000_000_000).toFixed(2)} TB`;
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}

function formatStartedAt(value) {
  if (!value) return "PROTECTED";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "UNKNOWN";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).toUpperCase();
}

function OverviewView({ system, details }) {
  return (
    <div className="inspector-overview">
      <div className="inspector-resource-grid">
        {system.resources.map((resource) => (
          <article key={resource.id}>
            <header><span>{resource.label}</span><strong>{resource.value}</strong></header>
            <div><SparklineCanvas points={resource.points ?? Array.from({ length: 17 }, () => resource.segments ?? 0)} /></div>
            <small>{resource.meta}{resource.secondary ? ` · ${resource.secondary}` : ""}</small>
          </article>
        ))}
      </div>

      <section className="inspector-summary-card">
        <header><DesktopRegular /><span><small>ACTIVE HOST</small><strong>{details?.computer?.machineName ?? system.status.machineName}</strong></span></header>
        <dl>
          <div><dt>OPERATING SYSTEM</dt><dd>{details?.computer?.operatingSystem ?? system.status.osDescription}</dd></div>
          <div><dt>PROCESSOR</dt><dd>{details?.computer?.processorName ?? "Reading hardware identity…"}</dd></div>
          <div><dt>LOGICAL PROCESSORS</dt><dd>{details?.computer?.logicalProcessors ?? "—"}</dd></div>
          <div><dt>SESSION UPTIME</dt><dd>{Math.floor(system.status.uptimeSeconds / 3600)} HOURS</dd></div>
        </dl>
      </section>

      <section className={`inspector-sensor-state${details?.sensors?.available ? " is-ready" : ""}`}>
        <PulseRegular />
        <span><strong>HARDWARE SENSOR CHANNEL</strong><small>{details?.sensors?.detail ?? "Waiting for system detail snapshot…"}</small></span>
        <code>{details?.sensors?.available ? "READY" : "ISOLATED"}</code>
      </section>
    </div>
  );
}

function ProcessesView({ details, system, target }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const liveByPid = useMemo(() => new Map(system.processes.map((process) => [process.pid, process])), [system.processes]);
  const processes = useMemo(() => (details?.processes ?? []).filter((process) => (
    !deferredQuery || process.name.toLocaleLowerCase().includes(deferredQuery) || String(process.pid).includes(deferredQuery)
  )), [deferredQuery, details?.processes]);

  return (
    <div className="inspector-processes">
      <label className="inspector-process-search">
        <SearchRegular />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter process name or PID" />
        <span>{processes.length} / {details?.processes?.length ?? 0}</span>
      </label>
      <div className="inspector-process-grid inspector-process-head" aria-hidden="true">
        <span>PROCESS</span><span>PID</span><span>CPU</span><span>WORKING SET</span><span>PRIVATE</span><span>THREADS</span><span>STATE</span><span>STARTED</span>
      </div>
      <div className="inspector-process-list">
        {processes.map((process) => {
          const live = liveByPid.get(process.pid);
          const selected = process.name.toLocaleLowerCase() === String(target ?? "").toLocaleLowerCase();
          return (
            <div key={process.pid} className={`inspector-process-grid${selected ? " is-selected" : ""}`}>
              <span><i />{process.name}</span>
              <code>{process.pid}</code>
              <strong>{live?.cpu ?? "—"}</strong>
              <span>{formatBytes(process.workingSetBytes)}</span>
              <span>{formatBytes(process.privateMemoryBytes)}</span>
              <span>{process.threadCount}</span>
              <span>{process.responding == null ? "SERVICE" : process.responding ? "READY" : "HUNG"}</span>
              <time>{formatStartedAt(process.startedAt)}</time>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HardwareView({ details }) {
  const computer = details?.computer;
  return (
    <div className="inspector-hardware">
      <section className="hardware-identity-card">
        <header><DesktopRegular /><span><small>PLATFORM IDENTITY</small><strong>{computer?.manufacturer ?? "—"} · {computer?.model ?? "—"}</strong></span></header>
        <dl>
          <div><dt>CPU</dt><dd>{computer?.processorName ?? "—"}</dd></div>
          <div><dt>BIOS</dt><dd>{computer?.biosVendor ?? "—"} · {computer?.biosVersion ?? "—"}</dd></div>
          <div><dt>OS BUILD</dt><dd>{computer?.operatingSystemVersion ?? "—"}</dd></div>
        </dl>
      </section>

      <section className="hardware-section">
        <header><WindowAppsRegular /><span>DISPLAY ADAPTERS</span><small>{details?.graphicsAdapters?.length ?? 0}</small></header>
        <div className="hardware-adapter-list">
          {(details?.graphicsAdapters ?? []).map((adapter) => (
            <div key={`${adapter.name}:${adapter.driverVersion}`}><i /><span><strong>{adapter.name}</strong><small>DRIVER {adapter.driverVersion ?? "UNKNOWN"}</small></span></div>
          ))}
          {details?.graphicsAdapters?.length ? null : <p>No display-adapter identity was exposed by Windows.</p>}
        </div>
      </section>

      <section className="hardware-section">
        <header><HardDriveRegular /><span>STORAGE CHANNELS</span><small>{details?.drives?.length ?? 0}</small></header>
        <div className="hardware-drive-list">
          {(details?.drives ?? []).map((drive) => {
            const total = Number(drive.totalBytes) || 0;
            const free = Number(drive.freeBytes) || 0;
            const usedPercent = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
            return (
              <article key={drive.name}>
                <header><strong>{drive.label}</strong><code>{drive.name}</code></header>
                <div><i style={{ width: `${usedPercent}%` }} /></div>
                <small>{formatBytes(total - free)} USED · {formatBytes(free)} FREE · {drive.fileSystem}</small>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function SystemInspector({
  open,
  active,
  target,
  maximized,
  onClose,
  onMinimize,
  onToggleMaximize,
  onToast,
}) {
  const system = useSystemSnapshot();
  const [view, setView] = useState("overview");
  const [details, setDetails] = useState(null);
  const [status, setStatus] = useState("loading");

  const refresh = useCallback(() => {
    setStatus("loading");
    requestSystemDetails()
      .then((result) => {
        setDetails(result);
        setStatus("ready");
        if ((result.processes ?? []).some((process) => process.name.toLocaleLowerCase() === String(target ?? "").toLocaleLowerCase())) {
          setView("processes");
        }
      })
      .catch((error) => {
        setStatus("error");
        onToast(`System details unavailable: ${error.message}`);
      });
  }, [onToast, target]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open || !active) return undefined;
    const handleEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [active, onClose, open]);

  if (!open) return null;

  return (
    <div className="system-inspector-layer">
      <section className="system-inspector" role="dialog" aria-modal="false" aria-label="System inspector">
        <header
          className="system-inspector-titlebar"
          data-window-drag-handle
          aria-keyshortcuts="Alt+F4 Alt+F9 Alt+F10"
        >
          <span><PulseRegular /></span>
          <span><small>ON-DEMAND NATIVE SNAPSHOT</small><strong>SYSTEM INSPECTOR</strong></span>
          <code>{status === "loading" ? "SCANNING" : status === "error" ? "DEGRADED" : "SNAPSHOT READY"}</code>
          <button type="button" data-no-window-drag onClick={refresh} disabled={status === "loading"} aria-label="Refresh system details"><ArrowClockwiseRegular /></button>
          <button type="button" data-no-window-drag onClick={onMinimize} aria-label="Minimize system inspector">—</button>
          <button
            type="button"
            data-no-window-drag
            onClick={onToggleMaximize}
            aria-label={maximized ? "Restore system inspector" : "Maximize system inspector"}
          >
            {maximized ? "❐" : "□"}
          </button>
          <button type="button" data-no-window-drag onClick={onClose} aria-label="Close system inspector"><DismissRegular /></button>
        </header>

        <nav className="system-inspector-tabs" aria-label="System detail views">
          {[
            ["overview", "OVERVIEW"],
            ["processes", "PROCESSES"],
            ["hardware", "HARDWARE"],
          ].map(([id, label]) => (
            <button key={id} type="button" className={view === id ? "is-active" : ""} onClick={() => setView(id)}>{label}</button>
          ))}
          <span>{details?.capturedAt ? new Date(details.capturedAt).toLocaleTimeString() : "—"}</span>
        </nav>

        <div className={`system-inspector-content is-${view}`} aria-busy={status === "loading"}>
          {view === "overview" ? <OverviewView system={system} details={details} /> : null}
          {view === "processes" ? <ProcessesView details={details} system={system} target={target} /> : null}
          {view === "hardware" ? <HardwareView details={details} /> : null}
          {status === "loading" && !details ? <div className="system-inspector-loading"><i /><span>READING WINDOWS SYSTEM STATE</span></div> : null}
        </div>
      </section>
    </div>
  );
}
