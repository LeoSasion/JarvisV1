import {
  getVisualThemeSnapshot,
  visualThemes,
} from "./theme-system.js";

const STORAGE_KEY = "jarvis.interface-preferences.v1";
const MOTION_VALUES = new Set(["system", "reduced", "full"]);
const EMISSION_VALUES = new Set(["standard", "subtle", "minimal"]);
const listeners = new Set();
let initialized = false;

export const DEFAULT_INTERFACE_PREFERENCES = Object.freeze({
  version: 1,
  motion: "system",
  emission: "standard",
});

export function normalizeInterfacePreferences(value) {
  return Object.freeze({
    version: 1,
    motion: MOTION_VALUES.has(value?.motion)
      ? value.motion
      : DEFAULT_INTERFACE_PREFERENCES.motion,
    emission: EMISSION_VALUES.has(value?.emission)
      ? value.emission
      : DEFAULT_INTERFACE_PREFERENCES.emission,
  });
}

function readPreferences() {
  if (typeof window === "undefined") return DEFAULT_INTERFACE_PREFERENCES;
  try {
    return normalizeInterfacePreferences(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"),
    );
  } catch {
    return DEFAULT_INTERFACE_PREFERENCES;
  }
}

let preferences = readPreferences();

function scaleRgba(value, factor) {
  const match = String(value ?? "").match(
    /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/iu,
  );
  if (!match) return value;
  const alpha = Math.min(1, Math.max(0, Number(match[4]) * factor));
  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha.toFixed(3)})`;
}

export function getEmissionVariables(themeVariables, emission) {
  if (emission === "standard") {
    return {
      "--glow-halo": themeVariables?.["--glow-halo"],
      "--glow-bloom": themeVariables?.["--glow-bloom"],
    };
  }
  const factors = emission === "minimal"
    ? { halo: 0.24, bloom: 0.08 }
    : { halo: 0.58, bloom: 0.42 };
  return {
    "--glow-halo": scaleRgba(themeVariables?.["--glow-halo"], factors.halo),
    "--glow-bloom": scaleRgba(themeVariables?.["--glow-bloom"], factors.bloom),
  };
}

function applyPreferences() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.motion = preferences.motion;
  root.dataset.emission = preferences.emission;
  const theme = visualThemes.find((candidate) =>
    candidate.id === getVisualThemeSnapshot()) ?? visualThemes[0];
  const variables = getEmissionVariables(theme.variables, preferences.emission);
  Object.entries(variables).forEach(([name, value]) => {
    if (value) root.style.setProperty(name, value);
  });
}

function persistAndEmit() {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    }
  } catch {
    // Preferences remain active for the current session.
  }
  applyPreferences();
  listeners.forEach((listener) => listener());
}

export function initializeInterfacePreferences() {
  preferences = readPreferences();
  applyPreferences();
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("jarvis:theme-changed", applyPreferences);
}

export function getInterfacePreferencesSnapshot() {
  return preferences;
}

export function subscribeInterfacePreferences(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setInterfacePreferences(nextValue) {
  const next = normalizeInterfacePreferences({
    ...preferences,
    ...nextValue,
  });
  if (next.motion === preferences.motion &&
      next.emission === preferences.emission) return preferences;
  preferences = next;
  persistAndEmit();
  return preferences;
}

export function resetInterfacePreferences() {
  preferences = DEFAULT_INTERFACE_PREFERENCES;
  persistAndEmit();
  return preferences;
}
