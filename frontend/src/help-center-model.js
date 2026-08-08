const HELP_SECTIONS = [
  {
    id: "start",
    label: "START",
    title: "FIND AND LAUNCH",
    summary: "Use local shell search without sending desktop data to a cloud service.",
    entries: [
      { command: "CTRL SPACE", detail: "Open local Quick Search from anywhere in JARVIS." },
      { command: "START", detail: "Browse pinned, recent, installed, and running applications." },
      { command: "DESKTOP", detail: "Open files or applications directly from the desktop ledger." },
    ],
  },
  {
    id: "files",
    label: "FILES",
    title: "WORK WITH FILES",
    summary: "The JARVIS Explorer remains an application-layer surface over normal Windows file operations.",
    entries: [
      { command: "ENTER / F2 / F5", detail: "Open, rename, or refresh the current Explorer location." },
      { command: "CTRL C / X / V", detail: "Copy, cut, and paste selected items." },
      { command: "CTRL SHIFT N", detail: "Create a folder. Shift+F10 opens the command menu." },
      { command: "ALT ENTER / DELETE", detail: "Inspect properties or send selected items through the normal delete flow." },
    ],
  },
  {
    id: "linked",
    label: "LINKED",
    title: "EXPLORER + AGENT",
    summary: "Only selected file metadata is staged for an Agent until you explicitly send a directive.",
    entries: [
      { command: "ALT F8", detail: "Switch the visible Explorer or Agent pane without breaking the link." },
      { command: "CTRL ALT ← / →", detail: "Cycle through open JARVIS workspace windows." },
      { command: "METADATA ONLY", detail: "A linked reference contains path and file metadata; file contents are not uploaded automatically." },
    ],
  },
  {
    id: "windows",
    label: "WINDOWS",
    title: "WINDOW CONTROL",
    summary: "JARVIS stays outside explorer.exe and preserves a safe return to the native Windows shell.",
    entries: [
      { command: "ALT F4", detail: "Close the active JARVIS workspace window." },
      { command: "ALT F9 / F10", detail: "Minimize or maximize the active JARVIS workspace window." },
      { command: "CTRL SHIFT Q", detail: "Always exit JARVIS and restore the native Windows taskbar." },
    ],
  },
  {
    id: "recovery",
    label: "RECOVERY",
    title: "SAFE RECOVERY",
    summary: "Explorer stays running. JARVIS restores the native taskbar on normal exit or guarded failure.",
    entries: [
      { command: "SESSION CONTROL", detail: "Exit JARVIS, lock, sign out, restart, or shut down through confirmed Windows actions." },
      { command: "RECOVERY CHECK", detail: "Verify runtime, package, startup, and native-shell recovery readiness." },
    ],
  },
];

export const helpCenterSections = Object.freeze(HELP_SECTIONS.map((section) => Object.freeze({
  ...section,
  entries: Object.freeze(section.entries.map((entry) => Object.freeze(entry))),
})));

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

export function filterHelpSections(query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return helpCenterSections;
  return helpCenterSections
    .map((section) => {
      const sectionMatch = normalize(`${section.label} ${section.title} ${section.summary}`).includes(normalizedQuery);
      const entries = sectionMatch
        ? section.entries
        : section.entries.filter((entry) => normalize(`${entry.command} ${entry.detail}`).includes(normalizedQuery));
      return entries.length > 0 ? { ...section, entries } : null;
    })
    .filter(Boolean);
}
