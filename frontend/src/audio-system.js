const STORAGE_KEY = "jarvis.ui-audio.v1";
const listeners = new Set();
const recentEvents = new Map();
let context = null;
let state = readState();
let installed = false;

const toneMap = Object.freeze({
  activate: Object.freeze({ frequency: 720, endFrequency: 1080, duration: 0.055, gain: 0.8 }),
  navigate: Object.freeze({ frequency: 520, endFrequency: 660, duration: 0.035, gain: 0.55 }),
  confirm: Object.freeze({ frequency: 820, endFrequency: 1320, duration: 0.075, gain: 0.85 }),
  dismiss: Object.freeze({ frequency: 460, endFrequency: 260, duration: 0.06, gain: 0.55 }),
  alert: Object.freeze({ frequency: 260, endFrequency: 190, duration: 0.14, gain: 0.75 }),
});

function readState() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (parsed?.version === 1) {
      const storedVolume = Number(parsed.volume);
      return Object.freeze({
        enabled: Boolean(parsed.enabled),
        volume: Number.isFinite(storedVolume)
          ? Math.min(1, Math.max(0, storedVolume))
          : 0.14,
      });
    }
  } catch {
    // Use the quiet default if storage is unavailable or corrupt.
  }
  return Object.freeze({ enabled: false, volume: 0.14 });
}

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...state }));
  } catch {
    // Audio remains configurable for the current session.
  }
  listeners.forEach((listener) => listener());
}

function ensureContext() {
  if (!context) {
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContext) return null;
    context = new AudioContext({ latencyHint: "interactive" });
  }
  if (context.state === "suspended") void context.resume();
  return context;
}

export function getUiAudioSnapshot() {
  return state;
}

export function subscribeUiAudio(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setUiAudioEnabled(enabled) {
  state = Object.freeze({ ...state, enabled: Boolean(enabled) });
  persist();
  if (state.enabled) playUiSound("confirm", { force: true });
}

export function setUiAudioVolume(volume) {
  state = Object.freeze({ ...state, volume: Math.min(1, Math.max(0, Number(volume) || 0)) });
  persist();
}

export function playUiSound(name, options = {}) {
  if (!state.enabled && !options.force) return;
  const tone = toneMap[name] ?? toneMap.navigate;
  const now = performance.now();
  if (now - (recentEvents.get(name) ?? 0) < 36) return;
  recentEvents.set(name, now);

  const audio = ensureContext();
  if (!audio) return;
  const start = audio.currentTime;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(tone.frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, start + tone.duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(
    Math.max(0.0001, state.volume * tone.gain),
    start + 0.008,
  );
  gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + tone.duration + 0.01);
}

export function installUiAudioBridge() {
  if (installed) return;
  installed = true;
  document.addEventListener("click", (event) => {
    if (!state.enabled) return;
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    const label = `${button.className ?? ""} ${button.getAttribute("aria-label") ?? ""}`.toLowerCase();
    if (label.includes("close") || label.includes("dismiss") || label.includes("exit")) {
      playUiSound("dismiss");
    } else if (label.includes("power") || label.includes("delete") || label.includes("recycle")) {
      playUiSound("alert");
    } else if (label.includes("launch") || label.includes("open") || label.includes("new")) {
      playUiSound("activate");
    } else {
      playUiSound("navigate");
    }
  });
}
