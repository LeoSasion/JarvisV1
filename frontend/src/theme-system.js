const STORAGE_KEY = "jarvis.visual-theme.v1";

export const visualThemes = Object.freeze([
  Object.freeze({
    id: "nexus",
    label: "NEXUS BLUE",
    description: "Layered ice-cyan and cobalt emission",
    variables: Object.freeze({
      "--bg-0": "#00030a",
      "--bg-1": "#020a14",
      "--surface": "rgba(2, 10, 18, 0.94)",
      "--surface-raised": "rgba(4, 15, 26, 0.96)",
      "--line-dim": "#0a304c",
      "--line-mid": "#086da8",
      "--energy-blue": "#0084ee",
      "--energy-cyan": "#22cfff",
      "--energy-ice": "#bfeff5",
      "--glow-core": "#e3fbff",
      "--glow-edge": "#58d9ff",
      "--glow-halo": "rgba(28, 157, 255, 0.34)",
      "--glow-bloom": "rgba(0, 92, 238, 0.16)",
      "--terminal-bg": "#01060d",
      "--terminal-fg": "#dceef6",
    }),
  }),
  Object.freeze({
    id: "stealth",
    label: "STEALTH VECTOR",
    description: "Lower emission for long night sessions",
    variables: Object.freeze({
      "--bg-0": "#010408",
      "--bg-1": "#040a10",
      "--surface": "rgba(4, 10, 15, 0.96)",
      "--surface-raised": "rgba(6, 14, 20, 0.97)",
      "--line-dim": "#143143",
      "--line-mid": "#205c7d",
      "--energy-blue": "#267eb1",
      "--energy-cyan": "#62b9d4",
      "--energy-ice": "#c2e1e8",
      "--glow-core": "#d9f3f7",
      "--glow-edge": "#76c6d9",
      "--glow-halo": "rgba(68, 157, 184, 0.22)",
      "--glow-bloom": "rgba(26, 93, 122, 0.10)",
      "--terminal-bg": "#020609",
      "--terminal-fg": "#cfdee2",
    }),
  }),
  Object.freeze({
    id: "clarity",
    label: "HIGH CLARITY",
    description: "Sharper boundaries and brighter text contrast",
    variables: Object.freeze({
      "--bg-0": "#000208",
      "--bg-1": "#010914",
      "--surface": "rgba(1, 8, 17, 0.98)",
      "--surface-raised": "rgba(3, 15, 27, 0.99)",
      "--line-dim": "#0b4167",
      "--line-mid": "#0c8ad0",
      "--energy-blue": "#1498ff",
      "--energy-cyan": "#52ddff",
      "--energy-ice": "#e2fbff",
      "--glow-core": "#ffffff",
      "--glow-edge": "#83e8ff",
      "--glow-halo": "rgba(44, 184, 255, 0.42)",
      "--glow-bloom": "rgba(0, 115, 255, 0.22)",
      "--terminal-bg": "#00040b",
      "--terminal-fg": "#effbff",
    }),
  }),
]);

const themeById = new Map(visualThemes.map((theme) => [theme.id, theme]));
const listeners = new Set();
let activeThemeId = "nexus";

function readStoredThemeId() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return themeById.has(value) ? value : "nexus";
  } catch {
    return "nexus";
  }
}

function applyVariables(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  Object.entries(theme.variables).forEach(([name, value]) => root.style.setProperty(name, value));
}

export function initializeVisualTheme() {
  activeThemeId = readStoredThemeId();
  applyVariables(themeById.get(activeThemeId));
}

export function getVisualThemeSnapshot() {
  return activeThemeId;
}

export function subscribeVisualTheme(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setVisualTheme(themeId) {
  const theme = themeById.get(themeId);
  if (!theme || theme.id === activeThemeId) return activeThemeId;
  activeThemeId = theme.id;
  applyVariables(theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme.id);
  } catch {
    // The active session still receives the selected theme.
  }
  listeners.forEach((listener) => listener());
  window.dispatchEvent(new CustomEvent("jarvis:theme-changed", { detail: { themeId } }));
  return activeThemeId;
}
