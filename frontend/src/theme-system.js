const STORAGE_KEY = "jarvis.visual-theme.v1";

export const visualThemes = Object.freeze([
  Object.freeze({
    id: "nexus",
    label: "SIGNAL ORANGE",
    description: "True black space, warm white information, and sparse orange command signals",
    variables: Object.freeze({
      "--bg-0": "#000000",
      "--bg-1": "#070605",
      "--surface": "#080706",
      "--surface-raised": "#100e0c",
      "--line-dim": "#35312d",
      "--line-mid": "#77716a",
      "--energy-blue": "#b84000",
      "--energy-cyan": "#ff5a00",
      "--energy-ice": "#f5f1e9",
      "--glow-core": "#fffdf8",
      "--glow-edge": "#ff9850",
      "--glow-halo": "rgba(255, 90, 0, 0.34)",
      "--glow-bloom": "rgba(255, 90, 0, 0.12)",
      "--terminal-bg": "#020201",
      "--terminal-fg": "#f5f1e9",
    }),
  }),
  Object.freeze({
    id: "stealth",
    label: "EMBER LOW",
    description: "Reduced orange emission with the same black and warm-white hierarchy",
    variables: Object.freeze({
      "--bg-0": "#000000",
      "--bg-1": "#050403",
      "--surface": "#070605",
      "--surface-raised": "#0d0b09",
      "--line-dim": "#302c28",
      "--line-mid": "#67615b",
      "--energy-blue": "#8f3506",
      "--energy-cyan": "#d84d00",
      "--energy-ice": "#e9e4dc",
      "--glow-core": "#f9f6f0",
      "--glow-edge": "#e47a38",
      "--glow-halo": "rgba(216, 77, 0, 0.2)",
      "--glow-bloom": "rgba(216, 77, 0, 0.06)",
      "--terminal-bg": "#010101",
      "--terminal-fg": "#e9e4dc",
    }),
  }),
  Object.freeze({
    id: "clarity",
    label: "HIGH CONTRAST",
    description: "Maximum warm-white separation with a brighter orange focus signal",
    variables: Object.freeze({
      "--bg-0": "#000000",
      "--bg-1": "#090704",
      "--surface": "#0a0806",
      "--surface-raised": "#15110d",
      "--line-dim": "#45403a",
      "--line-mid": "#8e877e",
      "--energy-blue": "#c94700",
      "--energy-cyan": "#ff6800",
      "--energy-ice": "#fffdf8",
      "--glow-core": "#ffffff",
      "--glow-edge": "#ffad70",
      "--glow-halo": "rgba(255, 104, 0, 0.4)",
      "--glow-bloom": "rgba(255, 104, 0, 0.14)",
      "--terminal-bg": "#000000",
      "--terminal-fg": "#fffdf8",
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
