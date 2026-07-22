import { resources as fallbackResources } from "../data.js";

const HISTORY_LENGTH = 17;
const BINARY_GB = 1024 ** 3;
const DECIMAL_MB = 1_000_000;
const DECIMAL_GB = 1_000_000_000;
const DECIMAL_TB = 1_000_000_000_000;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function read(object, ...keys) {
  for (const key of keys) {
    if (object?.[key] !== undefined && object?.[key] !== null) return object[key];
  }
  return undefined;
}

function readSection(snapshot, camelKey, pascalKey) {
  return read(snapshot, camelKey, pascalKey) ?? {};
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, finiteNumber(value)));
}

function formatPercent(value, precision = 0) {
  return `${clampPercent(value).toFixed(precision)}%`;
}

function formatMemoryPair(usedBytes, totalBytes) {
  const used = finiteNumber(usedBytes) / BINARY_GB;
  const total = finiteNumber(totalBytes) / BINARY_GB;
  return `${used.toFixed(1)} / ${total.toFixed(1)} GB`;
}

function formatDiskPair(usedBytes, totalBytes) {
  const used = finiteNumber(usedBytes);
  const total = finiteNumber(totalBytes);
  if (total >= DECIMAL_TB) {
    return `${Math.round(used / DECIMAL_GB)} GB / ${(total / DECIMAL_TB).toFixed(2)} TB`;
  }
  return `${Math.round(used / DECIMAL_GB)} / ${Math.round(total / DECIMAL_GB)} GB`;
}

function formatMemory(bytes) {
  const megabytes = finiteNumber(bytes) / DECIMAL_MB;
  if (megabytes < 1000) return `${Math.round(megabytes)} MB`;
  return `${(megabytes / 1000).toFixed(1)} GB`;
}

