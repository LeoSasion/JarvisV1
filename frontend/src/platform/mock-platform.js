import { processes, resources, shortcuts } from "../data.js";
import { normalizeWindowAppearanceProcessName } from "../window-appearance-model.js";

const DECIMAL_MB = 1_000_000;
const DECIMAL_GB = 1_000_000_000;
const BINARY_GB = 1024 ** 3;
const WINDOW_APPEARANCE_STORAGE_KEY = "jarvis.windowAppearance.mode.v1";
const WINDOW_APPEARANCE_RULES_STORAGE_KEY = "jarvis.windowAppearance.rules.v1";
const WINDOW_APPEARANCE_MODES = new Set(["off", "conservative", "enhanced", "immersive"]);
const WINDOW_APPEARANCE_RULE_ACTIONS = new Set(["allow", "deny"]);
const WINDOW_APPEARANCE_PROTECTED_PROCESSES = new Set([
  "dwm",
  "lockapp",
  "searchhost",
  "searchapp",
  "shellexperiencehost",
  "startmenuexperiencehost",
  "textinputhost",
]);
const TASKBAR_MODE_STORAGE_KEY = "jarvis.taskbar.mode.v1";
const TASKBAR_MODES = new Set(["native", "hybrid", "full"]);
const RENDERER_FAULT_SOURCES = new Set([
  "agent",
  "desktop",
  "explorer",
  "notifications",
  "runtime",
  "settings",
  "shell",
  "system",
  "taskbar",
  "terminal",
  "window-appearance",
]);
const RENDERER_FAULT_SEVERITIES = new Set(["warning", "error"]);
const RENDERER_FAULT_ACTION_IDS = new Set([
  "open-network-settings",
  "open-sound-settings",
  "open-power-settings",
  "open-runtime-settings",
]);
const RENDERER_FAULT_PARAMETER_NAMES = new Set([
  "source",
  "severity",
  "title",
  "detail",
  "actionId",
]);
const RENDERER_FAULT_TITLE_MAX_LENGTH = 160;
const RENDERER_FAULT_DETAIL_MAX_LENGTH = 320;
const RENDERER_FAULT_DUPLICATE_WINDOW_MS = 30_000;
const MOCK_STYLED_WINDOW_COUNTS = {
  off: 0,
  conservative: 4,
  enhanced: 4,
  immersive: 7,
};

function readMockWindowAppearanceMode() {
  try {
    const mode = globalThis.localStorage?.getItem(WINDOW_APPEARANCE_STORAGE_KEY);
    return WINDOW_APPEARANCE_MODES.has(mode) ? mode : "enhanced";
  } catch {
    return "enhanced";
  }
}

function persistMockWindowAppearanceMode(mode) {
  try {
    globalThis.localStorage?.setItem(WINDOW_APPEARANCE_STORAGE_KEY, mode);
  } catch {
    // Browser privacy settings can disable storage; the in-memory mock remains usable.
  }
}

function readMockWindowAppearanceRules() {
  try {
    const rules = JSON.parse(globalThis.localStorage?.getItem(WINDOW_APPEARANCE_RULES_STORAGE_KEY) ?? "[]");
    return Array.isArray(rules) ? rules.filter((rule) =>
      normalizeWindowAppearanceProcessName(rule?.processName) &&
      WINDOW_APPEARANCE_RULE_ACTIONS.has(rule?.action)).slice(0, 64) : [];
  } catch {
    return [];
  }
}

