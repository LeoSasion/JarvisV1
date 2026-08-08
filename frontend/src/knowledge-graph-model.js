const MAX_GRAPH_COUNT = 100_000;

export const DISCONNECTED_GRAPH_ACTIONS = Object.freeze([
  Object.freeze({ id: "search-local", label: "SEARCH LOCAL", detail: "Find apps, files, and active windows" }),
  Object.freeze({ id: "open-files", label: "OPEN FILES", detail: "Choose a verified local source" }),
  Object.freeze({ id: "desktop-only", label: "DESKTOP ONLY", detail: "Keep the graph quiet for this session" }),
]);

function normalizeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(MAX_GRAPH_COUNT, Math.round(parsed));
}

export function normalizeKnowledgeGraphState(rawState = {}) {
  const candidate = rawState ?? {};
  const sourceCount = normalizeCount(candidate.sourceCount);
  const relationCount = normalizeCount(candidate.relationCount);
  const connected = candidate.connected === true && sourceCount > 0;

  return {
    connected,
    sourceCount: connected ? sourceCount : 0,
    relationCount: connected ? relationCount : 0,
  };
}

export function getKnowledgeGraphPresentation(rawState) {
  const state = normalizeKnowledgeGraphState(rawState);
  if (!state.connected) {
    return {
      ...state,
      status: "disconnected",
      title: "SOURCE DISCONNECTED",
      detail: "Connect a verified local source to activate relations.",
      meta: "ENTITY / RELATION / SOURCE",
      announcement: "Local knowledge graph structure preview. No verified knowledge source is connected.",
      actions: DISCONNECTED_GRAPH_ACTIONS,
    };
  }

  return {
    ...state,
    status: "connected",
    title: "LOCAL INDEX ACTIVE",
    detail: `${state.sourceCount} SOURCE${state.sourceCount === 1 ? "" : "S"} / ${state.relationCount} RELATIONS`,
    meta: "VERIFIED LOCAL GRAPH",
    announcement: `Local knowledge graph connected to ${state.sourceCount} verified source${state.sourceCount === 1 ? "" : "s"}.`,
    actions: [],
  };
}
