const TERMINAL_TRANSFER_STATES = new Set([
  "completed",
  "completed-with-errors",
  "cancelled",
  "failed",
]);

function read(object, camelKey, pascalKey) {
  return object?.[camelKey] ?? object?.[pascalKey];
}

function normalizeFailure(failure) {
  return {
    source: String(read(failure, "source", "Source") ?? ""),
    code: String(read(failure, "code", "Code") ?? "TRANSFER_FAILED"),
    message: String(read(failure, "message", "Message") ?? "Windows could not complete the transfer."),
  };
}

export function normalizeTransferPreflight(result) {
  const conflicts = read(result, "conflicts", "Conflicts") ?? [];
  return {
    mode: String(read(result, "mode", "Mode") ?? "copy"),
    destinationPath: String(read(result, "destinationPath", "DestinationPath") ?? ""),
    itemCount: Number(read(result, "itemCount", "ItemCount") ?? 0),
    crossesVolumes: Boolean(read(result, "crossesVolumes", "CrossesVolumes")),
    conflicts: conflicts.map((conflict) => ({
      source: String(read(conflict, "source", "Source") ?? ""),
      target: String(read(conflict, "target", "Target") ?? ""),
      name: String(read(conflict, "name", "Name") ?? "Unnamed item"),
      sourceIsDirectory: Boolean(read(conflict, "sourceIsDirectory", "SourceIsDirectory")),
      targetIsDirectory: Boolean(read(conflict, "targetIsDirectory", "TargetIsDirectory")),
    })),
  };
}

export function normalizeTransferSnapshot(result) {
  if (!result) return null;
  const operationResult = read(result, "result", "Result") ?? {};
  const items = read(operationResult, "items", "Items") ?? [];
  const failures = read(operationResult, "failures", "Failures") ?? [];
  const skipped = read(operationResult, "skipped", "Skipped") ?? [];
  return {
    jobId: String(read(result, "jobId", "JobId") ?? ""),
    mode: String(read(result, "mode", "Mode") ?? "copy"),
    conflictPolicy: String(read(result, "conflictPolicy", "ConflictPolicy") ?? "rename"),
    status: String(read(result, "status", "Status") ?? "queued"),
    currentItem: read(result, "currentItem", "CurrentItem") ?? null,
    totalItems: Number(read(result, "totalItems", "TotalItems") ?? 0),
    completedItems: Number(read(result, "completedItems", "CompletedItems") ?? 0),
    failedItems: Number(read(result, "failedItems", "FailedItems") ?? 0),
    skippedItems: Number(read(result, "skippedItems", "SkippedItems") ?? 0),
    totalBytes: Number(read(result, "totalBytes", "TotalBytes") ?? 0),
    bytesTransferred: Number(read(result, "bytesTransferred", "BytesTransferred") ?? 0),
    percent: Math.min(100, Math.max(0, Number(read(result, "percent", "Percent") ?? 0))),
    startedAt: read(result, "startedAt", "StartedAt") ?? null,
    updatedAt: read(result, "updatedAt", "UpdatedAt") ?? null,
    error: read(result, "error", "Error") ?? null,
    result: {
      operation: String(read(operationResult, "operation", "Operation") ?? "transfer"),
      items: items.map((item) => ({
        source: String(read(item, "source", "Source") ?? ""),
        target: String(read(item, "target", "Target") ?? ""),
        name: String(read(item, "name", "Name") ?? ""),
      })),
      failures: failures.map(normalizeFailure),
      skipped: skipped.map(normalizeFailure),
    },
  };
}

export function isTransferTerminal(status) {
  return TERMINAL_TRANSFER_STATES.has(status);
}

export function canReplaceAllConflicts(preflight) {
  return preflight.conflicts.every((conflict) => (
    conflict.source.toLocaleLowerCase() !== conflict.target.toLocaleLowerCase()
  ));
}

export function getTransferSummary(transfer) {
  if (!transfer) return "";
  if (transfer.status === "completed") {
    const skipped = transfer.skippedItems > 0 ? ` · ${transfer.skippedItems} skipped` : "";
    return `${transfer.completedItems} completed${skipped}`;
  }
  if (transfer.status === "completed-with-errors") {
    return `${transfer.completedItems} completed · ${transfer.failedItems} failed · ${transfer.skippedItems} skipped`;
  }
  if (transfer.status === "cancelled") {
    return "Transfer cancelled · partial output cleaned";
  }
  if (transfer.status === "failed") {
    return transfer.error || transfer.result.failures[0]?.message || "Transfer failed";
  }
  if (transfer.status === "scanning") {
    return `Scanning ${transfer.totalItems} item${transfer.totalItems === 1 ? "" : "s"}`;
  }
  if (transfer.status === "cancelling") {
    return "Cancelling safely";
  }
  return transfer.currentItem
    ? `${transfer.mode === "move" ? "Moving" : "Copying"} ${transfer.currentItem}`
    : "Preparing transfer";
}
