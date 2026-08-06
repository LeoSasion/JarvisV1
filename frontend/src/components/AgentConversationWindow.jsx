import {
  AddRegular,
  ArrowRightRegular,
  DismissRegular,
  DocumentRegular,
  LinkRegular,
  MaximizeRegular,
  PulseRegular,
  ShieldRegular,
  SquareMultipleRegular,
  SubtractRegular,
} from "@fluentui/react-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { getLatestAgentRelationMessage } from "../agent-context-model.js";
import { getAgentTranscriptAnnouncement } from "../agent-session-model.js";

const STATUS_COPY = Object.freeze({
  unavailable: "RUNTIME OFFLINE",
  starting: "CONNECTING",
  ready: "RUNTIME VERIFIED",
  running: "PROCESSING",
  error: "CHANNEL DEGRADED",
});

const ERROR_COPY = Object.freeze({
  AUTH_REQUIRED: {
    status: "SIGN-IN REQUIRED",
    heading: "Provider authentication is required",
    guidance: "Complete Pi authentication outside the WebView, then send again. JARVIS never collects Provider secrets here.",
  },
  MODEL_REQUIRED: {
    status: "MODEL REQUIRED",
    heading: "A default Pi model is required",
    guidance: "Configure an available default model in Pi, then retry this channel.",
  },
  NETWORK_UNAVAILABLE: {
    status: "NETWORK DEGRADED",
    heading: "The Provider network is unavailable",
    guidance: "Check connectivity and send again. The secure runtime remains locally contained.",
  },
  RATE_LIMITED: {
    status: "RATE LIMITED",
    heading: "The Provider is rate limited",
    guidance: "Wait for the Provider window to recover, then send again.",
  },
  QUOTA_EXCEEDED: {
    status: "QUOTA REQUIRED",
    heading: "Provider quota is unavailable",
    guidance: "Review the Provider account quota, then retry this channel.",
  },
});

const LINKED_FLOW_COPY = Object.freeze({
  staged: { label: "CONTEXT STAGED", detail: "READY FOR DIRECTIVE" },
  submitting: { label: "HANDOFF QUEUED", detail: "WAITING FOR AGENT RUN" },
  running: { label: "PROCESSING REFERENCE", detail: "RESPONSE STREAM ACTIVE" },
  complete: { label: "RESPONSE READY", detail: "AVAILABLE FOR NEXT DIRECTIVE" },
  error: { label: "LINK FAILED", detail: "REFERENCE PRESERVED FOR RETRY" },
  aborted: { label: "RUN STOPPED", detail: "REFERENCE PRESERVED" },
});

function errorPresentation(error) {
  if (!error) return null;
  return ERROR_COPY[error.code] ?? {
    status: "CHANNEL DEGRADED",
    heading: error.retryable ? "The Agent channel can be retried" : "The Agent channel needs attention",
    guidance: error.retryable
      ? "The next send will establish a fresh contained Pi process if recovery is required."
      : "Review the status detail before continuing.",
  };
}

function formatMessageTime(value) {
  const date = new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) return "NOW";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function messageLabel(role) {
  if (role === "user") return "YOU";
  if (role === "assistant") return "PI AGENT";
  return "SYSTEM";
}

function messageDisplayText(message) {
  const text = String(message?.text ?? "");
  if (message?.role !== "user" || !text.startsWith("[JARVIS FILE CONTEXT — METADATA ONLY]")) {
    return text;
  }
  const marker = "[USER DIRECTIVE]";
  const markerIndex = text.indexOf(marker);
  return markerIndex < 0 ? text : text.slice(markerIndex + marker.length).trim();
}

