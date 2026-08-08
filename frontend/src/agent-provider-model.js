const PROVIDER_ALIASES = Object.freeze({
  "browser-preview": "PREVIEW",
  pi: "PI",
});

export function getAgentProviderLabel(state = {}) {
  if (state.available === false) return "NO PROVIDER";
  const provider = String(state.provider ?? "").trim().toLocaleLowerCase();
  if (!provider) return "PROVIDER PENDING";
  if (PROVIDER_ALIASES[provider]) return PROVIDER_ALIASES[provider];
  return provider
    .replace(/[^\p{L}\p{N}._-]+/gu, " ")
    .trim()
    .slice(0, 24)
    .toLocaleUpperCase() || "PROVIDER";
}

export function getAgentLauncherStatus(state = {}, windowState = {}) {
  if (state.available === false) return "OFFLINE";
  if (state.error) return "ATTENTION";
  if (state.status === "starting" || state.status === "running") return "PROCESSING";
  if (windowState.active) return "ACTIVE";
  if (windowState.open) return "READY";
  return "OPEN";
}

export function getCommandBusPresentation(state = {}) {
  const agentRunning = state.status === "running" || state.status === "starting";
  return {
    localCommandLabel: "LOCAL COMMANDS READY",
    agentProviderStatus: agentRunning
      ? "AGENT ACTIVE"
      : state.available
        ? "AGENT READY"
        : "AGENT OFFLINE",
  };
}
