import {
  normalizeAgentEvent,
  normalizeAgentState,
} from "./agent-session-model.js";

const STATE_EVENT_KINDS = new Set(["run-start", "run-end", "session-reset"]);
const TRANSCRIPT_EVENT_KINDS = new Set([
  "message",
  "text-delta",
  "message-complete",
  "session-reset",
  "tool",
]);

function hasSessionId(rawState) {
  return Object.hasOwn(rawState ?? {}, "sessionId") ||
    Object.hasOwn(rawState ?? {}, "SessionId");
}

/**
 * Serializes asynchronous hydration and session replacement around the live
 * event stream. Reducer actions received during a session replacement are
 * buffered so the old transcript can be cleared before new-session events are
 * replayed atomically.
 */
export function createAgentSessionGate(dispatch) {
  let disposed = false;
  let generation = 0;
  let stateRevision = 0;
  let transcriptRevision = 0;
  let contextRevision = 0;
  let latestSessionObserved = false;
  let latestSessionId = null;
  let transition = null;

  function deliver(action) {
    if (disposed) return false;
    if (transition) {
      transition.actions.push(action);
    } else {
      dispatch(action);
    }
    return true;
  }

  return {
    captureHydration() {
      return {
        generation,
        stateRevision,
        transcriptRevision,
        contextRevision,
      };
    },

    hydrate(capture, state, messages, historyError = null) {
      if (
        disposed ||
        capture?.generation !== generation
      ) {
        return false;
      }

      const contextChanged = capture.contextRevision !== contextRevision;
      const stateChanged = contextChanged || capture.stateRevision !== stateRevision;
      const transcriptChanged = capture.transcriptRevision !== transcriptRevision;
      const snapshotSessionId = normalizeAgentState(state).sessionId;
      const sessionMismatch = latestSessionObserved &&
        latestSessionId !== snapshotSessionId;

      return deliver({
        type: "hydrate",
        state,
        messages,
        preserveState: stateChanged,
        messageMode: contextChanged || sessionMismatch
          ? "preserve"
          : transcriptChanged
            ? "merge"
            : "replace",
        historyError: sessionMismatch ? null : historyError,
      });
    },

    failHydration(capture, error) {
      if (
        disposed ||
        capture?.generation !== generation ||
        capture?.contextRevision !== contextRevision ||
        capture?.stateRevision !== stateRevision
      ) {
        return false;
      }
      return deliver({ type: "error", error });
    },

    stateChanged(state) {
      stateRevision += 1;
      if (hasSessionId(state)) {
        latestSessionObserved = true;
        latestSessionId = normalizeAgentState(state).sessionId;
      }
      return deliver({ type: "state-changed", state });
    },

    event(rawEvent) {
      const event = normalizeAgentEvent(rawEvent);
      if (!event) return false;
      if (STATE_EVENT_KINDS.has(event.kind)) stateRevision += 1;
      if (TRANSCRIPT_EVENT_KINDS.has(event.kind)) transcriptRevision += 1;
      if (event.kind === "session-reset") contextRevision += 1;
      return deliver({ type: "event", event });
    },

    beginSessionTransition() {
      if (disposed || transition) return null;
      generation += 1;
      transition = { token: generation, actions: [] };
      dispatch({ type: "session-transition-start" });
      return transition.token;
    },

    completeSessionTransition(token, state) {
      if (disposed || transition?.token !== token) return false;
      const actions = transition.actions;
      transition = null;
      dispatch({ type: "session-transition-complete", state, actions });
      return true;
    },

    failSessionTransition(token, error) {
      if (disposed || transition?.token !== token) return false;
      const actions = transition.actions;
      transition = null;
      dispatch({ type: "session-transition-failed", error, actions });
      return true;
    },

    isTransitioning() {
      return transition !== null;
    },

    dispose() {
      disposed = true;
      transition = null;
    },
  };
}