function LinkedContextEvent({
  context,
  phase,
  selectionItems,
  onLinkSelection,
  onClear,
}) {
  const items = context?.items ?? [];
  if (items.length === 0) {
    if (!selectionItems?.length) return null;
    return (
      <section className="agent-link-cue" aria-label="Explorer selection available for Pi Agent">
        <span className="agent-flow-node" aria-hidden="true"><LinkRegular /></span>
        <span>
          <small>EXPLORER SELECTION AVAILABLE</small>
          <strong>{selectionItems.length === 1 ? selectionItems[0].name : `${selectionItems.length} ITEMS SELECTED`}</strong>
          <p>Link the visible selection as metadata-only context. File contents stay outside this chat channel.</p>
        </span>
        <button type="button" onClick={() => onLinkSelection?.(selectionItems)}>LINK TO DIRECTIVE</button>
      </section>
    );
  }

  const copy = LINKED_FLOW_COPY[phase] ?? LINKED_FLOW_COPY.staged;
  return (
    <section
      className={`agent-linked-context is-${phase}`}
      aria-label={`Linked Explorer context: ${copy.label}`}
    >
      <span className="agent-flow-node" aria-hidden="true"><DocumentRegular /></span>
      <span className="agent-linked-context__identity">
        <small>EXPLORER REFERENCE · METADATA ONLY</small>
        <strong>{items.length === 1 ? items[0].name : `${items.length} LINKED ITEMS`}</strong>
        <code>{items.length === 1 ? items[0].path : `${items.length} immutable selection snapshots`}</code>
      </span>
      <span className="agent-linked-context__state" role="status">
        <strong>{copy.label}</strong>
        <small>{copy.detail}</small>
      </span>
      <button type="button" onClick={onClear} disabled={["submitting", "running"].includes(phase)}>CLEAR LINK</button>
    </section>
  );
}

