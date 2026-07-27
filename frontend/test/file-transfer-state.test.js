import assert from "node:assert/strict";
import test from "node:test";
import {
  canReplaceAllConflicts,
  getTransferSummary,
  isTransferTerminal,
  normalizeTransferPreflight,
  normalizeTransferSnapshot,
} from "../src/file-transfer-state.js";

test("normalizes PascalCase native preflight and detects self-conflicts", () => {
  const preflight = normalizeTransferPreflight({
    Mode: "copy",
    DestinationPath: "C:\\Work",
    ItemCount: 2,
    CrossesVolumes: false,
    Conflicts: [{
      Source: "C:\\Work\\alpha.txt",
      Target: "C:\\Work\\alpha.txt",
      Name: "alpha.txt",
      SourceIsDirectory: false,
      TargetIsDirectory: false,
    }],
  });

  assert.equal(preflight.conflicts.length, 1);
  assert.equal(preflight.conflicts[0].name, "alpha.txt");
  assert.equal(canReplaceAllConflicts(preflight), false);
});

test("normalizes transfer progress and clamps invalid percentages", () => {
  const transfer = normalizeTransferSnapshot({
    jobId: "job-1",
    mode: "move",
    status: "transferring",
    totalItems: 3,
    completedItems: 1,
    totalBytes: 300,
    bytesTransferred: 120,
    percent: 140,
    result: {
      operation: "move",
      items: [{ source: "C:\\a", target: "D:\\a", name: "a" }],
      failures: [],
      skipped: [{ source: "C:\\b", code: "SKIPPED_CONFLICT", message: "Exists" }],
    },
  });

  assert.equal(transfer.percent, 100);
  assert.equal(transfer.result.items[0].target, "D:\\a");
  assert.equal(transfer.result.skipped[0].code, "SKIPPED_CONFLICT");
  assert.equal(isTransferTerminal(transfer.status), false);
});

test("summarizes all terminal states without hiding skipped items", () => {
  const completed = normalizeTransferSnapshot({
    jobId: "job-2",
    status: "completed",
    completedItems: 4,
    skippedItems: 2,
    result: {},
  });
  const failed = normalizeTransferSnapshot({
    jobId: "job-3",
    status: "failed",
    error: "Disk unavailable",
    result: {},
  });

  assert.equal(getTransferSummary(completed), "4 completed · 2 skipped");
  assert.equal(getTransferSummary(failed), "Disk unavailable");
  assert.equal(isTransferTerminal(completed.status), true);
  assert.equal(isTransferTerminal("cancelled"), true);
});