function formatBitRate(bytesPerSecond) {
  const bitsPerSecond = Math.max(0, finiteNumber(bytesPerSecond)) * 8;
  if (bitsPerSecond >= 1_000_000_000) return `${(bitsPerSecond / 1_000_000_000).toFixed(2)} Gbps`;
  if (bitsPerSecond >= 100_000_000) return `${Math.round(bitsPerSecond / 1_000_000)} Mbps`;
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(1).replace(/\.0$/, "")} Mbps`;
  if (bitsPerSecond >= 1_000) return `${Math.round(bitsPerSecond / 1_000)} Kbps`;
  return `${Math.round(bitsPerSecond)} bps`;
}

function formatNetworkType(value) {
  const raw = String(value ?? "");
  if (!raw || /^\d+$/.test(raw)) return "Active adapter";
  if (raw.toLowerCase() === "wireless80211") return "Wi-Fi";
  if (raw.toLowerCase().includes("ethernet")) return "Ethernet";
  return raw.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function ensureHistory(history, currentValue) {
  if (Array.isArray(history) && history.length > 1) {
    return history.slice(-HISTORY_LENGTH).map((point) => finiteNumber(point));
  }
  return Array.from({ length: HISTORY_LENGTH }, () => finiteNumber(currentValue));
}

function appendHistory(history, value) {
  return [...history, finiteNumber(value)].slice(-HISTORY_LENGTH);
}

function inferDesktopIcon(entry) {
  const name = String(read(entry, "name", "Name", "label", "Label") ?? "").toLowerCase();
  const extension = String(read(entry, "extension", "Extension") ?? "").toLowerCase();
  const kind = String(read(entry, "kind", "Kind") ?? "").toLowerCase();

  if (kind === "directory") return "folder";
  if (name.includes("recycle")) return "recycle";
  if (name.includes("terminal") || name.includes("powershell") || name.includes("command")) return "terminal";
  if (name.includes("setting")) return "settings";
  if (name.includes("download")) return "download";
  if (name.includes("code") || extension === ".code-workspace") return "code";
  if (name.includes("note") || extension === ".txt") return "notes";
  if (kind === "shortcut" || kind === "url") return "desktop";
  return "document";
}

export function normalizeDesktopEntries(result, fallbackEntries = []) {
  const sourceEntries = Array.isArray(result)
    ? result
    : read(result, "entries", "Entries") ?? fallbackEntries;
  const seen = new Set();

  return sourceEntries.flatMap((entry, index) => {
    const name = String(read(entry, "name", "Name", "label", "Label") ?? `Desktop item ${index + 1}`);
    const path = read(entry, "path", "Path");
    const source = String(read(entry, "source", "Source") ?? "desktop");
    const identity = String(path ?? `${source}:${name}`).toLowerCase();
    if (seen.has(identity)) return [];
    seen.add(identity);

    return [{
      ...entry,
      id: String(read(entry, "id", "Id") ?? identity),
      label: name,
      name,
      path,
      target: read(entry, "target", "Target") ?? path ?? name,
      source,
      kind: String(read(entry, "kind", "Kind") ?? "file").toLowerCase(),
      extension: String(read(entry, "extension", "Extension") ?? ""),
      icon: read(entry, "icon", "Icon") ?? inferDesktopIcon(entry),
    }];
  });
}

export function createSystemSnapshotProjector() {
  let cpuHistory = [];
  let networkHistory = [];
  let previousProcessTimestamp = null;
  let previousProcessTimes = new Map();
  let previousProcessCpu = new Map();

  return (snapshot) => {
    const cpu = readSection(snapshot, "cpu", "Cpu");
    const memory = readSection(snapshot, "memory", "Memory");
    const disk = readSection(snapshot, "disk", "Disk");
    const network = readSection(snapshot, "network", "Network");
    const power = readSection(snapshot, "power", "Power");
    const os = readSection(snapshot, "os", "Os");
    const timestampValue = read(snapshot, "timestamp", "Timestamp") ?? new Date().toISOString();
    const processTimestampValue = read(
      snapshot,
      "processSampleTimestamp",
      "ProcessSampleTimestamp",
    ) ?? timestampValue;
    const processTimestamp = Date.parse(processTimestampValue);
    const hasNewProcessSample = Number.isFinite(processTimestamp) &&
      processTimestamp !== previousProcessTimestamp;
    const processElapsedMs = previousProcessTimestamp && hasNewProcessSample
      ? Math.max(0, processTimestamp - previousProcessTimestamp)
      : 0;
    const logicalProcessors = Math.max(1, Math.round(finiteNumber(
      read(cpu, "logicalProcessors", "LogicalProcessors"),
      1,
    )));

    const cpuUsage = clampPercent(read(cpu, "usagePercent", "UsagePercent"));
    const receivedRate = finiteNumber(read(network, "receivedBytesPerSecond", "ReceivedBytesPerSecond"));
    const sentRate = finiteNumber(read(network, "sentBytesPerSecond", "SentBytesPerSecond"));
    const networkPoint = (receivedRate * 8) / 1_000_000;

    cpuHistory = cpuHistory.length
      ? appendHistory(cpuHistory, cpuUsage)
      : ensureHistory(read(cpu, "history", "History"), cpuUsage);
    networkHistory = networkHistory.length
      ? appendHistory(networkHistory, networkPoint)
      : ensureHistory(read(network, "history", "History"), networkPoint);

    const rawProcesses = read(snapshot, "processes", "Processes") ?? [];
    const nextProcessTimes = new Map();
    const nextProcessCpu = new Map();
    const processes = rawProcesses.map((process, index) => {
      const pid = finiteNumber(read(process, "pid", "Pid", "processId", "ProcessId"), index);
      const name = String(read(process, "name", "Name") ?? `Process ${pid}`);
      const totalProcessorTimeMs = finiteNumber(read(
        process,
        "totalProcessorTimeMs",
        "TotalProcessorTimeMs",
      ));
      const previousTotal = previousProcessTimes.get(pid);
      const explicitCpu = read(process, "cpuPercent", "CpuPercent");
      const derivedCpu = processElapsedMs > 0 && previousTotal !== undefined
        ? ((totalProcessorTimeMs - previousTotal) / processElapsedMs / logicalProcessors) * 100
        : previousProcessCpu.get(pid) ?? 0;
      const cpuPercent = explicitCpu === undefined ? clampPercent(derivedCpu) : clampPercent(explicitCpu);
      const workingSetBytes = finiteNumber(read(process, "workingSetBytes", "WorkingSetBytes"));
      const processNetworkRate = read(process, "networkBytesPerSecond", "NetworkBytesPerSecond");
      nextProcessTimes.set(pid, totalProcessorTimeMs);
      nextProcessCpu.set(pid, cpuPercent);

      return {
        id: `${pid}:${name}`,
        pid,
        name,
        cpuValue: cpuPercent,
        memoryValue: workingSetBytes,
        cpu: formatPercent(cpuPercent, 1),
        memory: formatMemory(workingSetBytes),
        network: processNetworkRate === undefined ? "—" : formatBitRate(processNetworkRate),
      };
    }).sort((left, right) => (
      right.cpuValue - left.cpuValue || right.memoryValue - left.memoryValue
    )).slice(0, 5);

    if (hasNewProcessSample) {
      previousProcessTimestamp = processTimestamp;
      previousProcessTimes = nextProcessTimes;
    }
    previousProcessCpu = nextProcessCpu;

    const memoryUsage = clampPercent(read(memory, "usagePercent", "UsagePercent"));
    const diskUsage = clampPercent(read(disk, "usagePercent", "UsagePercent") ?? 12);
    const fallbackDisk = fallbackResources.find((resource) => resource.id === "disk");
    const diskUsedBytes = finiteNumber(read(disk, "usedBytes", "UsedBytes"), 512 * DECIMAL_GB);
    const diskTotalBytes = finiteNumber(read(disk, "totalBytes", "TotalBytes"), 4 * DECIMAL_TB);
    const frequency = read(cpu, "frequencyGhz", "FrequencyGhz");

    return {
      timestamp: timestampValue,
      status: {
        machineName: String(read(os, "machineName", "MachineName") ?? "JARVIS HOST"),
        osDescription: String(read(os, "description", "Description") ?? "Windows"),
        uptimeSeconds: Math.max(0, finiteNumber(read(os, "uptimeSeconds", "UptimeSeconds"))),
        network: {
          available: Boolean(read(network, "isAvailable", "IsAvailable") ?? true),
          interfaceName: String(read(network, "interfaceName", "InterfaceName") ?? "Network"),
          interfaceType: formatNetworkType(read(network, "interfaceType", "InterfaceType")),
        },
        power: {
          batteryPresent: Boolean(read(power, "batteryPresent", "BatteryPresent")),
          percentage: read(power, "percentage", "Percentage") == null
            ? null
            : clampPercent(read(power, "percentage", "Percentage")),
          charging: Boolean(read(power, "charging", "Charging")),
          acConnected: Boolean(read(power, "acConnected", "AcConnected")),
        },
      },
      resources: [
        {
          id: "cpu",
          label: "CPU",
          value: formatPercent(cpuUsage),
          meta: frequency === undefined ? `${logicalProcessors} LOGICAL` : `${finiteNumber(frequency).toFixed(2)} GHz`,
          points: cpuHistory,
        },
        {
          id: "memory",
          label: "MEMORY",
          value: formatPercent(memoryUsage),
          meta: formatMemoryPair(
            read(memory, "usedBytes", "UsedBytes"),
            read(memory, "totalBytes", "TotalBytes"),
          ),
          segments: finiteNumber(
            read(memory, "segments", "Segments"),
            Math.round((memoryUsage / 100) * 18),
          ),
        },
        {
          id: "disk",
          label: String(read(disk, "label", "Label") ?? fallbackDisk?.label ?? "DISK"),
          value: formatPercent(diskUsage),
          meta: formatDiskPair(diskUsedBytes, diskTotalBytes),
          points: ensureHistory(read(disk, "history", "History") ?? fallbackDisk?.points, diskUsage),
        },
        {
          id: "network",
          label: "NETWORK",
          value: `↑ ${formatBitRate(sentRate)}`,
          secondary: `↓ ${formatBitRate(receivedRate)}`,
          points: networkHistory,
        },
      ],
      processes,
    };
  };
}