export function AgentConversationWindow({
  open,
  active,
  maximized,
  canMaximize = true,
  state,
  messages,
  historyError,
  sessionTransitioning,
  draft,
  linkedContext = null,
  linkedFlowPhase = "empty",
  explorerSelection = [],
  onDraftChange,
  onSend,
  onAbort,
  onNewSession,
  onLinkExplorerSelection,
  onClearLinkedContext,
  onReuseLinkedResult,
  onClose,
  onMinimize,
  onToggleMaximize,
}) {
  const transcriptRef = useRef(null);
  const composerRef = useRef(null);
  const messageStatusesRef = useRef(new Map());
  const [transcriptAnnouncement, setTranscriptAnnouncement] = useState(null);
  const status = state?.status ?? "unavailable";
  const errorView = errorPresentation(state?.error);
  const visualStatus = errorView ? "error" : status;
  const statusCopy = sessionTransitioning
    ? "SWITCHING SESSION"
    : errorView?.status
    ?? (status === "ready" && state?.connected ? "CHANNEL CONNECTED" : STATUS_COPY[status])
    ?? "STANDBY";
  const isRunning = status === "running" || status === "starting";
  const channelReady = Boolean(state?.available) && status === "ready" && !sessionTransitioning;
  const canSend = channelReady
    && draft.trim().length > 0;
  const connectionCopy = useMemo(() => {
    if (!state?.available) return "PI RUNTIME UNAVAILABLE";
    if (errorView) return errorView.status;
    if (!state?.connected) return "RUNTIME VERIFIED · PROVIDER CHECKS ON FIRST SEND";
    const provider = state.provider || "PI";
    const model = state.model || "MODEL CHECK PENDING";
    return `${provider} · ${model}`.toUpperCase();
  }, [errorView, state?.available, state?.connected, state?.model, state?.provider]);

  const emptyCopy = useMemo(() => {
    if (!state?.available) {
      return {
        eyebrow: "RUNTIME BOUNDARY",
        heading: "Pi runtime is unavailable",
        detail: state?.error?.message ?? "Install or repair the verified bundled runtime before using Agent chat.",
      };
    }
    if (errorView) {
      return {
        eyebrow: errorView.status,
        heading: errorView.heading,
        detail: errorView.guidance,
      };
    }
    if (!state?.connected) {
      return {
        eyebrow: "SECURE RUNTIME VERIFIED",
        heading: "Provider checks on first send",
        detail: "Pi starts only when needed. Model and Provider availability are verified without exposing credentials to this desktop surface.",
      };
    }
    return {
      eyebrow: "PRIVATE SESSION CONNECTED",
      heading: "What should we work on?",
      detail: "Messages stream through the Windows host. System tools remain disabled in this integration.",
    };
  }, [errorView, state?.available, state?.connected, state?.error?.message]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    transcript.scrollTop = transcript.scrollHeight;
  }, [messages]);

  const linkedContextKey = linkedContext?.relationId
    ?? (linkedContext?.items ?? []).map((item) => item.id).join("|");
  const linkedRelationMessage = useMemo(
    () => getLatestAgentRelationMessage(messages, linkedContext),
    [linkedContext, messages],
  );
  const linkedRelationMessageId = linkedRelationMessage?.id ?? null;
  const linkedDirectiveArmed = Boolean(linkedContext?.items?.length)
    && linkedFlowPhase === "staged";
  useEffect(() => {
    if (!linkedContextKey) return;
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }, [linkedContextKey]);

  useEffect(() => {
    const { nextStatuses, announcement } = getAgentTranscriptAnnouncement(
      messageStatusesRef.current,
      messages,
    );
    messageStatusesRef.current = nextStatuses;
    if (announcement) setTranscriptAnnouncement(announcement);
  }, [messages]);

  if (!open) return null;

  const submit = (event) => {
    event.preventDefault();
    if (canSend) void onSend().catch(() => {});
  };

  return (
    <div className="agent-layer">
      <section
        className="agent-workbench"
        role="dialog"
        aria-modal="false"
        aria-label="JARVIS Pi Agent"
        aria-busy={isRunning || sessionTransitioning}
      >
        <header
          className="agent-titlebar"
          data-window-drag-handle
          aria-keyshortcuts={canMaximize ? "Alt+F4 Alt+F9 Alt+F10" : "Alt+F4 Alt+F9"}
        >
          <span className={`agent-titlebar__mark is-${visualStatus}`}><PulseRegular /></span>
          <span className="agent-titlebar__identity">
            <small>EMBEDDED OPERATIONS CHANNEL</small>
            <strong>JARVIS · PI AGENT</strong>
          </span>
          <span className={`agent-runtime-state is-${visualStatus}`} role="status">
            <i />{statusCopy}
          </span>
          <button
            type="button"
            data-no-window-drag
            onClick={() => { void onNewSession().catch(() => {}); }}
            disabled={isRunning || sessionTransitioning || !state?.available}
            aria-label="Start new Agent session"
            title="New session"
          >
            <AddRegular />
          </button>
          <button type="button" data-no-window-drag onClick={onMinimize} aria-label="Minimize Agent">
            <SubtractRegular />
          </button>
          <button
            type="button"
            data-no-window-drag
            onClick={onToggleMaximize}
            disabled={!canMaximize}
            aria-label={canMaximize
              ? maximized ? "Restore Agent" : "Maximize Agent"
              : "Agent layout is controlled by the linked workspace"}
            title={canMaximize ? maximized ? "Restore" : "Maximize" : "Linked layout"}
          >
            {maximized ? <SquareMultipleRegular /> : <MaximizeRegular />}
          </button>
          <button type="button" data-no-window-drag onClick={onClose} aria-label="Close Agent">
            <DismissRegular />
          </button>
        </header>

        <div className="agent-context-strip">
          <span><ShieldRegular />CHAT ONLY · TOOLS DISABLED</span>
          <code>{connectionCopy}</code>
          <small>{state?.sessionId ? `SESSION ${String(state.sessionId).slice(0, 8)}` : "EPHEMERAL SESSION"}</small>
        </div>

        <div
          ref={transcriptRef}
          className="agent-transcript"
          data-linked-scroll-viewport="agent"
          aria-label="Agent transcript"
        >
          <LinkedContextEvent
            context={linkedContext}
            phase={linkedFlowPhase}
            selectionItems={explorerSelection}
            onLinkSelection={onLinkExplorerSelection}
            onClear={onClearLinkedContext}
          />
          {messages.length ? messages.map((message, index) => {
            const linkedRelation = message.id === linkedRelationMessageId;
            const reusableResult = linkedRelation
              && message.role === "assistant"
              && linkedFlowPhase === "complete";
            return (
              <article
                key={message.id ?? `${message.role}-${index}`}
                className={`agent-message is-${message.role ?? "system"}${message.status === "streaming" ? " is-streaming" : ""}${linkedRelation ? " is-linked-relation" : ""}`}
              >
                {linkedRelation ? (
                  <span
                    className="agent-message-link-port"
                    data-agent-relation-target={linkedContext?.relationId}
                    aria-hidden="true"
                  />
                ) : null}
                <header>
                  <span>{messageLabel(message.role)}</span>
                  <time>{formatMessageTime(message.createdAt ?? message.timestamp)}</time>
                  <code>{linkedRelation ? "FILE LINK" : message.status === "streaming" ? "LIVE" : message.status === "error" ? "ERROR" : "LOGGED"}</code>
                </header>
                <p>{messageDisplayText(message)}</p>
                {reusableResult ? (
                  <button
                    type="button"
                    className="agent-message-reuse"
                    onClick={onReuseLinkedResult}
                  >
                    USE IN DIRECTIVE
                  </button>
                ) : null}
              </article>
            );
          }) : !linkedContext?.items?.length && !explorerSelection?.length ? (
            <div className={`agent-empty-state${channelReady && !errorView ? " is-ready" : ""}`}>
              <PulseRegular />
              <span>
                <small>{emptyCopy.eyebrow}</small>
                <strong>{emptyCopy.heading}</strong>
                <p>{emptyCopy.detail}</p>
              </span>
            </div>
          ) : null}
        </div>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {transcriptAnnouncement ? (
            <span key={transcriptAnnouncement.id}>{transcriptAnnouncement.text}</span>
          ) : null}
        </div>

        <div
          className={`agent-alert-region${state?.error || historyError ? " has-alert" : ""}`}
          role={state?.error || historyError ? "alert" : undefined}
        >
          {state?.error ? (
            <>
              <strong>{state.error.code}</strong>
              <span>{state.error.message}</span>
              <small>{errorView?.guidance}</small>
            </>
          ) : historyError ? (
            <>
              <strong>HISTORY UNAVAILABLE</strong>
              <span>{historyError}</span>
              <small>The live Agent channel can still be used.</small>
            </>
          ) : null}
        </div>

        <form className="agent-composer" onSubmit={submit}>
          <label htmlFor="jarvis-agent-prompt">
            <span>{linkedDirectiveArmed ? "DIRECTIVE // LINKED REFERENCE" : "DIRECTIVE"}</span>
            <small>{draft.length} / 16000</small>
          </label>
          <textarea
            ref={composerRef}
            id="jarvis-agent-prompt"
            value={draft}
            maxLength={16000}
            rows={3}
            disabled={!channelReady}
            placeholder={isRunning
              ? "Agent response in progress…"
              : channelReady
                ? errorView?.guidance ?? "Ask Pi Agent…"
                : state?.available
                  ? "Wait for the Agent channel to become ready"
                  : "Repair the verified Pi runtime to enable Agent chat"}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              if (canSend) void onSend().catch(() => {});
            }}
          />
          {isRunning ? (
            <button
              type="button"
              className="is-stop"
              onClick={() => { void onAbort().catch(() => {}); }}
              aria-label="Stop Agent response"
            >
              <DismissRegular /><span>STOP</span>
            </button>
          ) : (
            <button type="submit" className="is-send" disabled={!canSend} aria-label="Send to Pi Agent">
              <ArrowRightRegular /><span>SEND</span>
            </button>
          )}
        </form>

        <footer className="agent-footer">
          <span><i className={`is-${visualStatus}`} />{active ? "FOCUSED CHANNEL" : "BACKGROUND CHANNEL"}</span>
          <small>ENTER TO SEND · SHIFT+ENTER FOR NEW LINE</small>
          <code>NO SHELL · NO FILE WRITE · NO SYSTEM CONTROL</code>
        </footer>
      </section>
    </div>
  );
}
