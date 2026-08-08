import { CheckmarkRegular, DismissRegular, WarningRegular } from "@fluentui/react-icons";
import { useEffect, useMemo, useState } from "react";
import { platform } from "../platform/index.js";
import { CoreNodeGlyph, JarvisMark } from "./VectorMarks.jsx";

const minimumVisibleMs = 1150;
let sharedChecks = null;

const checkDefinitions = Object.freeze([
  Object.freeze({
    id: "runtime",
    index: "01",
    label: "NATIVE RUNTIME",
    detail: "WebView2 · recovery · current user",
    run: () => platform.lifecycle.getRuntimeInfo(),
    validate: (result) => Boolean(result?.recoveryReady),
  }),
  Object.freeze({
    id: "telemetry",
    index: "02",
    label: "SYSTEM TELEMETRY",
    detail: "CPU · memory · network · power",
    run: () => platform.system.getSnapshot(),
    validate: (result) => Boolean(result?.cpu ?? result?.Cpu),
  }),
  Object.freeze({
    id: "windows",
    index: "03",
    label: "WINDOW CHANNEL",
    detail: "Taskbar · foreground · recovery polling",
    run: () => platform.taskbar.getSnapshot(),
    validate: (result) => Array.isArray(result?.windows ?? result?.Windows),
  }),
  Object.freeze({
    id: "terminal",
    index: "04",
    label: "CONPTY TERMINAL",
    detail: "PowerShell · CMD · WSL profiles",
    run: () => platform.terminal.listProfiles(),
    validate: (result) => !platform.isNative || Boolean(result?.conPtyAvailable),
  }),
]);

function getSharedChecks() {
  if (!sharedChecks) {
    sharedChecks = checkDefinitions.map((definition) => ({
      ...definition,
      promise: Promise.resolve().then(definition.run),
    }));
  }
  return sharedChecks;
}

export function BootSequence({ onComplete }) {
  const [states, setStates] = useState(() => Object.fromEntries(
    checkDefinitions.map((definition) => [definition.id, "pending"]),
  ));
  const [canSkip, setCanSkip] = useState(false);
  const checks = useMemo(getSharedChecks, []);

  useEffect(() => {
    let active = true;
    const startedAt = performance.now();
    const skipTimer = window.setTimeout(() => setCanSkip(true), 420);

    checks.forEach((check) => {
      check.promise.then((result) => {
        if (!active) return;
        setStates((current) => ({
          ...current,
          [check.id]: check.validate(result) ? "ready" : "degraded",
        }));
      }).catch(() => {
        if (!active) return;
        setStates((current) => ({ ...current, [check.id]: "degraded" }));
      });
    });

    Promise.allSettled(checks.map((check) => check.promise)).then(() => {
      const remaining = Math.max(0, minimumVisibleMs - (performance.now() - startedAt));
      return new Promise((resolve) => window.setTimeout(resolve, remaining));
    }).then(() => {
      if (active) onComplete();
    });

    return () => {
      active = false;
      window.clearTimeout(skipTimer);
    };
  }, [checks, onComplete]);

  const completed = Object.values(states).filter((state) => state !== "pending").length;
  const degraded = Object.values(states).filter((state) => state === "degraded").length;

  return (
    <section className="boot-sequence" role="status" aria-live="polite" aria-label="JARVIS startup checks">
      <div className="boot-scan-field" aria-hidden="true"><i /><i /><i /></div>
      <div className="boot-core">
        <CoreNodeGlyph active={completed < checkDefinitions.length} />
        <span className="boot-core-ring" aria-hidden="true" />
      </div>
      <header>
        <JarvisMark />
        <span><small>POST-LOGIN SYSTEM INITIALIZATION</small><strong>JARVIS LOCAL VISUAL FRAME</strong></span>
        <code>{String(completed).padStart(2, "0")} / {String(checkDefinitions.length).padStart(2, "0")}</code>
      </header>

      <div className="boot-check-list">
        {checks.map((check) => {
          const state = states[check.id];
          return (
            <div key={check.id} className={`is-${state}`}>
              <code>{check.index}</code>
              <span><strong>{check.label}</strong><small>{check.detail}</small></span>
              <i aria-hidden="true" />
              <b>{state === "ready" ? <CheckmarkRegular /> : state === "degraded" ? <WarningRegular /> : null}</b>
              <em>{state.toUpperCase()}</em>
            </div>
          );
        })}
      </div>

      <footer>
        <span>
          <i style={{ "--boot-progress": completed / checkDefinitions.length }} />
        </span>
        <strong>{completed < checkDefinitions.length ? "ESTABLISHING LOCAL CHANNELS" : degraded ? `${degraded} CHANNELS DEGRADED · SAFE FALLBACK ACTIVE` : "ALL LOCAL CHANNELS READY"}</strong>
        <button type="button" onClick={onComplete} disabled={!canSkip}><DismissRegular />SKIP</button>
      </footer>
    </section>
  );
}