function persistMockWindowAppearanceRules(rules) {
  try {
    globalThis.localStorage?.setItem(WINDOW_APPEARANCE_RULES_STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // The in-memory rules remain usable when browser storage is disabled.
  }
}

function createMockWindowCompatibility(mode, rules) {
  const ruleByProcess = new Map(
    rules.map((rule) => [rule.processName.toLowerCase(), rule.action]),
  );
  return [
    { processName: "explorer", windowCount: 2, eligibleWindowCount: 2 },
    { processName: "Code", windowCount: 1, eligibleWindowCount: 1 },
    { processName: "msedge", windowCount: 1, eligibleWindowCount: 1 },
    { processName: "SearchHost", windowCount: 1, eligibleWindowCount: 0, protected: true },
  ].map((entry) => {
    const action = ruleByProcess.get(entry.processName.toLowerCase());
    const decision = entry.protected
      ? "protected"
      : action === "allow"
        ? "allowed"
        : action === "deny"
          ? "denied"
          : "automatic";
    const eligibleWindowCount = decision === "denied" || decision === "protected"
      ? 0
      : entry.eligibleWindowCount;
    return {
      processName: entry.processName,
      windowCount: entry.windowCount,
      eligibleWindowCount,
      styledWindowCount: mode === "off" || eligibleWindowCount === 0 ? 0 : eligibleWindowCount,
      decision,
      reasonCode: entry.protected
        ? "system-protected"
        : action
          ? `user-${action}`
          : "automatic",
    };
  });
}

function createMockWindowAppearanceState(mode, rules = []) {
  return {
    mode,
    effectiveMode: mode,
    osBuild: "26200.8875",
    windows11: true,
    styledWindowCount: MOCK_STYLED_WINDOW_COUNTS[mode],
    fallbackReason: null,
    hooksReady: mode !== "off",
    hostIntegrityVerified: true,
    safetyHotkeyRegistered: true,
    recoveryArmed: true,
    rules: rules.map((rule) => ({ ...rule })),
    compatibilityMatrix: createMockWindowCompatibility(mode, rules),
  };
}

function readMockTaskbarMode() {
  try {
    const mode = globalThis.localStorage?.getItem(TASKBAR_MODE_STORAGE_KEY);
    return TASKBAR_MODES.has(mode) ? mode : "hybrid";
  } catch {
    return "hybrid";
  }
}

function persistMockTaskbarMode(mode) {
  try {
    globalThis.localStorage?.setItem(TASKBAR_MODE_STORAGE_KEY, mode);
  } catch {
    // The in-memory mode remains available when browser storage is disabled.
  }
}

function createMockTaskbarModeState(mode, options = {}) {
  return {
    requestedMode: mode,
    effectiveMode: options.effectiveMode ?? mode,
    fallbackReason: options.fallbackReason ?? null,
    hybridAvailable: true,
    safeMode: false,
    transitionStatus: options.transitionStatus ?? "settled",
    transitionGeneration: options.transitionGeneration ?? 0,
    transitionReason: options.transitionReason ?? "mock state ready",
    retryAllowed: options.retryAllowed ?? false,
    recoveryFailureCount: options.recoveryFailureCount ?? 0,
    retryAfterUtc: options.retryAfterUtc ?? null,
  };
}

const mockTargets = {
  pc: "shell:MyComputerFolder",
  projects: "Projects",
  atlas: "D:\\",
  downloads: "shell:Downloads",
  terminal: "powershell.exe",
  recycle: "shell:RecycleBinFolder",
  documents: "shell:Personal",
  code: "code",
  notes: "notepad.exe",
  settings: "ms-settings:",
};

const mockDesktopPaths = {
  projects: "C:\\Users\\Pilot\\Desktop\\Projects",
  atlas: "C:\\Users\\Pilot\\Desktop\\Atlas Drive.lnk",
  downloads: "C:\\Users\\Pilot\\Desktop\\Downloads.lnk",
  terminal: "C:\\Users\\Pilot\\Desktop\\Terminal.lnk",
  documents: "C:\\Users\\Pilot\\Desktop\\Documents.lnk",
  code: "C:\\Users\\Pilot\\Desktop\\Code.lnk",
  notes: "C:\\Users\\Pilot\\Desktop\\Notes.txt",
  settings: "C:\\Users\\Pilot\\Desktop\\Settings.lnk",
};

export const mockDesktopEntries = shortcuts.map((shortcut) => ({
  ...shortcut,
  name: shortcut.label,
  target: mockTargets[shortcut.id] ?? shortcut.label,
  path: mockDesktopPaths[shortcut.id] ?? null,
  source: "mock",
  kind: shortcut.icon === "folder" ? "directory" : "shortcut",
}));

export const mockSystemSnapshot = {
  timestamp: "2026-07-20T22:47:00+08:00",
  os: {
    version: "10.0.26200.8875",
    description: "Microsoft Windows 11 Pro 25H2",
    machineName: "AVALON-PRIME",
    uptimeSeconds: 193_420,
  },
  cpu: {
    usagePercent: 18,
    frequencyGhz: 2.92,
    logicalProcessors: 16,
    history: resources.find((resource) => resource.id === "cpu")?.points,
  },
  memory: {
    usagePercent: 42,
    usedBytes: 13.3 * BINARY_GB,
    totalBytes: 31.3 * BINARY_GB,
    segments: 10,
  },
  disk: {
    label: "DISK (D:)",
    usagePercent: 12,
    usedBytes: 512 * DECIMAL_GB,
    totalBytes: 4_000 * DECIMAL_GB,
    history: resources.find((resource) => resource.id === "disk")?.points,
  },
  network: {
    isAvailable: true,
    interfaceName: "Wi-Fi",
    interfaceType: "Wireless80211",
    sentBytesPerSecond: (1.32 * DECIMAL_GB) / 8,
    receivedBytesPerSecond: (158 * DECIMAL_MB) / 8,
    history: resources.find((resource) => resource.id === "network")?.points,
  },
  power: {
    batteryPresent: true,
    percentage: 87,
    charging: false,
    acConnected: false,
  },
  processes: processes.map(([name, cpu, memory, network], index) => ({
    pid: index + 1,
    name,
    cpuPercent: Number.parseFloat(cpu),
    workingSetBytes: Number.parseFloat(memory) * DECIMAL_MB,
    networkBytesPerSecond: (Number.parseFloat(network) * DECIMAL_MB) / 8,
  })),
};

export const mockTaskbarSnapshot = {
  windows: [
    {
      windowId: "0x10001",
      title: "JARVIS development - Visual Studio Code",
      processName: "Code",
      pid: 4100,
      minimized: false,
      active: true,
      iconDataUrl: null,
    },
    {
      windowId: "0x10002",
      title: "JARVIS preview - Microsoft Edge",
      processName: "msedge",
      pid: 4200,
      minimized: false,
      active: false,
      applicationId: "mock-edge",
      iconDataUrl: null,
    },
    {
      windowId: "0x10004",
      title: "Windows taskbar APIs - Microsoft Edge",
      processName: "msedge",
      pid: 4200,
      minimized: false,
      active: false,
      applicationId: "mock-edge",
      iconDataUrl: null,
    },
    {
      windowId: "0x10003",
      title: "Notes",
      processName: "notepad",
      pid: 4300,
      minimized: true,
      active: false,
      iconDataUrl: null,
    },
    {
      windowId: "0x10005",
      title: "Design reference - Google Chrome",
      processName: "chrome",
      pid: 4400,
      minimized: false,
      active: false,
      iconDataUrl: null,
    },
    {
      windowId: "0x10006",
      title: "Documentation - Mozilla Firefox",
      processName: "firefox",
      pid: 4500,
      minimized: false,
      active: false,
      iconDataUrl: null,
    },
    {
      windowId: "0x10007",
      title: "Calculator",
      processName: "CalculatorApp",
      pid: 4600,
      minimized: false,
      active: false,
      applicationId: "mock-calculator",
      iconDataUrl: null,
    },
    {
      windowId: "0x10008",
      title: "Untitled - Paint",
      processName: "mspaint",
      pid: 4700,
      minimized: false,
      active: false,
      iconDataUrl: null,
    },
    {
      windowId: "0x10009",
      title: "Task Manager",
      processName: "Taskmgr",
      pid: 4800,
      minimized: false,
      active: false,
      iconDataUrl: null,
    },
    {
      windowId: "0x10010",
      title: "Documents - File Explorer",
      processName: "explorer",
      pid: 4900,
      minimized: false,
      active: false,
      iconDataUrl: null,
    },
    {
      windowId: "0x10011",
      title: "Photos",
      processName: "ApplicationFrameHost",
      pid: 5000,
      minimized: false,
      active: false,
      iconDataUrl: null,
    },
    {
      windowId: "0x10012",
      title: "Weather",
      processName: "ApplicationFrameHost",
      pid: 5000,
      minimized: false,
      active: false,
      iconDataUrl: null,
    },
  ],
  foregroundWindowId: "0x10001",
};

export const mockExplorerSnapshot = {
  currentPath: "D:\\Projects\\JARVIS",
  parentPath: "D:\\Projects",
  locations: [
    { id: "home", label: "Home", path: "C:\\Users\\Pilot", kind: "home" },
    { id: "desktop", label: "Desktop", path: "C:\\Users\\Pilot\\Desktop", kind: "desktop" },
    { id: "downloads", label: "Downloads", path: "C:\\Users\\Pilot\\Downloads", kind: "download" },
    { id: "documents", label: "Documents", path: "C:\\Users\\Pilot\\Documents", kind: "document" },
    { id: "pictures", label: "Pictures", path: "C:\\Users\\Pilot\\Pictures", kind: "image" },
  ],
  drives: [
    { id: "C:\\", label: "Local Disk (C:)", path: "C:\\", driveType: "Fixed", totalBytes: 1_000_000_000_000, freeBytes: 412_000_000_000 },
    { id: "D:\\", label: "Atlas Drive", path: "D:\\", driveType: "Fixed", totalBytes: 4_000_000_000_000, freeBytes: 3_488_000_000_000 },
  ],
  breadcrumbs: [
    { label: "D:", path: "D:\\" },
    { label: "Projects", path: "D:\\Projects" },
    { label: "JARVIS", path: "D:\\Projects\\JARVIS" },
  ],
  entries: [
    { name: "assets", path: "D:\\Projects\\JARVIS\\assets", isDirectory: true, kind: "folder", typeLabel: "File folder", extension: "", sizeBytes: null, modified: "2026-07-21T20:44:00+08:00", isLinked: false },
    { name: "frontend", path: "D:\\Projects\\JARVIS\\frontend", isDirectory: true, kind: "folder", typeLabel: "File folder", extension: "", sizeBytes: null, modified: "2026-07-21T21:12:00+08:00", isLinked: false },
    { name: "host", path: "D:\\Projects\\JARVIS\\host", isDirectory: true, kind: "folder", typeLabel: "File folder", extension: "", sizeBytes: null, modified: "2026-07-21T21:13:00+08:00", isLinked: false },
    { name: "系统架构设计文档.pdf", path: "D:\\Projects\\JARVIS\\系统架构设计文档.pdf", isDirectory: false, kind: "pdf", typeLabel: "PDF document", extension: ".pdf", sizeBytes: 4_800_000, modified: "2026-07-20T19:58:00+08:00", isLinked: false },
    { name: "界面设计规范.md", path: "D:\\Projects\\JARVIS\\界面设计规范.md", isDirectory: false, kind: "document", typeLabel: "Markdown document", extension: ".md", sizeBytes: 28_400, modified: "2026-07-20T18:32:00+08:00", isLinked: false },
    { name: "数据模型定义.xlsx", path: "D:\\Projects\\JARVIS\\数据模型定义.xlsx", isDirectory: false, kind: "spreadsheet", typeLabel: "Microsoft Excel worksheet", extension: ".xlsx", sizeBytes: 1_300_000, modified: "2026-07-20T17:09:00+08:00", isLinked: false },
    { name: "部署方案_v0.8.pptx", path: "D:\\Projects\\JARVIS\\部署方案_v0.8.pptx", isDirectory: false, kind: "presentation", typeLabel: "Microsoft PowerPoint presentation", extension: ".pptx", sizeBytes: 3_200_000, modified: "2026-07-19T20:11:00+08:00", isLinked: false },
  ],
  warning: null,
};

function mockParentPath(path) {
  const normalized = path.replace(/[\\/]+$/, "");
  const separatorIndex = normalized.lastIndexOf("\\");
  return separatorIndex > 2 ? normalized.slice(0, separatorIndex) : `${normalized.slice(0, 2)}\\`;
}

function mockJoinPath(parentPath, name) {
  return `${parentPath.replace(/[\\/]+$/, "")}\\${name}`;
}

function mockBaseName(path) {
  return path.replace(/[\\/]+$/, "").split("\\").at(-1) || path;
}

function mockExtension(name) {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index) : "";
}

function mockTypeFromName(name, isDirectory) {
  if (isDirectory) return { kind: "folder", typeLabel: "File folder", extension: "" };
  const extension = mockExtension(name).toLocaleLowerCase();
  if (extension === ".pdf") return { kind: "pdf", typeLabel: "PDF document", extension };
  if ([".xls", ".xlsx", ".csv"].includes(extension)) return { kind: "spreadsheet", typeLabel: "Microsoft Excel worksheet", extension };
  if ([".ppt", ".pptx"].includes(extension)) return { kind: "presentation", typeLabel: "Microsoft PowerPoint presentation", extension };
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) return { kind: "image", typeLabel: "Image", extension };
  if ([".zip", ".rar", ".7z"].includes(extension)) return { kind: "archive", typeLabel: "Archive", extension };
  return { kind: "document", typeLabel: extension ? `${extension.slice(1).toUpperCase()} file` : "File", extension };
}

