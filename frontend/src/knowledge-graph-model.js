const MAX_GRAPH_COUNT = 100_000;

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
    };
  }

  return {
    ...state,
    status: "connected",
    title: "LOCAL INDEX ACTIVE",
    detail: `${state.sourceCount} SOURCE${state.sourceCount === 1 ? "" : "S"} / ${state.relationCount} RELATIONS`,
    meta: "VERIFIED LOCAL GRAPH",
    announcement: `Local knowledge graph connected to ${state.sourceCount} verified source${state.sourceCount === 1 ? "" : "s"}.`,
  };
}
