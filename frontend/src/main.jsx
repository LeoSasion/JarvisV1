import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { installUiAudioBridge } from "./audio-system.js";
import { initializeVisualTheme } from "./theme-system.js";

initializeVisualTheme();
installUiAudioBridge();

const surface = new URLSearchParams(window.location.search).get("surface") ?? "desktop";
document.documentElement.dataset.surface = surface;

const loadSurface = surface === "taskbar"
  ? import("./TaskbarSurface.jsx").then((module) => module.TaskbarSurface)
  : surface === "switcher"
    ? import("./WindowSwitcherSurface.jsx").then((module) => module.WindowSwitcherSurface)
    : import("./App.jsx").then((module) => module.App);

loadSurface.then((Surface) => {
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <Surface />
    </React.StrictMode>,
  );
}).catch((error) => {
  document.getElementById("root").textContent = `JARVIS surface failed to load: ${error.message}`;
});