function mockEntry(name, path, isDirectory, source = null) {
  return {
    name,
    path,
    isDirectory,
    ...mockTypeFromName(name, isDirectory),
    sizeBytes: isDirectory ? null : source?.sizeBytes ?? 1_024,
    modified: new Date().toISOString(),
    isLinked: false,
  };
}

function mockBreadcrumbs(path) {
  const root = path.slice(0, 3);
  const segments = path.slice(3).split("\\").filter(Boolean);
  let current = root;
  return [
    { label: root.replace("\\", ""), path: root },
    ...segments.map((segment) => {
      current = mockJoinPath(current, segment);
      return { label: segment, path: current };
    }),
  ];
}

function normalizeOpenParams(value) {
  return typeof value === "string" ? { target: value } : value;
}

function normalizeRendererFaultText(value, name, maximumLength, required) {
  if (value == null && !required) return "";
  if (typeof value !== "string") {
    throw new Error(`feed.reportFault params.${name} must be a string${required ? "" : " or null"}.`);
  }

  const normalized = value.trim();
  if (required && normalized.length === 0) {
    throw new Error(`feed.reportFault requires a non-empty params.${name} string.`);
  }
  if (normalized.length > maximumLength) {
    throw new Error(`feed.reportFault params.${name} must not exceed ${maximumLength} characters.`);
  }
  if (/\p{Cc}/u.test(normalized)) {
    throw new Error(`feed.reportFault params.${name} must not contain control characters.`);
  }

  return normalized;
}

function normalizeRendererFaultReport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("feed.reportFault requires a params object.");
  }

  Object.keys(value).forEach((name) => {
    if (!RENDERER_FAULT_PARAMETER_NAMES.has(name)) {
      throw new Error(`feed.reportFault does not accept params.${name}.`);
    }
  });

  const source = normalizeRendererFaultText(value.source, "source", 32, true).toLowerCase();
  if (!RENDERER_FAULT_SOURCES.has(source)) {
    throw new Error(`Renderer fault source '${source}' is not supported.`);
  }

  const severity = normalizeRendererFaultText(value.severity, "severity", 16, true).toLowerCase();
  if (!RENDERER_FAULT_SEVERITIES.has(severity)) {
    throw new Error("Renderer faults must use warning or error severity.");
  }

  const title = normalizeRendererFaultText(
    value.title,
    "title",
    RENDERER_FAULT_TITLE_MAX_LENGTH,
    true,
  );
  const detail = normalizeRendererFaultText(
    value.detail,
    "detail",
    RENDERER_FAULT_DETAIL_MAX_LENGTH,
    false,
  );
  const requestedActionId = normalizeRendererFaultText(value.actionId, "actionId", 32, false).toLowerCase();
  if (requestedActionId && !RENDERER_FAULT_ACTION_IDS.has(requestedActionId)) {
    throw new Error(`Renderer fault action '${requestedActionId}' is not supported.`);
  }

  return {
    source,
    severity,
    title,
    detail,
    actionId: requestedActionId || null,
  };
}

export function createMockPlatform() {
  const eventListeners = new Map();
  const terminalSessions = new Map();
  let terminalSequence = 0;
  let agentSequence = 0;
  let agentMessages = [];
  let activeAgentRun = null;
  let agentState = {
    available: true,
    configured: true,
    connected: true,
    status: "ready",
    provider: "browser-preview",
    model: "local-simulator",
    sessionId: `browser-preview-${Date.now()}-0`,
    permissionMode: "chat-only",
    error: null,
    activeRunId: null,
  };
  let windowAppearanceRules = readMockWindowAppearanceRules();
  let windowAppearanceState = createMockWindowAppearanceState(
    readMockWindowAppearanceMode(),
    windowAppearanceRules,
  );
  let taskbarModeState = createMockTaskbarModeState(readMockTaskbarMode());
  let traySnapshot = {
    timestamp: new Date().toISOString(),
    audio: {
      available: true,
      volumePercent: 64,
      muted: false,
      deviceLabel: "Simulated output",
      error: null,
    },
    network: { ...mockSystemSnapshot.network },
    power: { ...mockSystemSnapshot.power },
    simulation: true,
  };
  let systemFeedSnapshot = {
    items: [{
      id: "mock-runtime-ready",
      type: "runtime.ready",
      severity: "info",
      title: "Browser preview simulation active",
      detail: "Native Windows events are not available in this preview.",
      timestamp: new Date().toISOString(),
      unread: true,
      actionId: null,
    }],
    unreadCount: 1,
    capacity: 50,
  };
  let rendererFaultSequence = 0;
  const rendererFaultLastByKey = new Map();
  const mockSessionActions = [
    {
      id: "lock",
      label: "LOCK DEVICE",
      detail: "Return to the Windows sign-in screen without closing applications.",
      consequence: "Your applications remain open and the current user session stays active.",
      destructive: false,
    },
    {
      id: "sign-out",
      label: "SIGN OUT",
      detail: "End the current Windows user session.",
      consequence: "Open applications may block sign-out so you can save unsaved work.",
      destructive: true,
    },
    {
      id: "restart",
      label: "RESTART",
      detail: "Restart Windows using the standard local shutdown service.",
      consequence: "Open applications may block restart so you can save unsaved work.",
      destructive: true,
    },
    {
      id: "shut-down",
      label: "SHUT DOWN",
      detail: "Shut down this PC using the standard local shutdown service.",
      consequence: "Open applications may block shutdown so you can save unsaved work.",
      destructive: true,
    },
  ];
  let mockSessionChallenge = null;
  let mockSessionTokenSequence = 0;
  let runtimeInfo = {
    productName: "JARVIS",
    version: "0.1.0-mock",
    buildConfiguration: "DEVELOPMENT",
    executablePath: "C:\\Program Files\\JARVIS\\Jarvis.Host.exe",
    startupEnabled: false,
    startupCommandCurrent: false,
    startupCommand: null,
    installationMode: "DEVELOPMENT",
    windowsVersion: "Microsoft Windows 11 Pro 25H2 10.0.26200.8875",
    webView2Version: "138.0.3351.48",
    safeMode: true,
    recoveryReady: true,
    requestedTaskbarMode: taskbarModeState.requestedMode,
    effectiveTaskbarMode: taskbarModeState.effectiveMode,
    taskbarFallbackReason: null,
    taskbarLifecycleState: "ReplacementActive",
    taskbarGeneration: 1,
  };
  let taskbarSnapshot = {
    ...mockTaskbarSnapshot,
    windows: mockTaskbarSnapshot.windows.map((window) => ({ ...window })),
  };
  let showDesktopRestoreWindows = [];
  let applicationCatalogRevision = 1;
  let desktopRevision = 1;
  let mockClipboard = {
    paths: [],
    mode: "copy",
    source: "empty",
    changedAtUtc: new Date().toISOString(),
  };
  const mockApplications = [
    { applicationId: "mock-powershell", label: "PowerShell 7", category: "PowerShell", source: "user", processNames: ["pwsh", "powershell"], iconDataUrl: null },
    { applicationId: "mock-edge", label: "Microsoft Edge", category: "Applications", source: "common", processNames: ["msedge"], iconDataUrl: null },
    { applicationId: "mock-github", label: "GitHub Desktop", category: "GitHub, Inc", source: "user", processNames: ["githubdesktop"], iconDataUrl: null },
    { applicationId: "mock-calculator", label: "Calculator", category: "Windows Apps", source: "packaged", processNames: [], iconDataUrl: null },
  ];
  const createMockApplicationCatalog = (refreshReason = "initial") => ({
    applications: mockApplications,
    indexedAtUtc: new Date().toISOString(),
    sourceCount: 3,
    truncated: false,
    revision: applicationCatalogRevision,
    refreshReason,
    watching: true,
    watchRootCount: 2,
  });
  const explorerEntriesByPath = new Map([
    [mockExplorerSnapshot.currentPath, mockExplorerSnapshot.entries.map((entry) => ({ ...entry }))],
    ["C:\\Users\\Pilot\\Desktop", mockDesktopEntries
      .filter((entry) => entry.path)
      .map((entry) => mockEntry(
        entry.path.split("\\").at(-1),
        entry.path,
        entry.kind === "directory",
      ))],
    ["C:\\Users\\Pilot\\Desktop\\Projects", []],
    ...mockExplorerSnapshot.entries
      .filter((entry) => entry.isDirectory)
      .map((entry) => [entry.path, []]),
  ]);
  const mockDesktopPath = "C:\\Users\\Pilot\\Desktop";
  const desktopEntryTemplates = new Map(
    mockDesktopEntries.filter((entry) => entry.path).map((entry) => [entry.path, entry]),
  );

  const getExplorerEntries = (path) => explorerEntriesByPath.get(path) ?? [];

  const getMockDesktopSnapshot = () => ({
    entries: [
      ...mockDesktopEntries.filter((entry) => !entry.path),
      ...getExplorerEntries(mockDesktopPath).map((item) => {
        const template = desktopEntryTemplates.get(item.path);
        return {
          ...(template ?? {}),
          id: template?.id ?? item.path,
          label: item.name.replace(/\.lnk$/i, ""),
          name: template?.name ?? item.name,
          path: item.path,
          target: template?.target ?? item.path,
          source: "mock",
          kind: item.isDirectory ? "directory" : template?.kind ?? "file",
          icon: template?.icon ?? (item.isDirectory ? "folder" : "document"),
        };
      }),
    ],
    userDesktopPath: mockDesktopPath,
    publicDesktopPath: "C:\\Users\\Public\\Desktop",
    revision: desktopRevision,
    changedAtUtc: new Date().toISOString(),
    watching: true,
    watchRootCount: 2,
  });

  const emitMockDesktopChanged = () => {
    desktopRevision += 1;
    emit("desktop.entriesChanged", getMockDesktopSnapshot());
  };

  const replaceExplorerEntry = (path, replacement = null) => {
    const parentPath = mockParentPath(path);
    const entries = getExplorerEntries(parentPath);
    explorerEntriesByPath.set(parentPath, replacement
      ? entries.map((entry) => (entry.path === path ? replacement : entry))
      : entries.filter((entry) => entry.path !== path));
  };

  const createUniqueMockPath = (destinationPath, sourceEntry, isCopy) => {
    const existingNames = new Set(getExplorerEntries(destinationPath).map((entry) => entry.name.toLocaleLowerCase()));
    if (!existingNames.has(sourceEntry.name.toLocaleLowerCase())) return mockJoinPath(destinationPath, sourceEntry.name);
    const extension = sourceEntry.isDirectory ? "" : mockExtension(sourceEntry.name);
    const stem = sourceEntry.isDirectory ? sourceEntry.name : sourceEntry.name.slice(0, -extension.length);
    for (let counter = 1; counter <= 10_000; counter += 1) {
      const suffix = `${isCopy ? " - Copy" : ""}${counter === 1 ? "" : ` (${counter})`}`;
      const name = `${stem}${suffix}${extension}`;
      if (!existingNames.has(name.toLocaleLowerCase())) return mockJoinPath(destinationPath, name);
    }
    throw new Error("Unable to generate a unique mock destination name");
  };

  const cloneMockTree = (sourcePath, targetPath) => {
    const children = getExplorerEntries(sourcePath);
    explorerEntriesByPath.set(targetPath, children.map((child) => {
      const childTarget = mockJoinPath(targetPath, child.name);
      if (child.isDirectory) cloneMockTree(child.path, childTarget);
      return { ...child, path: childTarget };
    }));
  };

  const removeMockTree = (path) => {
    getExplorerEntries(path).filter((entry) => entry.isDirectory).forEach((entry) => removeMockTree(entry.path));
    explorerEntriesByPath.delete(path);
  };

  let activeTransfer = null;
  let transferTimer = null;
  let taskbarModeTimer = null;

  const emit = (eventName, data) => {
    eventListeners.get(eventName)?.forEach((listener) => listener(data));
  };

  const cloneSystemFeedSnapshot = () => ({
    ...systemFeedSnapshot,
    items: systemFeedSnapshot.items.map((item) => ({ ...item })),
  });

  const reportRendererFault = (value) => {
    const report = normalizeRendererFaultReport(value);
    const now = Date.now();
    const cutoff = now - RENDERER_FAULT_DUPLICATE_WINDOW_MS;
    rendererFaultLastByKey.forEach((timestamp, key) => {
      if (timestamp <= cutoff) rendererFaultLastByKey.delete(key);
    });

    const key = [
      report.source,
      report.severity,
      report.title.length,
      report.title,
      report.detail.length,
      report.detail,
      report.actionId ?? "",
    ].join(":");
    const previousTimestamp = rendererFaultLastByKey.get(key);
    if (previousTimestamp != null && now - previousTimestamp < RENDERER_FAULT_DUPLICATE_WINDOW_MS) {
      return cloneSystemFeedSnapshot();
    }

    rendererFaultLastByKey.set(key, now);
    if (rendererFaultLastByKey.size > systemFeedSnapshot.capacity) {
      [...rendererFaultLastByKey.entries()]
        .sort((left, right) => left[1] - right[1])
        .slice(0, rendererFaultLastByKey.size - systemFeedSnapshot.capacity)
        .forEach(([entryKey]) => rendererFaultLastByKey.delete(entryKey));
    }

    rendererFaultSequence += 1;
    const item = {
      id: `mock-renderer-fault-${now}-${rendererFaultSequence}`,
      type: `renderer.${report.source}.fault`,
      severity: report.severity,
      title: report.title,
      detail: report.detail,
      timestamp: new Date(now).toISOString(),
      unread: true,
      actionId: report.actionId,
    };
    const items = [item, ...systemFeedSnapshot.items].slice(0, systemFeedSnapshot.capacity);
    systemFeedSnapshot = {
      ...systemFeedSnapshot,
      items,
      unreadCount: items.filter((entry) => entry.unread).length,
    };
    const snapshot = cloneSystemFeedSnapshot();
    emit("feed.snapshot", snapshot);
    return snapshot;
  };

  const cloneAgentState = () => ({ ...agentState });
  const cloneAgentMessages = () => agentMessages.map((message) => ({ ...message }));
  const emitAgentState = () => emit("agent.stateChanged", cloneAgentState());
  const emitAgentEvent = (event) => emit("agent.event", event);

  const clearAgentTimers = (run) => {
    run?.timers.forEach((timer) => globalThis.clearTimeout(timer));
    run?.timers.clear();
  };

  const scheduleAgentEvent = (run, callback, delay) => {
    const timer = globalThis.setTimeout(() => {
      run.timers.delete(timer);
      if (activeAgentRun !== run) return;
      callback();
    }, delay);
    run.timers.add(timer);
  };

  const finishAgentRun = (run, status = "complete", error = null) => {
    if (activeAgentRun !== run) return;
    clearAgentTimers(run);
    const message = agentMessages.find((entry) => entry.id === run.messageId);
    if (message) message.status = status;
    emitAgentEvent({
      kind: "message-complete",
      runId: run.runId,
      messageId: run.messageId,
      status,
    });
    emitAgentEvent({
      kind: "run-end",
      runId: run.runId,
      status,
      ...(error ? { error } : {}),
    });
    activeAgentRun = null;
    agentState = {
      ...agentState,
      status: error ? "error" : "ready",
      error,
      activeRunId: null,
    };
    emitAgentState();
  };

  const beginMockTaskbarTransition = (mode, reason) => {
    if (taskbarModeTimer !== null) {
      globalThis.clearTimeout(taskbarModeTimer);
      taskbarModeTimer = null;
    }

    const generation = taskbarModeState.transitionGeneration + 1;
    taskbarModeState = createMockTaskbarModeState(mode, {
      effectiveMode: taskbarModeState.effectiveMode,
      transitionStatus: "applying",
      transitionGeneration: generation,
      transitionReason: reason,
    });
    runtimeInfo = {
      ...runtimeInfo,
      requestedTaskbarMode: mode,
      taskbarLifecycleState: "Rebinding",
      taskbarGeneration: generation,
    };
    emit("taskbarMode.changed", { ...taskbarModeState });
    taskbarModeTimer = globalThis.setTimeout(() => {
      taskbarModeState = createMockTaskbarModeState(mode, {
        transitionGeneration: generation,
        transitionReason: `${mode} mock surface ready`,
      });
      runtimeInfo = {
        ...runtimeInfo,
        requestedTaskbarMode: mode,
        effectiveTaskbarMode: mode,
        taskbarFallbackReason: null,
        taskbarLifecycleState: mode === "native" ? "NativeVisible" : "ReplacementActive",
        taskbarGeneration: generation,
      };
      taskbarModeTimer = null;
      emit("taskbarMode.changed", { ...taskbarModeState });
    }, 120);
    return { ...taskbarModeState };
  };

  const findMockSource = (path) => {
    const sourceParent = mockParentPath(path);
    const source = getExplorerEntries(sourceParent).find((entry) => entry.path === path);
    return { sourceParent, source };
  };

  const mockTransferConflicts = (paths, destinationPath) => paths.flatMap((path) => {
    const { source } = findMockSource(path);
    if (!source) return [];
    const target = getExplorerEntries(destinationPath)
      .find((entry) => entry.name.toLocaleLowerCase() === source.name.toLocaleLowerCase());
    return target ? [{
      source: path,
      target: target.path,
      name: source.name,
      sourceIsDirectory: source.isDirectory,
      targetIsDirectory: target.isDirectory,
    }] : [];
  });

  const performMockTransfer = (paths, destinationPath, mode, conflictPolicy) => {
    const items = [];
    const failures = [];
    const skipped = [];
    paths.forEach((path) => {
      const { sourceParent, source } = findMockSource(path);
      if (!source) {
        failures.push({ source: path, code: "TARGET_NOT_FOUND", message: "The selected item no longer exists." });
        return;
      }
      if (mode === "move" && sourceParent === destinationPath) {
        items.push({ source: path, target: path, name: source.name });
        return;
      }

      const existing = getExplorerEntries(destinationPath)
        .find((entry) => entry.name.toLocaleLowerCase() === source.name.toLocaleLowerCase());
      if (existing && conflictPolicy === "skip") {
        skipped.push({ source: path, code: "SKIPPED_CONFLICT", message: "An item with the same name already exists." });
        return;
      }
      if (existing?.path === path && conflictPolicy === "replace") {
        failures.push({ source: path, code: "INVALID_CONFLICT_POLICY", message: "A source item cannot replace itself." });
        return;
      }
      if (existing && conflictPolicy === "replace") {
        replaceExplorerEntry(existing.path);
        if (existing.isDirectory) removeMockTree(existing.path);
      }

      const target = existing && conflictPolicy === "rename"
        ? createUniqueMockPath(destinationPath, source, mode === "copy")
        : mockJoinPath(destinationPath, source.name);
      const targetEntry = { ...source, path: target, name: mockBaseName(target), modified: new Date().toISOString() };
      explorerEntriesByPath.set(destinationPath, [...getExplorerEntries(destinationPath), targetEntry]);
      if (source.isDirectory) cloneMockTree(path, target);
      if (mode === "move") {
        replaceExplorerEntry(path);
        if (source.isDirectory) removeMockTree(path);
      }
      items.push({ source: path, target, name: targetEntry.name });
    });
    return { operation: mode, items, failures, skipped };
  };

  const emitMockTransfer = () => {
    if (activeTransfer) emit("explorer.transferChanged", { ...activeTransfer });
  };

  return {
    kind: "mock",
    isNative: false,
    events: {
      subscribe(eventName, listener) {
        let listeners = eventListeners.get(eventName);
        if (!listeners) {
          listeners = new Set();
          eventListeners.set(eventName, listeners);
        }
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          if (listeners.size === 0) eventListeners.delete(eventName);
        };
      },
    },
    agent: {
      async getState() {
        return cloneAgentState();
      },
      async getMessages() {
        return cloneAgentMessages();
      },
      async prompt(message, clientMessageId) {
        const text = String(message ?? "").trim();
        if (!text || !String(clientMessageId ?? "").trim()) {
          const error = new Error("Agent prompts require text and a client message ID.");
          error.code = "INVALID_ARGUMENT";
          throw error;
        }
        if (activeAgentRun) {
          const error = new Error("The browser preview Agent is already responding.");
          error.code = "AGENT_BUSY";
          throw error;
        }

        agentSequence += 1;
        const timestamp = new Date().toISOString();
        const runId = `browser-run-${agentSequence}`;
        const userMessage = {
          id: `browser-user-${agentSequence}`,
          role: "user",
          text,
          status: "complete",
          createdAt: timestamp,
          clientMessageId: String(clientMessageId),
          runId,
        };
        const assistantMessage = {
          id: `browser-assistant-${agentSequence}`,
          role: "assistant",
          text: "",
          status: "streaming",
          createdAt: timestamp,
          clientMessageId: null,
          runId,
        };
        const run = {
          runId,
          messageId: assistantMessage.id,
          timers: new Set(),
        };
        activeAgentRun = run;
        agentMessages.push(userMessage, assistantMessage);
        agentState = {
          ...agentState,
          status: "running",
          error: null,
          activeRunId: run.runId,
        };

        emitAgentEvent({ kind: "message", runId, message: { ...userMessage } });
        emitAgentEvent({ kind: "message", runId, message: { ...assistantMessage } });
        emitAgentEvent({ kind: "run-start", runId: run.runId });
        emitAgentState();

        const directiveMarker = "[USER DIRECTIVE]";
        const directiveIndex = text.indexOf(directiveMarker);
        const visibleDirective = directiveIndex < 0
          ? text
          : text.slice(directiveIndex + directiveMarker.length).trim();
        const excerpt = visibleDirective.length > 80
          ? `${visibleDirective.slice(0, 77)}...`
          : visibleDirective;
        const chunks = [
          "BROWSER PREVIEW — ",
          `This is a local simulated response to “${excerpt}”. `,
          "It did not inspect, change, or execute anything on your system.",
        ];
        chunks.forEach((delta, index) => {
          scheduleAgentEvent(run, () => {
            assistantMessage.text += delta;
            emitAgentEvent({
              kind: "text-delta",
              runId,
              messageId: assistantMessage.id,
              delta,
            });
            if (index === chunks.length - 1) finishAgentRun(run);
          }, 180 * (index + 1));
        });

        return {
          accepted: true,
          mock: true,
          runId: run.runId,
          clientMessageId: String(clientMessageId),
        };
      },
      async abort() {
        const run = activeAgentRun;
        if (!run) return { aborted: false, mock: true };
        finishAgentRun(run, "aborted");
        return { aborted: true, mock: true, runId: run.runId };
      },
      async newSession() {
        if (activeAgentRun) finishAgentRun(activeAgentRun, "aborted");
        agentSequence += 1;
        agentMessages = [];
        agentState = {
          ...agentState,
          status: "ready",
          sessionId: `browser-preview-${Date.now()}-${agentSequence}`,
          error: null,
          activeRunId: null,
        };
        emitAgentState();
        return cloneAgentState();
      },
    },
    system: {
      async getSnapshot() {
        return mockSystemSnapshot;
      },
      async getDetails() {
        return {
          capturedAt: new Date().toISOString(),
          computer: {
            machineName: "AVALON-PRIME",
            processorName: "AMD Ryzen 9 7950X 16-Core Processor",
            logicalProcessors: 32,
            manufacturer: "ASUS",
            model: "ROG STRIX X670E-E GAMING WIFI",
            biosVendor: "American Megatrends International",
            biosVersion: "1905",
            operatingSystem: "Microsoft Windows 11 Pro",
            operatingSystemVersion: "10.0.26200.8875",
          },
          graphicsAdapters: [
            { name: "NVIDIA GeForce RTX 4090", driverVersion: "32.0.15.7688" },
            { name: "AMD Radeon Graphics", driverVersion: "31.0.24033.1003" },
          ],
          drives: [
            { name: "C:\\", label: "SYSTEM", driveType: "Fixed", fileSystem: "NTFS", totalBytes: 2_000_000_000_000, freeBytes: 824_000_000_000 },
            { name: "D:\\", label: "DATA", driveType: "Fixed", fileSystem: "NTFS", totalBytes: 4_000_000_000_000, freeBytes: 3_488_000_000_000 },
          ],
          processes: mockSystemSnapshot.processes.map((process, index) => ({
            pid: process.pid,
            name: process.name,
            workingSetBytes: process.workingSetBytes,
            privateMemoryBytes: Math.round(process.workingSetBytes * 0.84),
            threadCount: 18 + index * 3,
            basePriority: 8,
            sessionId: 1,
            responding: true,
            startedAt: new Date(Date.now() - (index + 1) * 3_600_000).toISOString(),
          })),
          sensors: {
            available: false,
            detail: "Temperature, voltage, and fan sensors require a separately audited hardware provider.",
          },
        };
      },
    },
    desktop: {
      async listEntries() {
        return getMockDesktopSnapshot();
      },
    },
    clipboard: {
      async read() {
        return { ...mockClipboard, paths: [...mockClipboard.paths] };
      },
      async write(paths, mode = "copy") {
        mockClipboard = {
          paths: [...paths],
          mode: mode === "move" ? "move" : "copy",
          source: "jarvis",
          changedAtUtc: new Date().toISOString(),
        };
        return { ...mockClipboard, paths: [...mockClipboard.paths] };
      },
      async clear() {
        mockClipboard = {
          paths: [],
          mode: "copy",
          source: "empty",
          changedAtUtc: new Date().toISOString(),
        };
        return { ...mockClipboard, paths: [] };
      },
    },
    display: {
      async getTopology() {
        return {
          monitors: [
            {
              id: "\\\\.\\DISPLAY1",
              deviceName: "\\\\.\\DISPLAY1",
              isPrimary: true,
              bounds: { x: 0, y: 0, width: 2560, height: 1440 },
              workArea: { x: 0, y: 0, width: 2560, height: 1366 },
              dpiX: 120,
              dpiY: 120,
              scalePercent: 125,
            },
            {
              id: "\\\\.\\DISPLAY2",
              deviceName: "\\\\.\\DISPLAY2",
              isPrimary: false,
              bounds: { x: 2560, y: 180, width: 1920, height: 1080 },
              workArea: { x: 2560, y: 180, width: 1920, height: 1040 },
              dpiX: 96,
              dpiY: 96,
              scalePercent: 100,
            },
          ],
          virtualBounds: { x: 0, y: 0, width: 4480, height: 1440 },
          primaryMonitorId: "\\\\.\\DISPLAY1",
          osBuild: 26200,
          windows10Compatible: true,
          desktopSurfacePolicy: "primary-only",
          secondaryTaskbarsPreserved: true,
          capturedAtUtc: new Date().toISOString(),
        };
      },
    },
    notifications: {
      async getState() {
        return {
          apiAvailable: true,
          packaged: false,
          packageIdentity: null,
          accessStatus: "requires-package-identity",
          historyAvailable: false,
          canRequestAccess: false,
          reason: "Notification history requires a signed MSIX package identity and user permission.",
          items: [],
          checkedAtUtc: new Date().toISOString(),
        };
      },
      async requestAccess() {
        return this.getState();
      },
    },
    explorer: {
      async browse(path = null) {
        const currentPath = path || mockExplorerSnapshot.currentPath;
        return {
          ...mockExplorerSnapshot,
          currentPath,
          parentPath: mockParentPath(currentPath),
          breadcrumbs: mockBreadcrumbs(currentPath),
          entries: getExplorerEntries(currentPath),
        };
      },
      async openFile(path) {
        return { opened: false, mock: true, target: path, mode: "file" };
      },
      async openInWindows(path) {
        return { opened: false, mock: true, target: path, mode: "windows-explorer" };
      },
      async showProperties(path) {
        return { opened: false, mock: true, target: path, mode: "properties" };
      },
      async createFolder(path, name) {
        const target = mockJoinPath(path, name);
        if (getExplorerEntries(path).some((entry) => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
          const error = new Error("An item with that name already exists in this folder.");
          error.code = "NAME_CONFLICT";
          throw error;
        }
        const entry = mockEntry(name, target, true);
        explorerEntriesByPath.set(path, [...getExplorerEntries(path), entry]);
        explorerEntriesByPath.set(target, []);
        if (path === mockDesktopPath) emitMockDesktopChanged();
        return { operation: "create-folder", items: [{ source: path, target, name }], failures: [] };
      },
      async rename(path, name) {
        const parentPath = mockParentPath(path);
        const source = getExplorerEntries(parentPath).find((entry) => entry.path === path);
        if (!source) throw new Error("The selected item no longer exists.");
        const target = mockJoinPath(parentPath, name);
        if (getExplorerEntries(parentPath).some((entry) => entry.path !== path && entry.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
          const error = new Error("An item with that name already exists in this folder.");
          error.code = "NAME_CONFLICT";
          throw error;
        }
        const replacement = { ...source, ...mockEntry(name, target, source.isDirectory, source) };
        replaceExplorerEntry(path, replacement);
        if (source.isDirectory) {
          cloneMockTree(path, target);
          removeMockTree(path);
        }
        if (parentPath === mockDesktopPath) emitMockDesktopChanged();
        return { operation: "rename", items: [{ source: path, target, name }], failures: [] };
      },
      async preflightTransfer(paths, destinationPath, mode) {
        return {
          mode,
          destinationPath,
          itemCount: paths.length,
          conflicts: mockTransferConflicts(paths, destinationPath),
          crossesVolumes: paths.some((path) => path.slice(0, 2).toLocaleLowerCase() !== destinationPath.slice(0, 2).toLocaleLowerCase()),
        };
      },
      async startTransfer(paths, destinationPath, mode, conflictPolicy = "rename") {
        if (activeTransfer && !["completed", "completed-with-errors", "cancelled", "failed"].includes(activeTransfer.status)) {
          const error = new Error("Another JARVIS file transfer is still active.");
          error.code = "TRANSFER_BUSY";
          throw error;
        }

        const totalBytes = paths.reduce((total, path) => {
          const { source } = findMockSource(path);
          return total + Number(source?.sizeBytes ?? 8 * DECIMAL_MB);
        }, 0);
        const now = new Date().toISOString();
        activeTransfer = {
          jobId: `mock-transfer-${Date.now()}`,
          mode,
          conflictPolicy,
          status: "queued",
          currentItem: null,
          totalItems: paths.length,
          completedItems: 0,
          failedItems: 0,
          skippedItems: 0,
          totalBytes,
          bytesTransferred: 0,
          percent: 0,
          startedAt: now,
          updatedAt: now,
          error: null,
          result: { operation: mode, items: [], failures: [], skipped: [] },
        };
        emitMockTransfer();

        transferTimer = window.setTimeout(() => {
          if (!activeTransfer || activeTransfer.status === "cancelling") return;
          activeTransfer = { ...activeTransfer, status: "scanning", updatedAt: new Date().toISOString() };
          emitMockTransfer();
          let percent = 0;
          const advance = () => {
            if (!activeTransfer || activeTransfer.status === "cancelling") return;
            percent += 20;
            if (percent < 100) {
              activeTransfer = {
                ...activeTransfer,
                status: "transferring",
                currentItem: mockBaseName(paths[Math.min(paths.length - 1, Math.floor(percent / 100 * paths.length))] ?? ""),
                percent,
                bytesTransferred: Math.round(totalBytes * percent / 100),
                updatedAt: new Date().toISOString(),
              };
              emitMockTransfer();
              transferTimer = window.setTimeout(advance, 90);
              return;
            }

            const result = performMockTransfer(paths, destinationPath, mode, conflictPolicy);
            if (destinationPath === mockDesktopPath ||
                (mode === "move" && paths.some((path) => mockParentPath(path) === mockDesktopPath))) {
              emitMockDesktopChanged();
            }
            activeTransfer = {
              ...activeTransfer,
              status: result.failures.length ? "completed-with-errors" : "completed",
              currentItem: null,
              completedItems: result.items.length,
              failedItems: result.failures.length,
              skippedItems: result.skipped.length,
              bytesTransferred: totalBytes,
              percent: 100,
              updatedAt: new Date().toISOString(),
              result,
            };
            transferTimer = null;
            emitMockTransfer();
          };
          transferTimer = window.setTimeout(advance, 90);
        }, 80);
        return { ...activeTransfer };
      },
      async cancelTransfer(jobId) {
        if (!activeTransfer || activeTransfer.jobId !== jobId) {
          const error = new Error("The requested file transfer is no longer available.");
          error.code = "TRANSFER_NOT_FOUND";
          throw error;
        }
        if (transferTimer !== null) {
          window.clearTimeout(transferTimer);
          transferTimer = null;
        }
        activeTransfer = {
          ...activeTransfer,
          status: "cancelled",
          currentItem: null,
          bytesTransferred: 0,
          percent: 0,
          updatedAt: new Date().toISOString(),
        };
        emitMockTransfer();
        return { ...activeTransfer };
      },
      async getTransfers() {
        return { jobs: activeTransfer ? [{ ...activeTransfer }] : [] };
      },
      async recycle(paths) {
        const items = [];
        paths.forEach((path) => {
          const sourceParent = mockParentPath(path);
          const source = getExplorerEntries(sourceParent).find((entry) => entry.path === path);
          if (!source) return;
          replaceExplorerEntry(path);
          if (source.isDirectory) removeMockTree(path);
          items.push({ source: path, target: path, name: source.name });
        });
        if (paths.some((path) => mockParentPath(path) === mockDesktopPath)) {
          emitMockDesktopChanged();
        }
        return { operation: "recycle", items, failures: [] };
      },
    },
    terminal: {
      async listProfiles() {
        return {
          conPtyAvailable: true,
          defaultProfileId: "powershell",
          profiles: [
            { id: "powershell", label: "PowerShell 7", available: true, isDefault: true },
            { id: "cmd", label: "Command Prompt", available: true, isDefault: false },
            { id: "wsl", label: "Windows Subsystem for Linux", available: true, isDefault: false },
          ],
        };
      },
      async create(profileId = "powershell", columns = 120, rows = 32) {
        const sessionId = (++terminalSequence).toString(16).padStart(32, "0");
        const profileLabel = profileId === "cmd"
          ? "Command Prompt"
          : profileId === "wsl"
            ? "Windows Subsystem for Linux"
            : "PowerShell 7";
        const session = { sessionId, profileId, profileLabel, columns, rows, sequence: 0 };
        terminalSessions.set(sessionId, session);
        window.setTimeout(() => {
          if (!terminalSessions.has(sessionId)) return;
          session.sequence += 1;
          emit("terminal.output", {
            sessionId,
            sequence: session.sequence,
            data: `\u001b[38;2;34;207;255mJARVIS CONPTY LINK READY\u001b[0m\r\n${profileLabel} · MOCK SESSION\r\n\r\nPS C:\\Users\\Pilot> `,
          });
        }, 40);
        return { ...session, processId: 7340 + terminalSequence };
      },
      async write(sessionId, data) {
        const session = terminalSessions.get(sessionId);
        if (!session) throw new Error("The terminal session is no longer active.");
        session.sequence += 1;
        const output = data === "\r"
          ? "\r\nPS C:\\Users\\Pilot> "
          : data === "\u0003"
            ? "^C\r\nPS C:\\Users\\Pilot> "
            : data;
        emit("terminal.output", { sessionId, sequence: session.sequence, data: output });
        return { sessionId, bytesWritten: new TextEncoder().encode(data).length };
      },
      async resize(sessionId, columns, rows) {
        const session = terminalSessions.get(sessionId);
        if (!session) throw new Error("The terminal session is no longer active.");
        session.columns = columns;
        session.rows = rows;
        return { sessionId, columns, rows };
      },
      async close(sessionId) {
        const closed = terminalSessions.delete(sessionId);
        return { sessionId, closed };
      },
    },
    taskbar: {
      async getSnapshot() {
        return taskbarSnapshot;
      },
      async activateWindow(windowId) {
        const target = taskbarSnapshot.windows.find((window) => window.windowId === windowId);
        if (!target) return { activated: false, mock: true, windowId };

        taskbarSnapshot = {
          windows: taskbarSnapshot.windows.map((window) => ({
            ...window,
            active: window.windowId === windowId,
            minimized: window.windowId === windowId ? false : window.minimized,
          })),
          foregroundWindowId: windowId,
        };
        emit("taskbar.snapshot", taskbarSnapshot);
        return { activated: true, mock: true, windowId };
      },
      async toggleWindow(windowId) {
        const target = taskbarSnapshot.windows.find((window) => window.windowId === windowId);
        if (!target) return { toggled: false, mock: true, windowId };

        const minimize = target.active && !target.minimized;
        taskbarSnapshot = {
          windows: taskbarSnapshot.windows.map((window) => ({
            ...window,
            active: minimize ? false : window.windowId === windowId,
            minimized: window.windowId === windowId ? minimize : window.minimized,
          })),
          foregroundWindowId: minimize ? null : windowId,
        };
        emit("taskbar.snapshot", taskbarSnapshot);
        return { toggled: true, mock: true, windowId, action: minimize ? "minimized" : "activated" };
      },
      async closeWindow(windowId) {
        const before = taskbarSnapshot.windows.length;
        taskbarSnapshot = {
          windows: taskbarSnapshot.windows.filter((window) => window.windowId !== windowId),
          foregroundWindowId: taskbarSnapshot.foregroundWindowId === windowId
            ? null
            : taskbarSnapshot.foregroundWindowId,
        };
        emit("taskbar.snapshot", taskbarSnapshot);
        return { closed: taskbarSnapshot.windows.length < before, mock: true, windowId };
      },
      async toggleDesktop(options = {}) {
        const visibleWindows = taskbarSnapshot.windows.filter((window) => !window.minimized);
        const hasVisibleWindow =
          visibleWindows.length > 0 ||
          options.hasVisibleInternalWindow === true;
        const restoreById = new Map(
          showDesktopRestoreWindows.map((window) => [window.windowId, window]),
        );
        const restorableWindows = taskbarSnapshot.windows.filter((window) =>
          window.minimized && restoreById.has(window.windowId));

        if (!hasVisibleWindow && restorableWindows.length > 0) {
          const restoredIds = new Set(restorableWindows.map((window) => window.windowId));
          const foregroundWindow = restorableWindows.find((window) =>
            restoreById.get(window.windowId)?.wasActive) ?? restorableWindows[0];
          taskbarSnapshot = {
            ...taskbarSnapshot,
            windows: taskbarSnapshot.windows.map((window) => restoredIds.has(window.windowId)
              ? {
                ...window,
                minimized: false,
                active: window.windowId === foregroundWindow.windowId,
              }
              : window),
            foregroundWindowId: foregroundWindow.windowId,
          };
          showDesktopRestoreWindows = [];
          emit("taskbar.snapshot", taskbarSnapshot);
          return {
            action: "restored",
            affectedWindowCount: restoredIds.size,
            restoreAvailable: false,
            restoreJarvisForeground: false,
            mock: true,
          };
        }

        const minimizedIds = new Set(visibleWindows.map((window) => window.windowId));
        showDesktopRestoreWindows = visibleWindows.map((window) => ({
          windowId: window.windowId,
          wasActive: window.active === true,
        }));
        taskbarSnapshot = {
          ...taskbarSnapshot,
          windows: taskbarSnapshot.windows.map((window) => minimizedIds.has(window.windowId)
            ? { ...window, minimized: true, active: false }
            : window),
          foregroundWindowId: null,
        };
        emit("taskbar.snapshot", taskbarSnapshot);
        return {
          action: "shown",
          affectedWindowCount: minimizedIds.size,
          restoreAvailable: minimizedIds.size > 0,
          restoreJarvisForeground: false,
          mock: true,
        };
      },
      async showFlyout(options) {
        return { shown: true, mock: true, ...options };
      },
      async hideFlyout() {
        return { hidden: true, mock: true };
      },
    },
    taskbarMode: {
      async getState() {
        return { ...taskbarModeState };
      },
      async setMode(mode) {
        if (!TASKBAR_MODES.has(mode)) {
          const error = new Error(`Unsupported taskbar mode: ${mode}`);
          error.code = "INVALID_ARGUMENT";
          throw error;
        }

        persistMockTaskbarMode(mode);
        return beginMockTaskbarTransition(mode, "mock requested-mode-changed");
      },
      async retry() {
        if (taskbarModeState.transitionStatus === "applying") {
          const error = new Error("A taskbar transition is already in progress.");
          error.code = "TASKBAR_RETRY_BLOCKED";
          throw error;
        }
        if (taskbarModeState.requestedMode === taskbarModeState.effectiveMode) {
          const error = new Error("The requested taskbar mode is already active.");
          error.code = "TASKBAR_RETRY_BLOCKED";
          throw error;
        }

        return beginMockTaskbarTransition(
          taskbarModeState.requestedMode,
          "mock manual-retry",
        );
      },
    },
    tray: {
      async getSnapshot() {
        return { ...traySnapshot, audio: { ...traySnapshot.audio } };
      },
      async setVolume(volumePercent) {
        const numericVolume = Number(volumePercent);
        if (!Number.isInteger(numericVolume) || numericVolume < 0 || numericVolume > 100) {
          const error = new Error("Volume must be an integer between 0 and 100.");
          error.code = "INVALID_ARGUMENT";
          throw error;
        }
        traySnapshot = {
          ...traySnapshot,
          timestamp: new Date().toISOString(),
          audio: {
            ...traySnapshot.audio,
            volumePercent: numericVolume,
          },
        };
        emit("tray.snapshot", traySnapshot);
        return { ...traySnapshot, audio: { ...traySnapshot.audio } };
      },
      async setMuted(muted) {
        traySnapshot = {
          ...traySnapshot,
          timestamp: new Date().toISOString(),
          audio: {
            ...traySnapshot.audio,
            muted: Boolean(muted),
          },
        };
        emit("tray.snapshot", traySnapshot);
        return { ...traySnapshot, audio: { ...traySnapshot.audio } };
      },
    },
    feed: {
      async getSnapshot() {
        return cloneSystemFeedSnapshot();
      },
      async markAllRead() {
        systemFeedSnapshot = {
          ...systemFeedSnapshot,
          unreadCount: 0,
          items: systemFeedSnapshot.items.map((item) => ({ ...item, unread: false })),
        };
        const snapshot = cloneSystemFeedSnapshot();
        emit("feed.snapshot", snapshot);
        return snapshot;
      },
      async clear() {
        systemFeedSnapshot = {
          ...systemFeedSnapshot,
          items: [],
          unreadCount: 0,
        };
        rendererFaultLastByKey.clear();
        const snapshot = cloneSystemFeedSnapshot();
        emit("feed.snapshot", snapshot);
        return snapshot;
      },
      async reportFault(fault) {
        return reportRendererFault(fault);
      },
    },
    session: {
      async getState() {
        return {
          available: true,
          confirmationTimeoutSeconds: 15,
          actions: mockSessionActions.map((action) => ({ ...action })),
        };
      },
      async prepare(actionId) {
        const action = mockSessionActions.find((candidate) => candidate.id === actionId);
        if (!action) {
          const error = new Error("This session action is not allowed.");
          error.code = "SESSION_ACTION_NOT_ALLOWED";
          throw error;
        }
        mockSessionTokenSequence += 1;
        mockSessionChallenge = {
          actionId,
          title: action.label,
          detail: action.consequence,
          token: mockSessionTokenSequence.toString(16).padStart(64, "0"),
          expiresAtUtc: new Date(Date.now() + 15_000).toISOString(),
          destructive: action.destructive,
        };
        return { ...mockSessionChallenge };
      },
      async commit(actionId, token) {
        const pending = mockSessionChallenge;
        mockSessionChallenge = null;
        if (
          !pending ||
          pending.actionId !== actionId ||
          pending.token !== token ||
          Date.parse(pending.expiresAtUtc) < Date.now()
        ) {
          const error = new Error("The session-action confirmation expired.");
          error.code = "SESSION_CONFIRMATION_EXPIRED";
          throw error;
        }
        return {
          accepted: true,
          actionId,
          message: `${pending.title} simulated in browser preview.`,
          mock: true,
        };
      },
      async cancel() {
        const cancelled = mockSessionChallenge !== null;
        mockSessionChallenge = null;
        return { cancelled, mock: true };
      },
    },
    windowAppearance: {
      async getState() {
        return { ...windowAppearanceState };
      },
      async setMode(mode) {
        if (!WINDOW_APPEARANCE_MODES.has(mode)) {
          const error = new Error(`Unsupported window appearance mode: ${mode}`);
          error.code = "INVALID_ARGUMENT";
          throw error;
        }

        persistMockWindowAppearanceMode(mode);
        windowAppearanceState = createMockWindowAppearanceState(mode, windowAppearanceRules);
        const state = { ...windowAppearanceState };
        emit("windowAppearance.changed", state);
        return state;
      },
      async setRule(processNameValue, action) {
        const processName = normalizeWindowAppearanceProcessName(processNameValue);
        if (!processName || !WINDOW_APPEARANCE_RULE_ACTIONS.has(action)) {
          const error = new Error("Window appearance rules require a process name and allow or deny.");
          error.code = "INVALID_ARGUMENT";
          throw error;
        }
        if (WINDOW_APPEARANCE_PROTECTED_PROCESSES.has(processName.toLowerCase())) {
          const error = new Error("Windows protected processes cannot be overridden.");
          error.code = "INVALID_ARGUMENT";
          throw error;
        }

        const rule = { processName, action };
        const existingIndex = windowAppearanceRules.findIndex((entry) =>
          entry.processName.localeCompare(processName, undefined, { sensitivity: "base" }) === 0);
        if (existingIndex >= 0) {
          windowAppearanceRules = windowAppearanceRules.with(existingIndex, rule);
        } else {
          if (windowAppearanceRules.length >= 64) {
            const error = new Error("At most 64 window appearance rules can be saved.");
            error.code = "INVALID_ARGUMENT";
            throw error;
          }
          windowAppearanceRules = [...windowAppearanceRules, rule];
        }

        persistMockWindowAppearanceRules(windowAppearanceRules);
        windowAppearanceState = createMockWindowAppearanceState(
          windowAppearanceState.mode,
          windowAppearanceRules,
        );
        const state = { ...windowAppearanceState };
        emit("windowAppearance.changed", state);
        return state;
      },
      async removeRule(processNameValue) {
        const processName = normalizeWindowAppearanceProcessName(processNameValue);
        if (!processName) {
          const error = new Error("Window appearance rules require a process name.");
          error.code = "INVALID_ARGUMENT";
          throw error;
        }
        windowAppearanceRules = windowAppearanceRules.filter((entry) =>
          entry.processName.localeCompare(processName, undefined, { sensitivity: "base" }) !== 0);
        persistMockWindowAppearanceRules(windowAppearanceRules);
        windowAppearanceState = createMockWindowAppearanceState(
          windowAppearanceState.mode,
          windowAppearanceRules,
        );
        const state = { ...windowAppearanceState };
        emit("windowAppearance.changed", state);
        return state;
      },
    },
    shell: {
      async listApplications() {
        return createMockApplicationCatalog();
      },
      async refreshApplications() {
        applicationCatalogRevision += 1;
        const catalog = createMockApplicationCatalog("manual");
        emit("shell.applicationsChanged", catalog);
        return catalog;
      },
      async openApplication(applicationId) {
        return { opened: false, mock: true, applicationId };
      },
      async open(value) {
        return { opened: false, mock: true, ...normalizeOpenParams(value) };
      },
    },
    lifecycle: {
      async getRuntimeInfo() {
        return runtimeInfo;
      },
      async setStartupEnabled(enabled) {
        runtimeInfo = {
          ...runtimeInfo,
          startupEnabled: Boolean(enabled),
          startupCommandCurrent: Boolean(enabled),
          startupCommand: enabled
            ? `"${runtimeInfo.executablePath}" --startup`
            : null,
        };
        return runtimeInfo;
      },
      async runDiagnostics() {
        const startupHealthy = !runtimeInfo.startupEnabled || runtimeInfo.startupCommandCurrent;
        const checks = [
          { id: "windows-recovery", label: "WINDOWS RECOVERY", status: "READY", detail: "Explorer and the native Windows taskbar are available.", verifiedFiles: 0 },
          {
            id: "taskbar-mode",
            label: "TASKBAR MODE",
            status: taskbarModeState.transitionStatus === "settled" ? "READY" : "ATTENTION",
            detail: `Requested ${taskbarModeState.requestedMode.toUpperCase()}; effective ${taskbarModeState.effectiveMode.toUpperCase()}; transition ${taskbarModeState.transitionStatus.toUpperCase()} at generation ${taskbarModeState.transitionGeneration}; recovery failures ${taskbarModeState.recoveryFailureCount}.`,
            verifiedFiles: 0,
          },
          { id: "taskbar-synchronization", label: "TASKBAR SYNCHRONIZATION", status: "READY", detail: "6/6 Windows event hooks are active with 75 ms coalescing; 1000 ms polling remains as recovery fallback. Current virtual desktop filtering is active; 0 off-desktop windows are omitted. No primary-monitor fullscreen foreground window is currently detected.", verifiedFiles: 0 },
          { id: "global-safety-hotkey", label: "GLOBAL SAFETY EXIT", status: "READY", detail: "Ctrl+Shift+Q is registered system-wide for safe JARVIS exit.", verifiedFiles: 0 },
          { id: "native-window-appearance", label: "WINDOW APPEARANCE", status: "READY", detail: `${windowAppearanceState.effectiveMode.toUpperCase()} mode is active; event hooks, integrity guard, persistence, and DWM state tracking are ready.`, verifiedFiles: 0 },
          { id: "webview2", label: "WEBVIEW2 RUNTIME", status: "READY", detail: `Evergreen runtime ${runtimeInfo.webView2Version}.`, verifiedFiles: 0 },
          { id: "installation", label: "INSTALLATION MODE", status: "READY", detail: "Development mode does not require an installer registration.", verifiedFiles: 0 },
          { id: "startup", label: "SIGN-IN STARTUP", status: startupHealthy ? "READY" : "ATTENTION", detail: startupHealthy ? "The startup configuration is valid." : "The saved startup command is stale.", verifiedFiles: 0 },
          { id: "package-integrity", label: "PACKAGE INTEGRITY", status: "READY", detail: "Verified 262 packaged files against SHA-256.", verifiedFiles: 262 },
        ];
        return {
          overallStatus: checks.some((check) => check.status === "ATTENTION") ? "ATTENTION" : "READY",
          verifiedFiles: 262,
          checkedAt: new Date().toISOString(),
          checks,
        };
      },
      async exitToWindows() {
        return { exiting: false, mock: true };
      },
      async showDesktop(options = {}) {
        return { shown: false, mock: true, ...options };
      },
    },
  };
}
